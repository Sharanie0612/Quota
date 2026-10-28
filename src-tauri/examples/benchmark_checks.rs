use quota_lib::benchmarks::{self, Dataset, Observation, Profile, Source};
use std::{collections::BTreeMap, fs, path::Path};
fn fixture() -> Dataset {
    let weights = BTreeMap::from([
        ("Long Agentic", 2.),
        ("Reasoning", 1.),
        ("Coding", 1.5),
        ("Browser", 1.),
        ("Data Analysis", 1.),
        ("Research", 1.),
        ("Design", 1.5),
    ])
    .into_iter()
    .map(|(k, v)| (format!("LiveBench {k}"), v))
    .collect::<BTreeMap<_, _>>();
    let mut data = Dataset {
        schema: 3,
        sources: vec![
            Source {
                id: "artificial-analysis".into(),
                ..Default::default()
            },
            Source {
                id: "livebench".into(),
                weights: weights.clone(),
                ..Default::default()
            },
        ],
        observations: vec![],
        profiles: vec![],
        epoch: None,
        releases: vec![],
    };
    for i in 0..8 {
        let id = format!("model{i}");
        let name = format!("Model {i}");
        for (setting, index) in [("High", 10. + i as f64 * 10.), ("Low", 9. + i as f64 * 10.)] {
            let profile_id = format!("{id}-{setting}");
            data.profiles.push(Profile {
                id: profile_id.clone(),
                model_id: id.clone(),
                name: format!("{name} ({setting})"),
                vendor: "Fixture".into(),
                setting: setting.into(),
                index,
                cost: Some(1.),
                speed: None,
                latency: None,
                source_id: "artificial-analysis".into(),
                version: "Intelligence Index v5".into(),
            });
            for (metric, value) in [
                ("Coding", if setting == "High" { 10. } else { 90. }),
                ("Reasoning", if setting == "High" { 90. } else { 10. }),
            ] {
                data.observations.push(Observation {
                    profile_id: profile_id.clone(),
                    model_id: id.clone(),
                    model_name: name.clone(),
                    vendor: "Fixture".into(),
                    source_id: "artificial-analysis".into(),
                    metric: metric.into(),
                    family: metric.into(),
                    version: "v5".into(),
                    domain: "coding".into(),
                    setting: setting.into(),
                    value,
                    unit: "percent".into(),
                    weight: 1.,
                    official: false,
                    url: "https://example.invalid".into(),
                    checked_at: "2026-10-28T00:00:00Z".into(),
                });
            }
        }
        for (metric, weight) in &weights {
            data.observations.push(Observation {
                profile_id: format!("lb-{id}"),
                model_id: id.clone(),
                model_name: name.clone(),
                vendor: "Fixture".into(),
                source_id: "livebench".into(),
                metric: metric.clone(),
                family: metric.clone(),
                version: "20261025".into(),
                domain: "coding".into(),
                setting: "平台配置".into(),
                value: 10. + i as f64 * 10.,
                unit: "percent".into(),
                weight: *weight,
                official: false,
                url: "https://example.invalid".into(),
                checked_at: "2026-10-28T00:00:00Z".into(),
            });
        }
    }
    data
}
fn ranking<'a>(board: &'a benchmarks::Board, id: &str) -> &'a benchmarks::Ranking {
    board.rankings.iter().find(|r| r.id == id).unwrap()
}
fn checks() {
    let data = fixture();
    let board = benchmarks::calculate(&data);
    let aa = ranking(&board, "aa");
    assert_eq!(aa.entries[0].score, 80.);
    assert_eq!(aa.entries[0].profile_id, "model7-High");
    let model = board.models.iter().find(|m| m.id == "model7").unwrap();
    let selected = model
        .results
        .iter()
        .find(|r| r.profile_id == aa.entries[0].profile_id)
        .unwrap();
    assert_eq!(
        selected
            .components
            .iter()
            .find(|c| c.metric == "Coding")
            .unwrap()
            .value,
        10.,
        "no cherry-picking Low's better coding value"
    );
    assert_eq!(ranking(&board, "aa:low").entries[0].score, 79.);
    let mut duplicate = data.clone();
    duplicate.observations.extend(data.observations.clone());
    assert_eq!(
        serde_json::to_value(&board.rankings).unwrap(),
        serde_json::to_value(benchmarks::calculate(&duplicate).rankings).unwrap()
    );
    let mut reversed = data.clone();
    reversed.observations.reverse();
    reversed.profiles.reverse();
    assert_eq!(
        serde_json::to_value(&board.rankings).unwrap(),
        serde_json::to_value(benchmarks::calculate(&reversed).rankings).unwrap()
    );
    let mut official = data.clone();
    let mut o = data.observations[0].clone();
    o.source_id = "official-openai".into();
    o.official = true;
    o.value = 500.;
    official.observations.push(o);
    assert_eq!(
        serde_json::to_value(&board.rankings).unwrap(),
        serde_json::to_value(benchmarks::calculate(&official).rankings).unwrap()
    );
    let mut missing = data.clone();
    missing.observations.retain(|o| {
        o.model_id != "model7" || o.source_id != "livebench" || o.metric != "LiveBench Coding"
    });
    let missing = benchmarks::calculate(&missing);
    assert!(!missing.reference_cohort.contains(&"model7".into()));
    assert_eq!(ranking(&missing, "aa").entries[0].score, 80.);
    let mut one = data.clone();
    one.observations.retain(|o| o.source_id != "livebench");
    let one = benchmarks::calculate(&one);
    assert_eq!(ranking(&one, "aa").entries.len(), 8);
    assert!(ranking(&one, "consensus").entries.is_empty());
    let mut extended = data.clone();
    let mut p = data.profiles[0].clone();
    p.id = "new-model".into();
    p.model_id = "new-model".into();
    p.index = 5.;
    extended.profiles.push(p);
    let mut o = data.observations[0].clone();
    o.model_id = "new-model".into();
    o.model_name = "New model".into();
    o.profile_id = "new-model".into();
    extended.observations.push(o);
    let extended = benchmarks::calculate(&extended);
    for e in &aa.entries {
        let actual = ranking(&extended, "aa")
            .entries
            .iter()
            .find(|r| r.model_id == e.model_id)
            .unwrap();
        assert_eq!(e.score, actual.score);
        assert_eq!(e.rank, actual.rank);
    }
    assert_ne!(
        benchmarks::identity("Qwen3.8 Max (0902)"),
        benchmarks::identity("Qwen3.8 Max (0903)")
    );
    println!("PASS complete profiles, faithful source scores, source-only models, declared weights, duplicate/order invariance, official exclusion, missing coverage, cohort isolation and exact dates");
}
fn main() {
    checks();
    scenario_math_checks();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let audit = root.join("../target/benchmark-sources");
    if !std::env::args().any(|a| a == "--fixtures" || a == "--live" || a == "--write-seed") {
        return;
    }
    let checked: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(audit.join("sources.json")).unwrap()).unwrap();
    let checked = checked["checkedAt"].as_str().unwrap();
    let aa_html = fs::read_to_string(audit.join("artificial-analysis.html")).unwrap();
    assert!(benchmarks::parse_aa(&aa_html.replace("Index v5.0", "Index v6.0"), checked).is_err());
    let table = fs::read_to_string(audit.join("livebench-current-table.csv")).unwrap();
    let categories = fs::read_to_string(audit.join("livebench-current-categories.json")).unwrap();
    let release = fs::read_to_string(audit.join("livebench-release.txt")).unwrap();
    let mut aa = benchmarks::parse_aa(&aa_html, checked).unwrap();
    let index_html=fs::read_to_string(audit.join("aa-index.html")).expect("download AA evaluation page");
    let edition_html=fs::read_to_string(audit.join("aa-index-v5.html")).expect("download AA version announcement");
    benchmarks::edition::attach(&mut aa,&index_html,&edition_html).expect("verified evaluation edition");
    let edition=aa.sources.iter().find(|s|s.id=="artificial-analysis").unwrap().edition.as_ref().unwrap();
    assert_eq!(edition.published_at,"2026-10-27");assert!(edition.primary_profiles.contains(&"gpt-6-astra".to_string()));
    assert!(aa.profiles.iter().all(|p|aa.profiles.iter().any(|other|other.vendor==p.vendor&&edition.primary_profiles.contains(&other.id))));
    let mut invalid=aa.clone();assert!(benchmarks::edition::attach(&mut invalid,&index_html,&edition_html.replace("datePublished","unconfirmedDate")).is_err());
    let lb = benchmarks::parse_livebench(&table, &categories, release.trim(), checked).unwrap();
    assert!(benchmarks::parse_livebench(
        &table.replace("reasoning", "reasoning_v3"),
        &categories,
        release.trim(),
        checked
    )
    .is_err());
    let mut dataset = benchmarks::merge(
        Dataset {
            schema: 3,
            ..Default::default()
        },
        vec![
            ("artificial-analysis".into(), Ok(aa)),
            ("livebench".into(), Ok(lb)),
        ],
    );
    let old: Dataset = serde_json::from_str(include_str!("../data/benchmarks.json")).unwrap();
    for source in old.sources.iter().filter(|s| !s.automatic) {
        let data = Dataset {
            schema: 3,
            sources: vec![source.clone()],
            observations: old
                .observations
                .iter()
                .filter(|o| o.source_id == source.id)
                .cloned()
                .collect(),
            profiles: vec![],
            epoch: None,
            releases: vec![],
        };
        dataset = benchmarks::merge(dataset, vec![(source.id.clone(), Ok(data))]);
    }
    let epoch_zip = fs::read(root.join("../target/epoch-research/benchmark_data.zip"))
        .expect("download official Epoch fixture");
    let epoch_checked: chrono::DateTime<chrono::Utc> =
        fs::metadata(root.join("../target/epoch-research/benchmark_data.zip"))
            .unwrap()
            .modified()
            .unwrap()
            .into();
    let epoch = benchmarks::epoch::parse(&epoch_zip, &epoch_checked.to_rfc3339())
        .expect("valid official Epoch fixture");
    let releases=benchmarks::releases::parse(&fs::read_to_string(audit.join("model-releases.html")).expect("download model releases"),checked).expect("valid release directory");
    assert!(releases.releases.len()>50);
    dataset=benchmarks::merge(dataset,vec![("model-releases".into(),Ok(releases))]);
    dataset = benchmarks::merge(
        dataset,
        vec![(
            "epoch-ai".into(),
            Ok(Dataset {
                schema: 3,
                sources: vec![Source {
                    id: "epoch-ai".into(),
                    name: "Epoch AI".into(),
                    url: benchmarks::epoch::SITE.into(),
                    version: format!("ECI · {} 项校准", epoch.curves.len()),
                    checked_at: checked.into(),
                    records: epoch.records.len(),
                    automatic: true,
                    ..Default::default()
                }],
                epoch: Some(epoch),
                ..Default::default()
            }),
        )],
    );
    if std::env::args().any(|a| a == "--live") {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let client = reqwest::Client::new();
        let updates = rt.block_on(benchmarks::fetch(&client));
        for (id, r) in &updates {
            assert!(r.is_ok(), "{id}: {:?}", r.as_ref().err());
        }
        dataset = benchmarks::merge(dataset, updates);
    }
    assert!(benchmarks::valid(&dataset));
    let started = std::time::Instant::now();
    let board = benchmarks::calculate(&dataset);
    println!(
        "Full board calculation: {} ms",
        started.elapsed().as_millis()
    );
    let golden: serde_json::Value =
        serde_json::from_str(include_str!("../data/benchmark-golden.json")).unwrap();
    let mut reconciled = Vec::new();
    let reference: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(root.join("../target/epoch-research/reference.json"))
            .expect("run reference-scenarios.py first"),
    )
    .unwrap();
    assert_eq!(
        reference["zipSha256"].as_str().unwrap(),
        dataset.epoch.as_ref().unwrap().sha256
    );
    assert_eq!(
        reference["conflictingRecordsExcluded"].as_u64().unwrap() as usize,
        dataset.epoch.as_ref().unwrap().conflicts_excluded
    );
    for id in ["general", "coding", "reasoning", "agents", "knowledge"] {
        let expected = if id == "general" {
            reference["general"].as_array().unwrap()
        } else {
            reference["scenarios"][id].as_array().unwrap()
        };
        let entries = &ranking(&board, id).entries;
        assert_eq!(entries.len(), expected.len(), "{id} reference roster");
        for row in expected {
            let model = row["modelId"].as_str().unwrap();
            let actual = entries
                .iter()
                .find(|e| e.model_id == model)
                .expect("reference model present");
            let score = row["score"].as_f64().unwrap();
            assert!(
                (actual.score - score).abs() < 0.0001,
                "{id} {model}: {} vs {score}",
                actual.score
            );
            if id != "general" {
                assert!(actual.setting == row["profile"].as_str().unwrap());
                assert_eq!(
                    actual.benchmark_count,
                    row["benchmarks"].as_u64().unwrap() as usize
                );
            }
            reconciled.push(serde_json::json!({"board":id,"model":model,"expected":score,"actual":actual.score,"profileId":actual.profile_id}));
        }
    }
    for row in golden["cases"].as_array().unwrap() {
        let source = row["board"].as_str().unwrap();
        let id = row["modelId"].as_str().unwrap();
        let expected = row["score"].as_f64().unwrap();
        let entry = ranking(&board, source)
            .entries
            .iter()
            .find(|e| e.model_id == id)
            .expect("golden model present");
        assert!(
            (entry.score - expected).abs() < 0.005,
            "{source} {id}: {} vs {expected}",
            entry.score
        );
        if let Some(setting) = row["setting"].as_str() {
            assert_eq!(entry.setting, setting);
        }
        reconciled.push(serde_json::json!({"board":source,"model":id,"expected":expected,"actual":entry.score,"profileId":entry.profile_id}));
    }
    let top: Vec<_> = ranking(&board, "aa")
        .entries
        .iter()
        .take(5)
        .map(|e| e.model_id.as_str())
        .collect();
    assert_eq!(
        top,
        vec![
            "gemini4carbon",
            "claudeopus55",
            "gpt6astra",
            "gpt61sol",
            "claudesonnet55"
        ]
    );
    for entry in &ranking(&board, "aa").entries {
        let profile = dataset
            .profiles
            .iter()
            .find(|p| p.id == entry.profile_id)
            .unwrap();
        assert_eq!(entry.score, profile.index);
    }
    assert_eq!(
        dataset
            .sources
            .iter()
            .find(|s| s.id == "livebench")
            .unwrap()
            .weights["LiveBench Long Agentic"],
        2.
    );
    for r in board.rankings.iter().take(7) {
        println!(
            "BOARD {}: {} models; first {:?}",
            r.id,
            r.entries.len(),
            r.entries
                .iter()
                .take(3)
                .map(|e| (&e.model_id, e.score, e.rank))
                .collect::<Vec<_>>()
        );
    }
    fs::write(
        audit.join("reconciliation.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"passed":true,"algorithm":board.algorithm,"cases":reconciled}),
        )
        .unwrap(),
    )
    .unwrap();
    fs::write(
        audit.join("board.json"),
        serde_json::to_vec_pretty(&board).unwrap(),
    )
    .unwrap();
    if std::env::args().any(|a| a == "--write-seed") {
        fs::write(
            root.join("data/benchmarks.json"),
            serde_json::to_vec_pretty(&dataset).unwrap(),
        )
        .unwrap();
    }
    println!(
        "PASS source-native golden reconciliation and every AA displayed score/profile identity"
    );
}

