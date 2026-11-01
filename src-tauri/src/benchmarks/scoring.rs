use super::*;
use std::collections::{BTreeMap, BTreeSet};

// Tiers describe rank bands, never a fabricated accuracy/ability percentage.
fn assign_ranks(entries: &mut [RankEntry], descending: bool) {
    entries.sort_by(|a, b| {
        let order = if descending {
            b.score.total_cmp(&a.score)
        } else {
            a.score.total_cmp(&b.score)
        };
        order.then(a.model_id.cmp(&b.model_id))
    });
    let n = entries.len() as f64;
    let mut previous = None;
    let mut rank = 0;
    for (position, entry) in entries.iter_mut().enumerate() {
        if previous.is_none_or(|old: f64| (old - entry.score).abs() > 1e-9) {
            rank = position as u32 + 1;
            previous = Some(entry.score);
        }
        entry.rank = rank;
        let fraction = (rank as f64 - 1.) / n.max(1.);
        entry.tier = if fraction < 0.1 {
            "S"
        } else if fraction < 0.3 {
            "A"
        } else if fraction < 0.6 {
            "B"
        } else if fraction < 0.85 {
            "C"
        } else {
            "D"
        }
        .into();
    }
}

pub fn best_result<'a>(
    model: &'a RankedModel,
    source: &str,
    effort: Option<&str>,
) -> Option<&'a SourceResult> {
    model
        .results
        .iter()
        .filter(|r| {
            r.source_id == source
                && effort.is_none_or(|e| {
                    r.setting
                        .split(',')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .eq_ignore_ascii_case(e)
                })
        })
        .max_by(|a, b| {
            a.score
                .total_cmp(&b.score)
                .then_with(|| b.profile_id.cmp(&a.profile_id))
        })
}

fn publisher_ranking(
    models: &[RankedModel],
    id: &str,
    name: &str,
    source: &str,
    effort: Option<&str>,
) -> Ranking {
    let mut entries = Vec::new();
    let mut versions = BTreeSet::new();
    for model in models {
        if let Some(result) = best_result(model, source, effort) {
            versions.insert(result.version.clone());
            entries.push(RankEntry {
                model_id: model.id.clone(),
                score: result.score,
                rank: 0,
                tier: String::new(),
                coverage: result.coverage,
                profile_id: result.profile_id.clone(),
                setting: result.setting.clone(),
                source_ranks: BTreeMap::new(),
                benchmark_count: result.components.len(),
                ..Default::default()
            });
        }
    }
    // Incomparable protocol versions must not silently share one leaderboard.
    if versions.len() > 1 {
        entries.clear();
    }
    assign_ranks(&mut entries, true);
    Ranking {
        id: id.into(),
        name: name.into(),
        version: versions.into_iter().collect::<Vec<_>>().join(" / "),
        unit: if source == "livebench" {
            "原始综合分"
        } else {
            "原始指数"
        }
        .into(),
        entries,
        ..Default::default()
    }
}

fn midranks(entries: &[RankEntry], cohort: &BTreeSet<String>) -> BTreeMap<String, f64> {
    let rows: Vec<_> = entries
        .iter()
        .filter(|e| cohort.contains(&e.model_id))
        .collect();
    let mut result = BTreeMap::new();
    let mut start = 0;
    while start < rows.len() {
        let mut end = start + 1;
        while end < rows.len() && (rows[end].score - rows[start].score).abs() < 1e-9 {
            end += 1;
        }
        let rank = (start + 1 + end) as f64 / 2.;
        for row in &rows[start..end] {
            result.insert(row.model_id.clone(), rank);
        }
        start = end;
    }
    result
}

