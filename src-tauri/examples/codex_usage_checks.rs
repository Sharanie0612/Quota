//! Synthetic Codex rollover, cursor migration and mixed-version sync checks.
use quota_lib::activity::{self, Cursor, Metric, Tokens};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

const DEVICE: &str = "00000000-0000-4000-8000-000000000001";
fn row(at: i64, kind: &str, payload: Value) -> Value {
    json!({"timestamp":chrono::DateTime::from_timestamp_millis(at).unwrap().to_rfc3339(),"type":kind,"payload":payload})
}
fn counters(input: u64, cached: u64, output: u64, reasoning: u64) -> Value {
    json!({"input_tokens":input,"cached_input_tokens":cached,"output_tokens":output,
        "reasoning_output_tokens":reasoning,"cache_write_input_tokens":0,"total_tokens":input+output})
}
fn count(at: i64, total: Value, last: Value) -> Value {
    row(
        at,
        "event_msg",
        json!({"type":"token_count","info":{"total_token_usage":total,"last_token_usage":last}}),
    )
}
fn cursor(at: i64) -> Cursor {
    let mut c = Cursor::default();
    activity::parse_codex(
        &row(
            at,
            "session_meta",
            json!({"id":"resumed-thread","session_id":null}),
        ),
        &mut c,
        DEVICE,
    );
    activity::parse_codex(
        &row(at, "turn_context", json!({"model":"regression-model"})),
        &mut c,
        DEVICE,
    );
    c
}
fn settings(dir: &Path, home: &Path) {
    fs::create_dir_all(dir).unwrap();
    let mut o = activity::options(dir);
    o.device_id = DEVICE.into();
    o.device_name = "regression".into();
    o.codex_home = home.to_string_lossy().into();
    o.zcode_home = dir.join("absent-zcode").to_string_lossy().into();
    o.harness_home.clear();
    o.trae_enabled = false;
    o.codex_ssh_host.clear();
    o.codex_ssh_devices = Some(vec![]);
    o.sync_accounts = false;
    o.sync_dir.clear();
    activity::save_options(dir, &o).unwrap();
}
fn total(dir: &Path) -> u64 {
    activity::report(dir, None, Some("codex".into()), None)
        .unwrap()
        .totals
        .tokens
        .total
}
fn read(db: &Connection, id: &str) -> Metric {
    let body: String = db
        .query_row("SELECT body FROM metrics WHERE id=?1", [id], |r| r.get(0))
        .unwrap();
    serde_json::from_str(&body).unwrap()
}
fn parser_checks(at: i64) {
    let mut c = cursor(at);
    let first = count(
        at + 1,
        counters(120_000_000, 98_000_000, 1_000_000, 400_000),
        counters(60_000, 12_000, 200, 0),
    );
    let event = activity::parse_codex(&first, &mut c, DEVICE).unwrap();
    assert_eq!(event.tokens.total, 60_200);
    assert_eq!(event.tokens.cached, 12_000);
    assert_eq!(event.tokens.output, 200);
    assert_eq!(event.codex_usage_version, 1);
    let mut repeat = first.clone();
    repeat["timestamp"] = row(at + 2, "", json!({}))["timestamp"].clone();
    assert!(activity::parse_codex(&repeat, &mut c, DEVICE).is_none());
    let second = count(
        at + 3,
        counters(120_070_000, 98_064_000, 1_000_800, 400_500),
        counters(70_000, 64_000, 800, 500),
    );
    assert_eq!(
        activity::parse_codex(&second, &mut c, DEVICE)
            .unwrap()
            .tokens
            .total,
        70_800
    );
    // An actual large increment is retained; no arbitrary spike threshold.
    let large = count(
        at + 4,
        counters(130_070_000, 98_064_000, 1_000_800, 400_500),
        counters(1, 0, 0, 0),
    );
    assert_eq!(
        activity::parse_codex(&large, &mut c, DEVICE)
            .unwrap()
            .tokens
            .total,
        10_000_000
    );
    // Reset/compaction uses the explicit last request, never the old baseline.
    let reset = count(
        at + 5,
        counters(900, 500, 100, 50),
        counters(80, 40, 20, 10),
    );
    assert_eq!(
        activity::parse_codex(&reset, &mut c, DEVICE)
            .unwrap()
            .tokens
            .total,
        100
    );
    let mut legacy = cursor(at);
    assert_eq!(
        activity::parse_codex(
            &count(at + 1, counters(100, 50, 20, 10), Value::Null),
            &mut legacy,
            DEVICE
        )
        .unwrap()
        .tokens
        .total,
        120
    );
    assert_eq!(
        activity::parse_codex(
            &count(at + 2, counters(200, 50, 20, 10), Value::Null),
            &mut legacy,
            DEVICE
        )
        .unwrap()
        .tokens
        .total,
        100
    );
    // An explicit zero request must replace a legacy inflated event with zero.
    let mut zero = cursor(at);
    assert_eq!(
        activity::parse_codex(
            &count(at + 1, counters(1000, 500, 100, 50), counters(0, 0, 0, 0)),
            &mut zero,
            DEVICE
        )
        .unwrap()
        .tokens
        .total,
        0
    );
    println!("PASS synthetic resumed-rollout counter baseline, repeated notifications, ordinary/large deltas, counter reset, legacy fields and zero correction");
}
fn migration_checks(root: &Path, at: i64) {
    let home = root.join("logs");
    fs::create_dir_all(home.join("sessions")).unwrap();
    let dir = root.join("upgrade");
    settings(&dir, &home);
    let first = count(
        at + 1,
        counters(120_000_000, 98_000_000, 1_000_000, 400_000),
        counters(60_000, 12_000, 200, 0),
    );
    let second = count(
        at + 2,
        counters(120_070_000, 98_064_000, 1_000_800, 400_500),
        counters(70_000, 64_000, 800, 500),
    );
    let rows = [
        row(at, "session_meta", json!({"id":"resumed-thread"})),
        row(at, "turn_context", json!({"model":"regression-model"})),
        first.clone(),
        second,
    ];
    let bytes = rows
        .iter()
        .map(|r| r.to_string() + "\n")
        .collect::<String>();
    let log = home.join("sessions/resumed.jsonl");
    fs::write(&log, &bytes).unwrap();
    total(&dir);
    let db = Connection::open(dir.join("activity.sqlite")).unwrap();
    let mut c = Cursor::default();
    let mut ids = vec![];
    for row in &rows {
        if let Some(mut event) = activity::parse_codex(row, &mut c, DEVICE) {
            ids.push(event.id.clone());
            event.codex_usage_version = 0;
            if ids.len() == 1 {
                event.tokens = Tokens {
                    input: 120_000_000,
                    cached: 98_000_000,
                    output: 1_000_000,
                    reasoning: 400_000,
                    total: 121_000_000,
                    ..Default::default()
                };
            }
            activity::merge_metric(&db, &event, true).unwrap();
        }
    }
    // This is a fully consumed old-version cursor, not an empty fresh database.
    c.offset = bytes.len() as u64;
    c.speed.version = 1;
    c.usage_version = 0;
    db.execute(
        "INSERT INTO cursors(path,body) VALUES(?1,?2)",
        params![log.to_string_lossy(), serde_json::to_string(&c).unwrap()],
    )
    .unwrap();
    let old_packets = activity::cloud_packets(&dir).unwrap();
    assert_eq!(total(&dir), 121_070_800);
    assert!(activity::collect(&dir).unwrap() >= 2);
    assert_eq!(total(&dir), 131_000);
    assert_eq!(read(&db, &ids[0]).tokens.total, 60_200);
    assert_eq!(read(&db, &ids[0]).codex_usage_version, 1);
    assert_eq!(activity::collect(&dir).unwrap(), 0);
    assert_eq!(fs::read_to_string(&log).unwrap(), bytes);
    // Copies under a different/archived path converge on the original IDs.
    fs::create_dir_all(home.join("archived_sessions")).unwrap();
    fs::write(home.join("archived_sessions/copy.jsonl"), &bytes).unwrap();
    activity::collect(&dir).unwrap();
    assert_eq!(total(&dir), 131_000);
    let pending: i64 = db
        .query_row("SELECT COUNT(*) FROM outbox", [], |r| r.get(0))
        .unwrap();
    assert_eq!(pending, 2);
    let new_packets = activity::cloud_packets(&dir).unwrap();
    for old_first in [false, true] {
        let peer = root.join(if old_first {
            "peer-old-first"
        } else {
            "peer-new-first"
        });
        settings(&peer, &root.join("no-logs"));
        let batches = if old_first {
            [&old_packets, &new_packets]
        } else {
            [&new_packets, &old_packets]
        };
        for packets in batches {
            for (_, packet) in packets {
                activity::import_cloud_packet(&peer, packet.as_bytes()).unwrap();
            }
        }
        assert_eq!(total(&peer), 131_000);
        for (_, packet) in &old_packets {
            assert_eq!(
                activity::import_cloud_packet(&peer, packet.as_bytes()).unwrap(),
                0
            );
        }
        // An old client drops the unknown parser marker but can retain generic
        // revision while max-merging the old inflated amount. Reject that relay.
        let legacy: Value = serde_json::from_str(&old_packets[0].1).unwrap();
        let mut relay: Value = serde_json::from_str(&new_packets[0].1).unwrap();
        for event in relay["events"].as_array_mut().unwrap() {
            event.as_object_mut().unwrap().remove("codexUsageVersion");
            event["revision"] = json!(9);
            event["tokens"] = legacy["events"]
                .as_array()
                .unwrap()
                .iter()
                .find(|old| old["id"] == event["id"])
                .unwrap()["tokens"]
                .clone();
        }
        assert_eq!(
            activity::import_cloud_packet(&peer, &serde_json::to_vec(&relay).unwrap()).unwrap(),
            0
        );
        assert_eq!(total(&peer), 131_000);
    }
    // Zero corrections and invalid old speed metadata cannot restore inflation.
    let mut old = read(&db, &ids[0]);
    old.id = format!("{:064x}", 999);
    old.codex_usage_version = 0;
    old.tokens = Tokens {
        input: 120_000_000,
        cached: 98_000_000,
        output: 1_000_000,
        reasoning: 400_000,
        total: 121_000_000,
        ..Default::default()
    };
    activity::merge_metric(&db, &old, true).unwrap();
    let mut zero = old.clone();
    zero.codex_usage_version = 1;
    zero.tokens = Tokens::default();
    zero.speed = None;
    activity::merge_metric(&db, &zero, true).unwrap();
    activity::merge_metric(&db, &old, false).unwrap();
    assert_eq!(read(&db, &old.id).tokens.total, 0);
    let mut corrected = read(&db, &ids[0]);
    corrected.id = format!("{:064x}", 1000);
    corrected.speed=serde_json::from_value(json!({"requestId":"f".repeat(64),"startedAt":at-2000,"completedAt":at-1000,"durationMs":1000,"outputTokens":200,"method":"codex-stream-v1"})).unwrap();
    let mut inflated = corrected.clone();
    inflated.codex_usage_version = 0;
    inflated.tokens = old.tokens.clone();
    inflated.speed.as_mut().unwrap().request_id = "0".repeat(64);
    inflated.speed.as_mut().unwrap().output_tokens = 400_000;
    activity::merge_metric(&db, &inflated, true).unwrap();
    activity::merge_metric(&db, &corrected, true).unwrap();
    assert_eq!(read(&db, &corrected.id).speed.unwrap().output_tokens, 200);
    println!("PASS consumed-cursor upgrade, stable IDs, in-place decrease, repeat/archived scans, correction outbox and both orders of old/new cloud replay");
}
fn main() {
    assert_eq!(std::env::args_os().len(), 1);
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/codex-usage-checks")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    let at = chrono::Utc::now().timestamp_millis() - 60_000;
    parser_checks(at);
    migration_checks(&root, at);
}