fn scenario_math_checks() {
    use benchmarks::epoch::{Curve, Record};
    let curves: Vec<_> = [
        ("easy", 100., 0.05),
        ("middle", 140., 0.08),
        ("hard", 175., 0.1),
    ]
    .into_iter()
    .map(|(name, difficulty, slope)| Curve {
        name: name.into(),
        difficulty,
        slope,
        baseline: 0.,
        ceiling: 1.,
        superseded_by: String::new(),
    })
    .collect();
    let curve_map: BTreeMap<_, _> = curves.iter().map(|c| (c.name.as_str(), c)).collect();
    let mut records: Vec<_> = curves
        .iter()
        .map(|c| {
            let p = 1. / (1. + (-c.slope * (153. - c.difficulty)).exp());
            Record {
                model_id: "fixture".into(),
                configuration: "fixture_max".into(),
                benchmark: c.name.clone(),
                raw: p,
                normalized: p,
                evaluator: "fixture".into(),
                url: "https://example.org".into(),
            }
        })
        .collect();
    let rows: Vec<_> = records.iter().collect();
    let (score, error) = benchmarks::epoch::fit(&rows, &curve_map).unwrap();
    assert!(
        (score - 153.).abs() < 1e-5 && error < 1e-7,
        "known latent capability must be recovered"
    );
    for row in &mut records {
        row.normalized = 1.;
    }
    assert!(
        benchmarks::epoch::fit(&records.iter().collect::<Vec<_>>(), &curve_map).is_none(),
        "saturated scores cannot imply a finite capability"
    );
    for row in &mut records {
        row.normalized = 0.;
    }
    assert!(benchmarks::epoch::fit(&records.iter().collect::<Vec<_>>(), &curve_map).is_none());
    assert!(benchmarks::epoch::fit(&[], &curve_map).is_none());
    println!("PASS known difficulty/slope recovery, zero/one saturation, missing evidence and finite-fit boundaries");
}
