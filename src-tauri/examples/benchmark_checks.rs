use quota_lib::benchmarks::{self, Dataset, Observation, Source};
use std::{fs, path::Path};
fn fixture() -> Dataset {
    let mut observations = Vec::new();
    for model in 0..8 {
        for source in ["artificial-analysis", "livebench"] {
            for domain in ["reasoning", "coding", "knowledge", "research", "agents"] {
                observations.push(Observation {
                    model_id: format!("model{model}"),
                    model_name: format!("Model {model}"),
                    vendor: "Fixture".into(),
                    source_id: source.into(),
                    metric: format!("{source}-{domain}"),
                    family: domain.into(),
                    version: "fixture-v1".into(),
                    domain: domain.into(),
                    setting: "fixture".into(),
                    value: model as f64 * 10.,
                    unit: "percent".into(),
                    weight: 1.,
                    official: false,
                    url: "https://example.invalid/fixture".into(),
                    checked_at: "2026-10-28T00:00:00Z".into(),
                });
            }
        }
    }
    Dataset {
        schema: 1,
        sources: ["artificial-analysis", "livebench"]
            .into_iter()
            .map(|id| Source {
                id: id.into(),
                name: id.into(),
                url: "https://example.invalid".into(),
                version: "fixture-v1".into(),
                checked_at: "2026-10-28T00:00:00Z".into(),
                records: 40,
                error: None,
                automatic: true,
            })
            .collect(),
        observations,
        profiles: vec![],
    }
}
fn main() {
    let data = fixture();
    let board = benchmarks::calculate(&data);
    assert_eq!(board.models[0].score, Some(100.));
    assert_eq!(board.models[0].rank, Some(1));
    assert_eq!(board.models.last().unwrap().score, Some(0.));
    let mut reversed = data.clone();
    reversed.observations.reverse();
    assert_eq!(
        serde_json::to_value(&board).unwrap(),
        serde_json::to_value(benchmarks::calculate(&reversed)).unwrap()
    );
    let mut duplicate = data.clone();
    duplicate.observations.extend(data.observations.clone());
    assert_eq!(
        board.models.iter().map(|m| m.score).collect::<Vec<_>>(),
        benchmarks::calculate(&duplicate)
            .models
            .iter()
            .map(|m| m.score)
            .collect::<Vec<_>>()
    );
    let mut missing = data.clone();
    missing
        .observations
        .retain(|o| o.model_id != "model7" || o.domain != "coding");
    let model = benchmarks::calculate(&missing)
        .models
        .into_iter()
        .find(|m| m.id == "model7")
        .unwrap();
    assert_eq!(model.coverage, 80.);
    assert_eq!(model.score, Some(100.));
    let mut official = data.clone();
    official.sources.push(Source {
        id: "official-openai".into(),
        name: "Fixture official".into(),
        url: "https://example.invalid".into(),
        version: "v1".into(),
        checked_at: "2026-10-28T00:00:00Z".into(),
        records: 8,
        error: None,
        automatic: false,
    });
    for index in 0..8 {
        let mut row = data
            .observations
            .iter()
            .find(|o| o.model_id == format!("model{index}") && o.domain == "coding")
            .unwrap()
            .clone();
        row.source_id = "official-openai".into();
        row.metric = "official-coding".into();
        row.official = true;
        row.value = 70. - index as f64 * 10.;
        official.observations.push(row);
    }
    let official_board = benchmarks::calculate(&official);
    let best = official_board
        .models
        .iter()
        .find(|m| m.id == "model7")
        .unwrap();
    assert_eq!(best.domains["coding"], 80.);
    assert_eq!(
        best.score,
        Some(96.),
        "official evidence affects at most 4 points with one of five domains"
    );
    let failed = benchmarks::merge(
        data.clone(),
        vec![("livebench".into(), Err("fixture offline".into()))],
    );
    assert_eq!(failed.observations.len(), data.observations.len());
    assert_eq!(
        failed
            .sources
            .iter()
            .find(|s| s.id == "livebench")
            .unwrap()
            .error
            .as_deref(),
        Some("fixture offline")
    );
    assert_ne!(
        benchmarks::identity("GPT-6.1 Terra"),
        benchmarks::identity("GPT-6 Terra")
    );
    assert_ne!(
        benchmarks::identity("Claude Opus 5"),
        benchmarks::identity("Claude Opus 5.5")
    );
    let mut one = data.clone();
    let mut tied = data.clone();
    for row in &mut tied.observations {
        row.value = 10.;
    }
    let tied = benchmarks::calculate(&tied);
    assert!(tied
        .models
        .iter()
        .all(|m| m.score == Some(50.) && m.rank == Some(1)));
    let mut noise = data.clone();
    let mut other = data
        .observations
        .iter()
        .find(|o| o.source_id == "artificial-analysis")
        .unwrap()
        .clone();
    other.model_id = "unpaired-outlier".into();
    other.model_name = "Unpaired outlier".into();
    other.value = 1e3;
    noise.observations.push(other);
    let noise = benchmarks::calculate(&noise);
    for model in &board.models {
        assert_eq!(
            model.score,
            noise
                .models
                .iter()
                .find(|m| m.id == model.id)
                .unwrap()
                .score
        );
    }
    assert_ne!(
        benchmarks::identity("Qwen3.8 Max (0902)"),
        benchmarks::identity("Qwen3.8 Max (0903)")
    );
    assert_ne!(
        benchmarks::identity("GPT-5.5 Instant (June 2026)"),
        benchmarks::identity("GPT-5.5 Instant")
    );
    assert_eq!(
        benchmarks::identity("GPT-6.1 Terra (Max)"),
        benchmarks::identity("GPT-6.1 Terra")
    );
    one.observations.retain(|o| o.source_id != "livebench");
    let board = benchmarks::calculate(&one);
    assert!(
        board.models.is_empty(),
        "no common cohort means no invented normalized score"
    );
    println!("PASS reference cohort, monotonic ranking, permutation and duplicate invariance, missing-domain renormalization and insufficient-evidence handling");
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let audit = root.join("../target/benchmark-sources");
    let checked = fs::read_to_string(audit.join("sources.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["checkedAt"].as_str().map(String::from))
        .unwrap_or_else(|| "2026-10-28T00:00:00Z".into());
    if std::env::args().any(|a| a == "--fixtures" || a == "--write-seed" || a == "--live") {
        let aa_html = fs::read_to_string(audit.join("artificial-analysis.html")).unwrap();
        assert!(
            benchmarks::parse_aa(&aa_html.replace("Index v5.0", "Index v6.0"), &checked).is_err(),
            "new index versions must fail closed"
        );
        let categories =
            fs::read_to_string(audit.join("livebench-current-categories.json")).unwrap();
        let table = fs::read_to_string(audit.join("livebench-current-table.csv")).unwrap();
        assert!(benchmarks::parse_livebench(
            &table.replace("reasoning", "reasoning_v3"),
            &categories,
            "20261025",
            &checked
        )
        .is_err());
        let aa = benchmarks::parse_aa(
            &fs::read_to_string(audit.join("artificial-analysis.html")).unwrap(),
            &checked,
        )
        .unwrap();
        let release = fs::read_to_string(audit.join("livebench-release.txt")).unwrap();
        let lb = benchmarks::parse_livebench(
            &fs::read_to_string(audit.join("livebench-current-table.csv")).unwrap(),
            &fs::read_to_string(audit.join("livebench-current-categories.json")).unwrap(),
            release.trim(),
            &checked,
        )
        .unwrap();
        let mut dataset = benchmarks::merge(
            Dataset {
                schema: 1,
                ..Default::default()
            },
            vec![
                ("artificial-analysis".into(), Ok(aa)),
                ("livebench".into(), Ok(lb)),
            ],
        );
        let evidence: serde_json::Value =
            serde_json::from_str(include_str!("../data/official-benchmark-evidence.json")).unwrap();
        let rows = evidence["records"].as_array().unwrap();
        let official_checked = evidence["checkedAt"].as_str().unwrap().to_string();
        dataset.sources.push(Source {
            id: "official-openai".into(),
            name: "OpenAI 官方报告".into(),
            url: "https://openai.com/index/introducing-gpt-6-1-terra/".into(),
            version: "Terminal-Bench 4.0 · 厂商公开设置".into(),
            checked_at: official_checked.clone(),
            records: rows.len(),
            error: None,
            automatic: false,
        });
        for row in rows {
            let name = row["model"].as_str().unwrap();
            dataset.observations.push(Observation {
                model_id: benchmarks::identity(name),
                model_name: name.into(),
                vendor: row["vendor"].as_str().unwrap().into(),
                source_id: "official-openai".into(),
                metric: "Terminal-Bench 4.0 · 官网自报".into(),
                family: "terminalbench-v4".into(),
                version: "OpenAI-research-harness/TerminalBench4".into(),
                domain: "coding".into(),
                setting: row["setting"].as_str().unwrap().into(),
                value: row["score"].as_f64().unwrap(),
                unit: "percent".into(),
                weight: 1.,
                official: true,
                url: row["url"].as_str().unwrap().into(),
                checked_at: official_checked.clone(),
            });
        }
        let anthropic: Dataset =
            serde_json::from_str(include_str!("../data/official-anthropic-benchmarks.json"))
                .unwrap();
        dataset = benchmarks::merge(dataset, vec![("official-anthropic".into(), Ok(anthropic))]);
        if std::env::args().any(|a| a == "--live") {
            let runtime = tokio::runtime::Runtime::new().unwrap();
            let client = reqwest::Client::builder().build().unwrap();
            let updates = runtime.block_on(benchmarks::fetch(&client));
            for (id, result) in &updates {
                assert!(result.is_ok(), "live {id}: {:?}", result.as_ref().err());
                println!(
                    "LIVE {id}: {} observations",
                    result.as_ref().unwrap().observations.len()
                );
            }
            dataset = benchmarks::merge(dataset, updates);
        }
        assert!(benchmarks::valid(&dataset));
        let board = benchmarks::calculate(&dataset);
        assert!(board.models.iter().any(|m|m.contributions.iter().any(|c|c.official)),"verified official evidence participates when the common reference cohort is sufficient");
        assert!(board.models.iter().filter(|m| !m.provisional).count() >= 10);
        assert!(board.reference_cohort.len() >= 15);
        for model in board.models.iter().take(8) {
            println!(
                "MODEL {}: {:?}, {} sources, {}% coverage",
                model.name, model.score, model.independent_sources, model.coverage
            );
        }
        println!("PASS source adapters: {} observations, {} profiles, {} reference models, {} ranked models",dataset.observations.len(),dataset.profiles.len(),board.reference_cohort.len(),board.models.iter().filter(|m|!m.provisional).count());
        if std::env::args().any(|a| a == "--write-seed") {
            fs::write(
                root.join("data/benchmarks.json"),
                serde_json::to_vec_pretty(&dataset).unwrap(),
            )
            .unwrap();
        }
        fs::write(
            audit.join("board.json"),
            serde_json::to_vec_pretty(&board).unwrap(),
        )
        .unwrap();
    }
}
