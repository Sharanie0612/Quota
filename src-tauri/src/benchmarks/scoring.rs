use super::*;
use std::collections::{BTreeMap, BTreeSet};
type MetricKey = (String, String, String);
fn average(values: impl Iterator<Item = f64>) -> Option<f64> {
    let rows: Vec<_> = values.collect();
    if rows.is_empty() {
        None
    } else {
        Some(rows.iter().sum::<f64>() / rows.len() as f64)
    }
}
fn rounded(value: f64) -> f64 {
    (value * 10.).round() / 10.
}
/// Empirical percentile interpolation over one benchmark/version and a common
/// reference cohort. Tied results share their midrank; all-tied results are 50.
pub fn percentile(value: f64, reference: &[f64]) -> Option<f64> {
    if reference.len() < 5 || !value.is_finite() {
        return None;
    }
    let mut values = reference.to_vec();
    values.sort_by(f64::total_cmp);
    let mut knots: Vec<(f64, f64)> = Vec::new();
    let mut start = 0;
    while start < values.len() {
        let mut end = start + 1;
        while end < values.len() && (values[end] - values[start]).abs() < 1e-9 {
            end += 1
        }
        let rank = (start + end - 1) as f64 / 2.;
        knots.push((values[start], 100. * rank / (values.len() - 1) as f64));
        start = end;
    }
    if knots.len() == 1 {
        return Some(50.);
    }
    if value < knots[0].0 {
        return Some(0.);
    }
    if value > knots.last()?.0 {
        return Some(100.);
    }
    for pair in knots.windows(2) {
        let (left, right) = (pair[0], pair[1]);
        if value >= left.0 && value <= right.0 {
            return Some(left.1 + (value - left.0) / (right.0 - left.0) * (right.1 - left.1));
        }
    }
    knots.last().map(|v| v.1)
}
pub fn calculate(data: &Dataset) -> Board {
    let mut identities: BTreeMap<String, (String, String)> = BTreeMap::new();
    for observation in &data.observations {
        if observation.source_id == "artificial-analysis" {
            identities.insert(
                observation.model_id.clone(),
                (observation.model_name.clone(), observation.vendor.clone()),
            );
        }
    }
    for observation in &data.observations {
        identities
            .entry(observation.model_id.clone())
            .or_insert((observation.model_name.clone(), observation.vendor.clone()));
    }
    let mut independent: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for observation in &data.observations {
        if !observation.official {
            independent
                .entry(observation.model_id.clone())
                .or_default()
                .insert(observation.source_id.clone());
        }
    }
    let reference_cohort: Vec<_> = independent
        .iter()
        .filter(|(_, sources)| sources.len() >= 2)
        .map(|(id, _)| id.clone())
        .collect();
    let cohort: BTreeSet<_> = reference_cohort.iter().cloned().collect();
    // Choose the best public configuration once per source and exact metric.
    // Repeated copies, alternative efforts, and mirrors cannot multiply weight.
    let mut metrics: BTreeMap<MetricKey, BTreeMap<String, &Observation>> = BTreeMap::new();
    for observation in &data.observations {
        if !observation.value.is_finite() || observation.value < 0. {
            continue;
        }
        let entries = metrics
            .entry((
                observation.source_id.clone(),
                observation.metric.clone(),
                observation.version.clone(),
            ))
            .or_default();
        match entries.get(&observation.model_id) {
            Some(old) if old.value >= observation.value => {}
            _ => {
                entries.insert(observation.model_id.clone(), observation);
            }
        }
    }
    // model -> domain -> publisher -> family -> (percentile, component weight)
    type Families = BTreeMap<String, Vec<(f64, f64)>>;
    let mut scores: BTreeMap<String, BTreeMap<String, BTreeMap<String, (bool, Families)>>> =
        BTreeMap::new();
    for entries in metrics.values() {
        let anchors: Vec<_> = entries
            .iter()
            .filter(|(id, _)| cohort.contains(*id))
            .map(|(_, o)| o.value)
            .collect();
        if anchors.len() < 5 {
            continue;
        }
        for observation in entries.values() {
            if let Some(value) = percentile(observation.value, &anchors) {
                let source = scores
                    .entry(observation.model_id.clone())
                    .or_default()
                    .entry(observation.domain.clone())
                    .or_default()
                    .entry(observation.source_id.clone())
                    .or_insert((observation.official, BTreeMap::new()));
                source
                    .1
                    .entry(observation.family.clone())
                    .or_default()
                    .push((value, observation.weight));
            }
        }
    }
    let mut models = Vec::new();
    for (id, (name, vendor)) in identities {
        let mut domains = BTreeMap::new();
        let mut contributions = Vec::new();
        let mut sources = BTreeSet::new();
        if let Some(domain_scores) = scores.get(&id) {
            for (domain, publishers) in domain_scores {
                let mut independent_scores = Vec::new();
                let mut official_scores = Vec::new();
                for (source, (official, families)) in publishers {
                    let value = average(families.values().filter_map(|components| {
                        let weight: f64 = components.iter().map(|v| v.1).sum();
                        if weight > 0. {
                            Some(components.iter().map(|v| v.0 * v.1).sum::<f64>() / weight)
                        } else {
                            None
                        }
                    }));
                    if let Some(value) = value {
                        contributions.push(Contribution {
                            source_id: source.clone(),
                            domain: domain.clone(),
                            score: rounded(value),
                            metrics: families.len(),
                            official: *official,
                        });
                        if *official {
                            official_scores.push(value)
                        } else {
                            independent_scores.push(value);
                            if domain != "visual" {
                                sources.insert(source.clone());
                            }
                        }
                    }
                }
                if let Some(independent) = average(independent_scores.into_iter()) {
                    let score = if let Some(official) = average(official_scores.into_iter()) {
                        0.8 * independent + 0.2 * official
                    } else {
                        independent
                    };
                    domains.insert(domain.clone(), score);
                }
            }
        }
        let coverage: f64 = DOMAINS
            .iter()
            .filter(|d| domains.contains_key(d.0))
            .map(|d| d.2)
            .sum();
        let score = if coverage > 0. {
            Some(rounded(
                DOMAINS
                    .iter()
                    .filter_map(|d| domains.get(d.0).map(|s| s * d.2))
                    .sum::<f64>()
                    / coverage,
            ))
        } else {
            None
        };
        let provisional = coverage < 0.8 - 1e-9 || sources.len() < 2;
        let tier = if provisional {
            "观察"
        } else {
            match score.unwrap_or(0.) {
                s if s >= 85. => "S",
                s if s >= 70. => "A",
                s if s >= 55. => "B",
                s if s >= 35. => "C",
                _ => "D",
            }
        }
        .to_string();
        if score.is_some() || !domains.is_empty() {
            let mut observations: Vec<_> = data
                .observations
                .iter()
                .filter(|o| o.model_id == id)
                .cloned()
                .collect();
            observations.sort_by(|a, b| {
                a.source_id
                    .cmp(&b.source_id)
                    .then(a.metric.cmp(&b.metric))
                    .then(a.version.cmp(&b.version))
                    .then(a.setting.cmp(&b.setting))
                    .then(a.value.total_cmp(&b.value))
            });
            models.push(RankedModel {
                id: id.clone(),
                name,
                vendor,
                score,
                rank: None,
                tier,
                domains: domains.into_iter().map(|(k, v)| (k, rounded(v))).collect(),
                coverage: rounded(coverage * 100.),
                independent_sources: sources.len(),
                provisional,
                contributions,
                observations,
            });
        }
    }
    models.sort_by(|a, b| {
        a.provisional
            .cmp(&b.provisional)
            .then_with(|| b.score.unwrap_or(-1.).total_cmp(&a.score.unwrap_or(-1.)))
            .then(a.name.cmp(&b.name))
    });
    let mut previous = None;
    let mut rank = 0;
    let mut position = 0;
    for model in models.iter_mut().filter(|m| !m.provisional) {
        position += 1;
        if previous != model.score {
            rank = position;
            previous = model.score;
        }
        model.rank = Some(rank);
    }
    Board {
        algorithm: ALGORITHM.into(),
        sources: data.sources.clone(),
        models,
        profiles: data.profiles.clone(),
        reference_cohort,
    }
}
