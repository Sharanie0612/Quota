//! Exercise the public report entry point with a deterministic, synthetic history.
use chrono::{Local, TimeZone};
use quota_lib::activity::{self, sources::Filters};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::Instant};

const DEVICE: &str = "11111111-1111-4111-8111-111111111111";
const ROWS: usize = 30_000;
// Ten complete reports from the public entry point before the single-pass rewrite.
const EXPECTED_DIGEST: &str = "40d8a275c934826abf953585c31de545c1c6134e71136ebe379c9b53937d8cff";

fn seed(dir: &Path) {
    let options = serde_json::from_value(json!({
        "deviceId": DEVICE, "deviceName": "fixture", "autoCollect": false,
        "codexHome": "", "zcodeHome": "", "syncDir": "", "codexSshDevices": []
    }))
    .unwrap();
    activity::save_options(dir, &options).unwrap();
    assert_eq!(
        activity::report(dir, None, None, None).unwrap().totals.key,
        ""
    );
    let mut db = Connection::open(dir.join("activity.sqlite")).unwrap();
    let transaction = db.transaction().unwrap();
    let mut insert = transaction
        .prepare("INSERT INTO metrics(id,body) VALUES(?1,?2)")
        .unwrap();
    for i in 0..ROWS {
        let (source, model) = [
            ("codex", "gpt-fixture"),
            ("trae", "gpt-fixture"),
            ("zcode", "glm-fixture"),
            ("claude", "claude-fixture"),
        ][i % 4];
        let tool = i % 7 == 0;
        let amount = if tool { 0 } else { 10 };
        let id = format!("{i:064x}");
        let date = Local
            .with_ymd_and_hms(2020, 1, 1 + (i % 20) as u32, (i % 24) as u32, 0, 0)
            .unwrap();
        let mut body = json!({
            "id":id, "device":DEVICE, "source":source, "model":model,
            "session":format!("session-{}", (i / 4) % 160), "agent":"main",
            "kind":if tool {"tool"} else {"tokens"}, "tool":if tool {"read"} else {""},
            "timestamp":date.timestamp_millis(), "tokens":{
                "input":amount,"output":amount,"cached":amount/2,"cacheWrite":0,"reasoning":0,"total":2*amount
            },
            "channel":if source == "trae" { ["api","trae",""][(i / 4) % 3] } else { "" },
            "multica":source == "codex" && i % 8 == 0,
            "revision":if source == "zcode" && i % 11 == 0 { 2 } else { 0 }
        });
        if source == "claude" {
            body["origin"] = json!({"software":"claude","launcher":"direct","environment":DEVICE,"access":"api","cacheKnown":false});
        }
        insert.execute(params![id, body.to_string()]).unwrap();
    }
    drop(insert);
    transaction.commit().unwrap();
}

fn main() {
    let temp = std::env::temp_dir().canonicalize().unwrap();
    let dir = temp.join(format!("quota-report-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    seed(&dir);
    let mut fingerprint = Sha256::new();
    for (source, model, filter) in [
        ("", "", json!({})),
        ("without-trae", "", json!({})),
        ("multica", "", json!({})),
        ("", "model:gpt-fixture", json!({})),
        ("", "channel:api", json!({})),
        ("", "gpt-fixture\u{1f}unknown", json!({})),
        ("", "vendor:trae", json!({})),
        (
            "",
            "vendor:custom",
            json!({"launcher":"multica","environment":DEVICE}),
        ),
        (
            "",
            "",
            json!({"access":"api","vendor":"anthropic","software":"claude"}),
        ),
        ("", "no-such-model", json!({})),
    ] {
        let all = source.is_empty() && model.is_empty() && filter == json!({});
        let filters: Filters = serde_json::from_value(filter).unwrap();
        let report = activity::report_workspace(
            &dir,
            None,
            Some(source.into()),
            None,
            Some(model.into()),
            if all { None } else { Some("2020-01-02".into()) },
            if all { None } else { Some("2020-01-17".into()) },
            filters,
        )
        .unwrap();
        let total = report.totals.tokens.total;
        assert_eq!(
            report.daily.iter().map(|g| g.tokens.total).sum::<u64>(),
            total
        );
        assert_eq!(
            report.details.iter().map(|g| g.calls).sum::<u64>(),
            report.totals.calls
        );
        assert_eq!(
            report.models.iter().map(|g| g.tokens.input).sum::<u64>(),
            report.coverage.all_input
        );
        if all {
            assert_eq!(report.totals.sessions, 4 * 160);
            assert!(report.coverage.known_cache_input < report.coverage.all_input);
            assert_eq!(report.channels.len(), 3);
        }
        if model == "no-such-model" {
            assert_eq!(total, 0);
            assert!(!report.available_models.is_empty());
            assert!(!report.facets.softwares.is_empty());
        }
        let canonical: Value = serde_json::to_value(report).unwrap();
        fingerprint.update(serde_json::to_vec(&canonical).unwrap());
    }
    let mut timings = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        let report = activity::report(&dir, None, None, None).unwrap();
        timings.push(start.elapsed().as_millis());
        std::hint::black_box(report);
    }
    timings.sort_unstable();
    let fixture = dir.canonicalize().unwrap();
    assert_eq!(fixture.parent(), Some(temp.as_path()));
    fs::remove_dir_all(fixture).unwrap();
    let digest = format!("{:x}", fingerprint.finalize());
    assert_eq!(
        digest, EXPECTED_DIGEST,
        "the serialized activity reports changed"
    );
    println!(
        "rows={ROWS} cases=10 sha256={digest} median_ms={} samples_ms={timings:?}",
        timings[2]
    );
}