pub fn calculate(data: &Dataset) -> Board {
    let mut identities: BTreeMap<String, (String, String)> = BTreeMap::new();
    for o in &data.observations {
        if o.source_id == "artificial-analysis" {
            identities.insert(o.model_id.clone(), (o.model_name.clone(), o.vendor.clone()));
        }
    }
    for o in &data.observations {
        identities
            .entry(o.model_id.clone())
            .or_insert((o.model_name.clone(), o.vendor.clone()));
    }
    let lb_source = data.sources.iter().find(|s| s.id == "livebench");
    let mut models = Vec::new();
    for (id, (name, vendor)) in identities {
        let mut observations: Vec<_> = data
            .observations
            .iter()
            .filter(|o| o.model_id == id)
            .cloned()
            .collect();
        observations.sort_by(|a, b| {
            a.source_id
                .cmp(&b.source_id)
                .then(a.profile_id.cmp(&b.profile_id))
                .then(a.metric.cmp(&b.metric))
                .then(a.value.total_cmp(&b.value))
        });
        let mut results = Vec::new();
        let mut profiles = BTreeSet::new();
        for profile in data.profiles.iter().filter(|p| {
            p.model_id == id
                && p.source_id == "artificial-analysis"
                && p.version == "Intelligence Index v5"
                && !p.id.is_empty()
        }) {
            if !profiles.insert(profile.id.clone()) {
                continue;
            }
            let mut components = BTreeMap::new();
            for o in observations.iter().filter(|o| {
                o.source_id == profile.source_id && o.profile_id == profile.id && !o.official
            }) {
                components.entry(o.metric.clone()).or_insert(Component {
                    metric: o.metric.clone(),
                    value: o.value,
                    unit: o.unit.clone(),
                    weight: None,
                    ..Default::default()
                });
            }
            results.push(SourceResult {
                source_id: profile.source_id.clone(),
                version: profile.version.clone(),
                profile_id: profile.id.clone(),
                setting: profile.setting.clone(),
                score: profile.index,
                coverage: 100.,
                components: components.into_values().collect(),
                url: "https://artificialanalysis.ai/leaderboards/models".into(),
                ..Default::default()
            });
        }
        if let Some(source) = lb_source.filter(|s| s.weights.len() == 7) {
            let mut groups: BTreeMap<(String, String), Vec<&Observation>> = BTreeMap::new();
            for o in observations
                .iter()
                .filter(|o| o.source_id == "livebench" && !o.official && !o.profile_id.is_empty())
            {
                groups
                    .entry((o.profile_id.clone(), o.version.clone()))
                    .or_default()
                    .push(o);
            }
            for ((profile_id, version), rows) in groups {
                let mut unique: BTreeMap<String, &Observation> = BTreeMap::new();
                let mut invalid = false;
                for row in rows {
                    if !source.weights.contains_key(&row.metric) {
                        invalid = true;
                        break;
                    }
                    if unique
                        .get(&row.metric)
                        .is_some_and(|old| (old.value - row.value).abs() > 1e-9)
                    {
                        invalid = true;
                        break;
                    }
                    unique.insert(row.metric.clone(), row);
                }
                if invalid || unique.is_empty() {
                    continue;
                }
                let total: f64 = unique.keys().map(|k| source.weights[k]).sum();
                if total <= 0. {
                    continue;
                }
                let score = unique
                    .iter()
                    .map(|(key, row)| row.value * source.weights[key])
                    .sum::<f64>()
                    / total;
                let components = unique
                    .into_iter()
                    .map(|(key, o)| Component {
                        weight: Some(source.weights[&key]),
                        metric: key,
                        value: o.value,
                        unit: o.unit.clone(),
                        ..Default::default()
                    })
                    .collect::<Vec<_>>();
                results.push(SourceResult {
                    source_id: "livebench".into(),
                    version,
                    profile_id,
                    setting: "LiveBench 发布配置".into(),
                    score,
                    coverage: components.len() as f64 / source.weights.len() as f64 * 100.,
                    components,
                    url: source.url.clone(),
                    ..Default::default()
                });
            }
        }
        results.sort_by(|a, b| {
            a.source_id
                .cmp(&b.source_id)
                .then(a.profile_id.cmp(&b.profile_id))
        });
        models.push(RankedModel {
            id,
            name,
            vendor,
            results,
            observations,
        });
    }
    if let Some(snapshot) = &data.epoch {
        for (id, results) in epoch::results(snapshot) {
            if let Some(model) = models.iter_mut().find(|m| m.id == id) {
                model.results.extend(results);
            } else if let Some(model) = snapshot.models.iter().find(|m| m.id == id) {
                models.push(RankedModel {
                    id,
                    name: model.name.clone(),
                    vendor: model.vendor.clone(),
                    results,
                    observations: vec![],
                });
            }
        }
    }
    let aa = publisher_ranking(&models, "aa", "AA 能力指数", "artificial-analysis", None);
    let lb = publisher_ranking(&models, "livebench", "LiveBench 综合分", "livebench", None);
    let aa_ids: BTreeSet<_> = aa
        .entries
        .iter()
        .filter(|e| e.coverage >= 100.)
        .map(|e| e.model_id.clone())
        .collect();
    let lb_ids: BTreeSet<_> = lb
        .entries
        .iter()
        .filter(|e| e.coverage >= 100.)
        .map(|e| e.model_id.clone())
        .collect();
    let cohort: BTreeSet<_> = aa_ids.intersection(&lb_ids).cloned().collect();
    let aa_ranks = midranks(&aa.entries, &cohort);
    let lb_ranks = midranks(&lb.entries, &cohort);
    let mut consensus = Vec::new();
    if cohort.len() >= 5 {
        for id in &cohort {
            let ranks = BTreeMap::from([
                ("artificial-analysis".into(), aa_ranks[id]),
                ("livebench".into(), lb_ranks[id]),
            ]);
            consensus.push(RankEntry {
                model_id: id.clone(),
                score: (aa_ranks[id] + lb_ranks[id]) / 2.,
                rank: 0,
                tier: String::new(),
                coverage: 100.,
                profile_id: String::new(),
                setting: "两榜同池 · 平均名次".into(),
                source_ranks: ranks,
                ..Default::default()
            });
        }
    }
    assign_ranks(&mut consensus, false);
    let consensus = Ranking {
        id: "consensus".into(),
        name: "跨榜共识".into(),
        version: format!("{} / {}", aa.version, lb.version),
        unit: "平均名次 · 越低越好".into(),
        entries: consensus,
        ..Default::default()
    };
    let mut rankings = vec![aa, lb, consensus];
    if let Some(snapshot) = &data.epoch {
        let policy = epoch::policy();
        let mut domains = vec![("general".to_string(), "通用综合".to_string())];
        domains.extend(
            policy
                .domains
                .iter()
                .map(|d| (d.id.clone(), d.name.clone())),
        );
        for (id, name) in domains.into_iter().rev() {
            let mut entries: Vec<_> = models
                .iter()
                .filter_map(|m| {
                    m.results
                        .iter()
                        .find(|r| r.source_id == "epoch-ai" && r.kind == id)
                        .map(|r| RankEntry {
                            model_id: m.id.clone(),
                            score: r.score,
                            coverage: r.coverage,
                            profile_id: r.profile_id.clone(),
                            setting: r.setting.clone(),
                            lower: r.lower,
                            upper: r.upper,
                            range_kind: r.range_kind.clone(),
                            benchmark_count: r.benchmark_count,
                            ..Default::default()
                        })
                })
                .collect();
            assign_ranks(&mut entries, true);
            // Fixed, labelled ECI-scale bands: roster changes never move an
            // existing score to another tier. These are display policy only.
            for e in &mut entries {
                e.tier = ["S", "A", "B", "C"]
                    .into_iter()
                    .find(|tier| e.score >= policy.tier_thresholds[*tier])
                    .unwrap_or("D")
                    .into();
            }
            rankings.insert(
                0,
                Ranking {
                    id,
                    name,
                    version: format!("{} · {}", policy.version, &snapshot.sha256[..12]),
                    unit: "校准指数 · 非百分比".into(),
                    entries,
                    tier_labels: BTreeMap::from([
                        ("S".into(), "165+".into()),
                        ("A".into(), "155–165".into()),
                        ("B".into(), "145–155".into()),
                        ("C".into(), "130–145".into()),
                        ("D".into(), "< 130".into()),
                    ]),
                },
            );
        }
    }
    for effort in [
        "Low",
        "Medium",
        "High",
        "Xhigh",
        "Max",
        "Reasoning",
        "Non-reasoning",
    ] {
        rankings.push(publisher_ranking(
            &models,
            &format!("aa:{}", effort.to_ascii_lowercase()),
            &format!("AA · {effort}"),
            "artificial-analysis",
            Some(effort),
        ));
    }
    Board {
        releases:data.releases.clone(),
        algorithm: ALGORITHM.into(),
        sources: data.sources.clone(),
        models,
        profiles: data.profiles.clone(),
        reference_cohort: cohort.into_iter().collect(),
        rankings,
    }
}
