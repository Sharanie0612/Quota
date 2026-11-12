//! Artificial Analysis Free endpoint contract and local fallback.
use chrono::Utc;
use quota_lib::{
    benchmarks,
    task_cost::{load_snapshot, Origin, Pages},
};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

fn row(id: &str, score: Option<f64>, task_cost: Option<f64>) -> Value {
    json!({
        "id": id,
        "slug": "shared-name",
        "name": "Example Model",
        "release_date": "2026-11-12",
        "model_creator": {"id": "fixture-lab", "name": "Fixture Lab"},
        "evaluations": {"artificial_analysis_intelligence_index": score, "artificial_analysis_coding_index": 99},
        "artificial_analysis_intelligence_index_cost": {
            "total_cost": 12345,
            "cost_per_task": {"total_cost": task_cost}
        },
        "pricing": {"price_1m_input_tokens": 7, "price_1m_output_tokens": 42}
    })
}

fn page(version: f64, page: usize, total_pages: usize, data: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "tier": "free",
        "intelligence_index_version": version,
        "pagination": {"page": page, "page_size": 200, "total_pages": total_pages, "has_more": page < total_pages},
        "data": data
    })).unwrap()
}

fn main() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/task-cost-checks")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&dir).unwrap();
    let historical = benchmarks::load(&dir);
    let old = load_snapshot(&dir, &historical).unwrap();
    assert_eq!(old.origin, Origin::Historical);
    assert!(old.models.len() > 50);
    assert!(old.models.iter().any(|model| model.cost_per_task.is_none()));
    for model in &old.models {
        let original = historical
            .profiles
            .iter()
            .find(|profile| profile.id == model.id)
            .unwrap();
        assert_eq!(model.index, original.index);
        assert_eq!(
            model.cost_per_task,
            original.cost.filter(|cost| *cost > 0.0)
        );
    }

    let first = page(
        6.1,
        1,
        2,
        vec![
            row("standard", Some(41.2), Some(0.0837)),
            row("provisional", Some(49.0), None),
            row("cost-zero", Some(0.0), Some(0.0)),
            row("not-evaluated", None, Some(0.01)),
        ],
    );
    let last = page(6.1, 2, 2, vec![row("new-config", Some(52.7), Some(5.0093))]);
    let mut partial = Pages::default();
    assert!(partial.ingest(&first).unwrap());
    assert!(partial.finish(Utc::now()).is_err());
    for bad_page in [
        page(6.0, 2, 2, vec![row("new-config", Some(52.7), Some(5.0093))]),
        page(6.1, 2, 2, vec![row("standard", Some(52.7), Some(5.0093))]),
        page(6.1, 2, 3, vec![row("new-config", Some(52.7), Some(5.0093))]),
        page(6.1, 1, 2, vec![row("new-config", Some(52.7), Some(5.0093))]),
    ] {
        let mut pages = Pages::default();
        assert!(pages.ingest(&first).unwrap());
        assert!(pages.ingest(&bad_page).is_err());
    }
    let mut no_cost = Pages::default();
    assert!(!no_cost
        .ingest(&page(6.1, 1, 1, vec![row("unpriced", Some(12.0), None)]))
        .unwrap());
    assert!(no_cost.finish(Utc::now()).is_err());

    let mut pages = Pages::default();
    assert!(pages.ingest(&first).unwrap());
    assert!(!pages.ingest(&last).unwrap());
    let next = pages.finish(Utc::now()).unwrap();
    assert_eq!(next.index_version, "6.1");
    assert_eq!(next.models.len(), 4);
    assert_eq!(next.models[0].cost_per_task, Some(0.0837));
    assert_eq!(next.models[1].cost_per_task, None);
    assert_eq!(next.models[2].index, 0.0);
    assert_eq!(next.models[2].cost_per_task, None);
    assert_eq!(next.models[3].id, "new-config");
    assert_eq!(next.models[3].index, 52.7);
    assert_eq!(next.models[3].cost_per_task, Some(5.0093));
    assert_eq!(
        next.models[3].release_date.unwrap().to_string(),
        "2026-11-12"
    );

    let path = dir.join("aa-task-cost.json");
    fs::write(&path, "{incomplete").unwrap();
    assert_eq!(
        load_snapshot(&dir, &historical).unwrap().origin,
        Origin::Historical
    );
    let json = serde_json::to_string(&next).unwrap();
    assert!(!json.contains("price_1m_input_tokens") && !json.contains("12345"));
    fs::write(&path, json).unwrap();
    let reloaded = load_snapshot(&dir, &historical).unwrap();
    assert_eq!(reloaded.origin, Origin::Api);
    assert_eq!(reloaded.checked_at, next.checked_at);
    assert_eq!(reloaded.models[3].cost_per_task, Some(5.0093));
    println!("PASS exact USD/task and index, complete pagination, new configuration, omitted data, legacy fallback and restart");
    println!("Fixture: {}", path.display());
}
