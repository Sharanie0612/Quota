//! Isolated collector regression. --live reads the real workspace layout
//! into a new metrics directory and leaves the source logs and Quota data alone.
use quota_lib::activity::{self, Options, Report};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const WORKSPACE: &str = "demo-workspace-56d1fcbb4dcf";

fn event(at: i64, kind: &str, payload: Value) -> Value {
    json!({
        "timestamp": chrono::DateTime::from_timestamp_millis(at).unwrap().to_rfc3339(),
        "type": kind,
        "payload": payload,
    })
}

fn counters(input: u64, cached: u64, output: u64, reasoning: u64) -> Value {
    json!({
        "input_tokens": input,
        "cached_input_tokens": cached,
        "output_tokens": output,
        "reasoning_output_tokens": reasoning,
        "total_tokens": input + output,
    })
}

fn usage(at: i64, total: Value, last: Value) -> Value {
    event(
        at,
        "event_msg",
        json!({
            "type": "token_count",
            "info": { "total_token_usage": total, "last_token_usage": last },
        }),
    )
}

fn rollout(at: i64, session: &str, model: &str, events: &[Value]) -> String {
    [
        event(at, "session_meta", json!({ "id": session })),
        event(at, "turn_context", json!({ "model": model })),
    ]
    .iter()
    .chain(events)
    .map(|row| format!("{row}\n"))
    .collect()
}

fn write(path: &Path, data: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, data).unwrap();
}

fn settings(dir: &Path) -> Options {
    fs::create_dir_all(dir).unwrap();
    let mut options = activity::options(dir);
    options.codex_home.clear();
    options.zcode_home = dir.join("absent-zcode").to_string_lossy().into();
    options.auto_collect = false;
    options.sync_accounts = false;
    options.sync_dir.clear();
    options
}

fn report(dir: &Path, source: &str) -> Report {
    activity::report(dir, None, Some(source.into()), None).unwrap()
}

#[cfg(unix)]
use std::os::unix::fs::symlink as symlink_dir;
#[cfg(windows)]
use std::os::windows::fs::symlink_dir;

fn checks(root: &Path, at: i64) {
    let dir = root.join("quota");
    let workspaces = root.join("workspaces");
    let workspace = workspaces.join(WORKSPACE);
    let run = workspace.join("chat-run");
    let run_home = run.join("codex-home");
    let current = run_home.join("sessions/2026/11/08/rollout-resumed.jsonl");
    let codex = root.join(".codex");
    let resumed = rollout(
        at,
        "multica-thread",
        "gpt-multica",
        &[
            usage(
                at + 1,
                counters(10_060, 8_050, 210, 105),
                counters(60, 50, 10, 5),
            ),
            usage(
                at + 2,
                counters(10_170, 8_130, 235, 120),
                counters(110, 80, 25, 15),
            ),
            event(
                at + 3,
                "response_item",
                json!({
                    "type": "function_call",
                    "call_id": "multica-tool",
                    "name": "exec_command",
                    "arguments": "PRIVATE_FIXTURE_CONTENT",
                }),
            ),
        ],
    );
    write(&current, &resumed);

    // Simulate a user who had manually pointed the old collector at one task.
    let mut options = settings(&dir);
    options.codex_home = run_home.to_string_lossy().into();
    activity::save_options(&dir, &options).unwrap();
    let settings_path = dir.join("activity-settings.json");
    let mut old_settings: Value =
        serde_json::from_slice(&fs::read(&settings_path).unwrap()).unwrap();
    old_settings
        .as_object_mut()
        .unwrap()
        .remove("multicaEnabled");
    old_settings
        .as_object_mut()
        .unwrap()
        .remove("multicaWorkspaceRoot");
    fs::write(&settings_path, old_settings.to_string()).unwrap();
    assert_eq!(activity::options(&dir).device_id, options.device_id);
    assert_eq!(activity::collect(&dir).unwrap(), 3);
    assert_eq!(report(&dir, "codex").totals.tokens.total, 205);
    let legacy_packets = activity::cloud_packets(&dir).unwrap();

    let archive = rollout(
        at,
        "archived-thread",
        "gpt-multica",
        &[usage(at + 4, counters(25, 5, 5, 1), Value::Null)],
    );
    write(
        &run_home.join("archived_sessions/rollout-archived.jsonl"),
        &archive,
    );
    let durable = rollout(
        at,
        "store-thread",
        "gpt-store",
        &[usage(at + 5, counters(40, 20, 10, 3), Value::Null)],
    );
    let store = codex.join("multica-sessions/p_profile/agent/issue/2026/11/08");
    write(&store.join("rollout-store.jsonl"), &durable);
    write(&store.join("rollout-copy.jsonl"), &resumed);
    write(&codex.join("sessions/rollout-copy.jsonl"), &resumed);
    let native = rollout(
        at,
        "native-thread",
        "gpt-native",
        &[usage(at + 6, counters(20, 4, 10, 2), Value::Null)],
    );
    write(&codex.join("sessions/rollout-native.jsonl"), &native);

    let unrelated = rollout(
        at,
        "unrelated",
        "gpt-unrelated",
        &[usage(at + 7, counters(400, 5, 20, 1), Value::Null)],
    );
    write(
        &run.join("repo/codex-home/sessions/rollout-repo.jsonl"),
        &unrelated,
    );
    write(&run_home.join("sessions/other.jsonl"), &unrelated);
    let legacy_link = workspace.join("legacy-run/codex-home/sessions");
    fs::create_dir_all(legacy_link.parent().unwrap()).unwrap();
    let link_created = symlink_dir(codex.join("sessions"), &legacy_link).is_ok();

    options.codex_home = codex.to_string_lossy().into();
    options.multica_enabled = true;
    options.multica_workspace_root = workspaces.to_string_lossy().into();
    activity::save_options(&dir, &options).unwrap();
    activity::collect(&dir).unwrap();
    let multica = report(&dir, "multica");
    assert!(multica.errors.is_empty(), "{:?}", multica.errors);
    assert_eq!(multica.totals.tokens.total, 285);
    assert_eq!(multica.totals.tokens.input, 235);
    assert_eq!(multica.totals.tokens.cached, 155);
    assert_eq!(multica.totals.tokens.output, 50);
    assert_eq!(multica.totals.tokens.reasoning, 24);
    assert_eq!(multica.totals.calls, 1);
    assert_eq!(multica.totals.sessions, 3);
    assert_eq!(report(&dir, "codex").totals.tokens.total, 30);
    assert_eq!(report(&dir, "").totals.tokens.total, 315);
    assert_eq!(activity::collect(&dir).unwrap(), 0);
    let today = chrono::DateTime::from_timestamp_millis(at)
        .unwrap()
        .with_timezone(&chrono::Local)
        .date_naive()
        .to_string();
    let filtered = activity::report_range(
        &dir,
        None,
        Some("multica".into()),
        None,
        Some("gpt-multica".into()),
        Some(today.clone()),
        Some(today),
    )
    .unwrap();
    assert_eq!(filtered.totals.tokens.total, 235);
    println!("PASS task and archived logs, durable store, resume deltas, upgrade, copied rollouts and scoped totals");
    if link_created {
        println!("PASS legacy symlink to ordinary Codex sessions keeps the original source");
    }

    let new_packets = activity::cloud_packets(&dir).unwrap();
    for (_, packet) in &new_packets {
        assert!(!packet.contains("PRIVATE_FIXTURE_CONTENT"));
        let json: Value = serde_json::from_str(packet).unwrap();
        for item in json["events"].as_array().unwrap() {
            assert_eq!(item["source"], "codex");
        }
    }
    for (name, order) in [
        ("old-first", [&legacy_packets, &new_packets]),
        ("new-first", [&new_packets, &legacy_packets]),
    ] {
        let peer = root.join(name);
        let peer_settings = settings(&peer);
        activity::save_options(&peer, &peer_settings).unwrap();
        for packets in order {
            for (_, packet) in packets {
                activity::import_cloud_packet(&peer, packet.as_bytes()).unwrap();
            }
        }
        assert_eq!(report(&peer, "multica").totals.tokens.total, 285);
        assert_eq!(report(&peer, "").totals.tokens.total, 315);
    }
    println!("PASS compatible sync packets preserve counts and source in both replay orders");

    let mut file = OpenOptions::new().append(true).open(&current).unwrap();
    write!(
        file,
        "{}",
        usage(at + 8, counters(10_200, 8_150, 250, 125), Value::Null)
    )
    .unwrap();
    assert_eq!(activity::collect(&dir).unwrap(), 0);
    writeln!(file).unwrap();
    drop(file);
    assert_eq!(activity::collect(&dir).unwrap(), 1);
    assert_eq!(report(&dir, "multica").totals.tokens.total, 330);
    options.multica_enabled = false;
    activity::save_options(&dir, &options).unwrap();
    fs::remove_file(&current).unwrap();
    assert_eq!(activity::collect(&dir).unwrap(), 0);
    assert_eq!(report(&dir, "multica").totals.tokens.total, 330);
    println!("PASS incomplete line, incremental append and historical retention when switched off");
}

fn live(root: &Path) {
    let mut options = settings(root);
    options.multica_enabled = true;
    activity::save_options(root, &options).unwrap();
    let collected = activity::collect(root).unwrap();
    let first = report(root, "multica");
    assert!(first.totals.tokens.total > 0, "{:?}", first.errors);
    let repeated = activity::collect(root).unwrap();
    let second = report(root, "multica");
    assert!(second.totals.tokens.total >= first.totals.tokens.total);
    println!(
        "{}",
        json!({
            "collectedMetrics": collected,
            "tokens": first.totals.tokens,
            "sessions": first.totals.sessions,
            "models": first.models.iter().map(|model| &model.key).collect::<Vec<_>>(),
            "repeatNewMetrics": repeated,
            "errors": first.errors,
        })
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/multica-checks")
        .join(uuid::Uuid::new_v4().to_string());
    match args.as_slice() {
        [] => checks(&root, chrono::Utc::now().timestamp_millis() - 60_000),
        [flag] if flag == "--live" => live(&root),
        _ => panic!("usage: multica_checks [--live]"),
    }
}
