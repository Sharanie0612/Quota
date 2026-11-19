//! Multi-source regression checks with synthetic logs only. No personal clients,
//! credentials, network, SSH or WSL are accessed by this example.
use quota_lib::activity::{
    self,
    sources::{self, readers, remote, Environment, Filters, Instance},
    Metric,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const DEVICE: &str = "00000000-0000-4000-8000-000000000001";
fn environment() -> Environment {
    Environment {
        id: DEVICE.into(),
        name: "Fixture local".into(),
        kind: "local".into(),
        target: String::new(),
        home: String::new(),
        identity_root: String::new(),
        included: true,
        legacy: true,
    }
}
fn instance(software: &str, root: &Path) -> Instance {
    let format = sources::definitions()
        .into_iter()
        .find(|d| d.id == software)
        .unwrap()
        .format;
    Instance {
        id: sources::stable_id(&format!("fixture:{software}:{}", root.display())),
        software: software.into(),
        environment: DEVICE.into(),
        root: root.to_string_lossy().into(),
        enabled: true,
        launcher: "direct".into(),
        access: "unknown".into(),
        format: format.into(),
        legacy: false,
        revision: 0,
    }
}
fn setup(root: &Path) -> (PathBuf, Connection) {
    let dir = root.join("data");
    fs::create_dir_all(&dir).unwrap();
    let mut o = activity::options(&dir);
    o.device_id = DEVICE.into();
    o.device_name = "Fixture local".into();
    o.codex_home.clear();
    o.zcode_home.clear();
    o.harness_home.clear();
    o.trae_enabled = false;
    o.multica_enabled = false;
    o.sync_dir.clear();
    o.codex_ssh_devices = Some(vec![]);
    activity::save_options(&dir, &o).unwrap();
    let mut w = sources::defaults(&o);
    for s in &mut w.instances {
        s.enabled = false;
    }
    sources::save(&dir, &w).unwrap();
    activity::report(&dir, None, None, None).unwrap();
    let db = Connection::open(dir.join("activity.sqlite")).unwrap();
    (dir, db)
}
fn append(path: &Path, rows: &[Value]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .unwrap();
    for row in rows {
        writeln!(file, "{row}").unwrap();
    }
}
fn assistant(id: &str, session: &str, model: &str, total: u64) -> Value {
    json!({"type":"assistant","timestamp":"2026-11-17T08:00:00Z","sessionId":session,"message":{"id":id,"model":model,"content":[{"type":"text","text":"PRIVATE_PROMPT_NEVER_EXPORT"},{"type":"tool_use","id":format!("tool-{id}"),"name":"Read","input":{"token":"PRIVATE_TOOL_SECRET"}}],"usage":{"input_tokens":total-20,"cache_read_input_tokens":10,"cache_creation_input_tokens":5,"output_tokens":5}}})
}
fn events(db: &Connection) -> Vec<Metric> {
    db.prepare("SELECT body FROM metrics ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|r| serde_json::from_str(&r.unwrap()).unwrap())
        .collect()
}
fn total(db: &Connection) -> u64 {
    events(db).iter().map(|e| e.tokens.total).sum()
}
fn collect(db: &mut Connection, s: &Instance) -> sources::SourceStatus {
    readers::collect(db, s, &environment()).unwrap().1
}

fn native_formats(root: &Path) {
    let (dir, mut db) = setup(&root.join("formats"));
    let logs = root.join("logs");
    let claude = logs.join("claude/session.jsonl");
    let c = instance("claude", claude.parent().unwrap());
    let first = assistant("msg-claude", "session-claude", "deepseek-v4-pro", 120);
    append(&claude, &[first.clone(), first.clone()]);
    assert_eq!(collect(&mut db, &c).state, "ready");
    assert_eq!(total(&db), 120);
    assert_eq!(events(&db).iter().filter(|e| e.kind == "tool").count(), 1);
    let mut empty = first.clone();
    empty["timestamp"] = json!("2026-11-17T08:00:01Z");
    empty["message"]["usage"] = json!({"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0});
    append(&claude, &[empty]);
    collect(&mut db, &c);
    assert_eq!(
        total(&db),
        120,
        "later empty assistant snapshot erased measured usage"
    );
    let copy = logs.join("claude/copy.jsonl");
    append(&copy, &[first]);
    collect(&mut db, &c);
    assert_eq!(total(&db), 120, "copied transcript duplicated message");
    let row = assistant("msg-claude-2", "session-claude", "glm-5.3", 100);
    let bytes = serde_json::to_vec(&row).unwrap();
    let midpoint = bytes.len() / 2;
    fs::OpenOptions::new()
        .append(true)
        .open(&claude)
        .unwrap()
        .write_all(&bytes[..midpoint])
        .unwrap();
    collect(&mut db, &c);
    assert_eq!(total(&db), 120, "partial tail was counted");
    fs::OpenOptions::new()
        .append(true)
        .open(&claude)
        .unwrap()
        .write_all(&[&bytes[midpoint..], b"\n"].concat())
        .unwrap();
    collect(&mut db, &c);
    assert_eq!(total(&db), 220);
    let gemini = logs.join("gemini/session-old.json");
    fs::create_dir_all(gemini.parent().unwrap()).unwrap();
    let gm = json!({"id":"gemini-msg","type":"gemini","timestamp":"2026-11-17T09:00:00Z","model":"gemini-3-pro","tokens":{"input":100,"output":20,"cached":40,"thoughts":10,"tool":5,"total":135},"content":"PRIVATE_GEMINI_CONTENT","toolCalls":[{"id":"gemini-tool","name":"shell","args":{"private":"PRIVATE_ARGS"}}]});
    fs::write(&gemini,json!({"sessionId":"gemini-session","lastUpdated":"2026-11-17T09:00:01Z","messages":[gm.clone()]}).to_string()).unwrap();
    let g = instance("gemini", gemini.parent().unwrap());
    collect(&mut db, &g);
    assert_eq!(total(&db), 355);
    append(
        &logs.join("gemini/session-new.jsonl"),
        &[
            json!({"sessionId":"gemini-session","projectHash":"opaque"}),
            gm.clone(),
            json!({"$rewindTo":"gemini-msg"}),
            json!({"$set":{"sessionId":"gemini-session","messages":[gm]}}),
        ],
    );
    collect(&mut db, &g);
    assert_eq!(
        total(&db),
        355,
        "Gemini JSON/JSONL migration or rewind duplicated usage"
    );
    let gem = events(&db)
        .into_iter()
        .find(|e| e.source == "gemini" && e.kind == "tokens")
        .unwrap();
    assert_eq!(
        (gem.tokens.input, gem.tokens.output, gem.tokens.reasoning),
        (105, 30, 10)
    );
    let kimi = logs.join("kimi/session-kimi/wire.jsonl");
    let k = instance("kimi", kimi.parent().unwrap());
    append(
        &kimi,
        &[
            json!({"type":"metadata","protocol_version":"1.0"}),
            json!({"timestamp":1794906000.0,"message":{"type":"TurnBegin","payload":{"user_input":"PRIVATE_KIMI_PROMPT"}}}),
            json!({"timestamp":1794906000.1,"message":{"type":"StepBegin","payload":{"n":1}}}),
            json!({"timestamp":1794906000.2,"message":{"type":"StatusUpdate","payload":{"context_usage":0.95}}}),
            json!({"timestamp":1794906000.3,"message":{"type":"StatusUpdate","payload":{"token_usage":{"input_other":10,"input_cache_read":20,"input_cache_creation":5,"output":5},"message_id":"kimi-1"}}}),
            json!({"timestamp":1794906000.4,"message":{"type":"StepRetry","payload":{"n":1,"next_attempt":1}}}),
            json!({"timestamp":1794906000.5,"message":{"type":"StatusUpdate","payload":{"token_usage":{"input_other":10,"input_cache_read":0,"input_cache_creation":0,"output":5},"message_id":"kimi-2"}}}),
        ],
    );
    collect(&mut db, &k);
    assert_eq!(total(&db), 410);
    assert!(events(&db)
        .iter()
        .filter(|e| e.source == "kimi")
        .all(|e| e.model == "未知模型"));
    collect(&mut db, &k);
    assert_eq!(total(&db), 410);
    let qoder = logs.join("qoder/no-usage.jsonl");
    let q = instance("qoder", qoder.parent().unwrap());
    append(
        &qoder,
        &[
            json!({"type":"assistant","uuid":"qoder-row","sessionId":"qoder-session","timestamp":"2026-11-17T10:00:00Z","message":{"content":[{"type":"text","text":"PRIVATE_QODER"}]}}),
        ],
    );
    assert_eq!(collect(&mut db, &q).state, "no-usage");
    assert_eq!(total(&db), 410);
    let workbuddy = logs.join("workbuddy/session.jsonl");
    let w = instance("workbuddy", workbuddy.parent().unwrap());
    let mut built = assistant("workbuddy-1", "wb-session", "claude-sonnet-4-6", 200);
    built["access"] = json!("builtin");
    let mut api = assistant("workbuddy-2", "wb-session", "gpt-6.1-sol", 300);
    api["access"] = json!("api");
    append(
        &workbuddy,
        &[
            built,
            api,
            json!({"type":"result","usage":{"input_tokens":50000,"output_tokens":90000},"session_id":"wb-session"}),
        ],
    );
    collect(&mut db, &w);
    assert_eq!(total(&db), 910, "session cumulative result was added twice");
    let wb: Vec<_> = events(&db)
        .into_iter()
        .filter(|e| e.source == "workbuddy" && e.kind == "tokens")
        .collect();
    assert_eq!(wb.len(), 2);
    assert_eq!(
        sources::access(&wb[0]) == "api" || sources::access(&wb[1]) == "api",
        true
    );
    assert_eq!(wb.iter().filter(|e| sources::direct_cost(e)).count(), 1);
    let mut bad = assistant("bad", "bad-session", "bad-model", 100);
    bad["message"]["usage"]["input_tokens"] = json!(-1);
    append(&logs.join("claude/bad.jsonl"), &[bad]);
    assert_eq!(collect(&mut db, &c).state, "partial");
    assert_eq!(total(&db), 910);
    fs::write(logs.join("claude/bad.jsonl"), b"").unwrap();
    assert_eq!(collect(&mut db, &c).state, "ready");
    let payload = quota_lib::data_export::activity_data(&dir)
        .unwrap()
        .to_string();
    assert!(!payload.contains("PRIVATE_"));
    assert!(!payload.contains("user_input"));
    assert!(!payload.contains("toolCallArgs"));
    let r = activity::report_workspace(
        &dir,
        None,
        None,
        None,
        None,
        None,
        None,
        Filters {
            software: "workbuddy".into(),
            access: "api".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(r.totals.tokens.total, 300);
    assert_eq!(r.totals.calls, 1);
    assert_eq!(r.daily.iter().map(|r| r.tokens.total).sum::<u64>(), 300);
    assert_eq!(r.models.iter().map(|r| r.tokens.total).sum::<u64>(), 300);
    assert_eq!(r.details.len(), 1);
    assert_eq!(r.details[0].vendor, "custom");
    let mut changed = c.clone();
    changed.launcher = "multica".into();
    changed.access = "api".into();
    changed.revision = 1;
    collect(&mut db, &changed);
    assert!(events(&db)
        .iter()
        .filter(|e| e.source == "claude")
        .all(|e| sources::launcher(e) == "multica" && sources::access(e) == "api"));
    changed.launcher = "direct".into();
    changed.revision = 2;
    collect(&mut db, &changed);
    assert!(events(&db)
        .iter()
        .filter(|e| e.source == "claude")
        .all(|e| sources::launcher(e) == "direct"));
    assert_eq!(total(&db), 910);
    println!("PASS Claude streaming/copied logs/partial tails, Gemini formats/rewinds/subsets, Kimi steps/retries/unknown model, WorkBuddy cross-provider access, Qoder unavailable fields, isolated failures, privacy and filter intersections");
}

fn csv_formats(root: &Path) {
    let (csv_dir, mut db) = setup(&root.join("csv"));
    let path = root.join("csv/usage.csv");
    let s = instance("cursor", &path);
    let header="\u{feff}Date,User,Kind,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens\r\n";
    let row="2026-11-17T08:30:00Z,private@example.invalid,Included,claude-sonnet-4-6,10,40,30,20,100\r\n";
    fs::write(&path, format!("{header}{row}{row}")).unwrap();
    collect(&mut db, &s);
    assert_eq!(total(&db), 200, "identical distinct rows collapsed");
    collect(&mut db, &s);
    assert_eq!(total(&db), 200);
    let other = root.join("csv/overlap.csv");
    fs::write(&other, format!("{header}{row}{row}")).unwrap();
    let copy = instance("cursor", &other);
    collect(&mut db, &copy);
    assert_eq!(total(&db), 200, "overlapping export recounted rows");
    assert!(events(&db).iter().all(|e| e.source == "cursor"
        && e.tokens.input == 80
        && e.tokens.cache_write == 10
        && sources::access(e) == "builtin"));
    assert!(!events(&db).iter().any(|e| serde_json::to_string(e)
        .unwrap()
        .contains("private@example")));
    fs::write(
        &path,
        "Date,Model,Output Tokens,Total Tokens\n2026-11-17T09:00:00Z,gpt-6.1-sol,10,50\n",
    )
    .unwrap();
    collect(&mut db, &s);
    assert_eq!(total(&db), 250);
    assert!(events(&db)
        .iter()
        .any(|e| !e.origin.as_ref().unwrap().cache_known));
    fs::write(
        &path,
        "Date,Model,Cost\n2026-11-17T09:00:00Z,gpt-6.1-sol,5\n",
    )
    .unwrap();
    assert_eq!(collect(&mut db, &s).state, "partial");
    assert_eq!(total(&db), 250);
    let report = activity::report(&csv_dir, None, None, None).unwrap();
    assert_eq!(report.coverage.all_input, 200);
    assert_eq!(report.coverage.known_cache_input, 160);
    assert!(readers::csv_rows("a,b\n\"incomplete,b").is_err());
    assert_eq!(
        readers::csv_rows("a,b\n\"q,\"\"quote\"\"\",2\n").unwrap()[1][0],
        "q,\"quote\""
    );
    println!("PASS Cursor CSV token reconciliation, identical-row multiplicity, overlapping exports, unknown cache coverage, zero fee estimates, privacy and quoted CSV");
}

fn workspace_and_sync(root: &Path) {
    let (dir, db) = setup(&root.join("workspace"));
    let o = activity::options(&dir);
    let before = fs::read(dir.join("activity-sources.json")).unwrap();
    let mut workspace = sources::load(&dir, &o).unwrap();
    let mounted = Environment {
        id: "00000000-0000-4000-8000-000000000009".into(),
        name: "Fixture VM".into(),
        kind: "mounted".into(),
        target: String::new(),
        home: String::new(),
        identity_root: String::new(),
        included: false,
        legacy: false,
    };
    workspace.environments.push(mounted.clone());
    sources::save(&dir, &workspace).unwrap();
    let mut malformed = workspace.clone();
    malformed.environments.pop();
    assert!(sources::save(&dir, &malformed).is_err());
    assert!(sources::excluded(&dir, &o).unwrap().contains(&mounted.id));
    assert_ne!(fs::read(dir.join("activity-sources.json")).unwrap(), before);
    let good = sources::load(&dir, &o).unwrap();
    fs::write(dir.join("activity-sources.json"), b"broken config").unwrap();
    assert!(activity::report(&dir, None, None, None).is_err());
    assert!(activity::usage_summary(&dir).is_err());
    fs::write(
        dir.join("activity-sources.json"),
        serde_json::to_vec(&good).unwrap(),
    )
    .unwrap();
    let old_settings = fs::read(dir.join("activity-settings.json")).unwrap();
    fs::write(dir.join("activity-settings.json"), b"broken settings").unwrap();
    assert!(activity::collect(&dir).is_err());
    assert!(activity::report(&dir, None, None, None).is_err());
    assert_eq!(
        fs::read(dir.join("activity-settings.json")).unwrap(),
        b"broken settings"
    );
    fs::write(dir.join("activity-settings.json"), old_settings).unwrap();
    let bad = Instance {
        root: "relative-path".into(),
        ..instance("claude", root)
    };
    workspace.instances.push(bad);
    assert!(sources::save(&dir, &workspace).is_err());
    workspace.instances.pop();
    let mut source = instance("claude", root);
    source.environment = mounted.id.clone();
    source.launcher = "multica".into();
    let row = assistant("vm-claude", "vm-session", "deepseek-v4-pro", 100);
    let mut cursor = readers::ReaderCursor::default();
    for e in readers::parse_line(&row, &mut cursor, &source, &mounted).unwrap() {
        activity::merge_metric(&db, &e, true).unwrap();
    }
    assert_eq!(
        activity::report(&dir, None, None, None)
            .unwrap()
            .totals
            .tokens
            .total,
        0
    );
    assert_eq!(activity::usage_summary(&dir).unwrap().total, 0);
    workspace
        .environments
        .iter_mut()
        .find(|e| e.id == mounted.id)
        .unwrap()
        .included = true;
    sources::save(&dir, &workspace).unwrap();
    assert_eq!(
        activity::report(&dir, None, None, None)
            .unwrap()
            .totals
            .tokens
            .total,
        100
    );
    sources::prepare_migration(&dir, &db).unwrap();
    let repair = sources::repair_summary(&dir, &db);
    assert!(Path::new(repair.backup.as_ref().unwrap()).is_file());
    let backup = fs::read(repair.backup.as_ref().unwrap()).unwrap();
    sources::prepare_migration(&dir, &db).unwrap();
    assert_eq!(fs::read(repair.backup.unwrap()).unwrap(), backup);
    let legacy:Metric=serde_json::from_value(json!({"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","device":DEVICE,"source":"codex","session":"legacy","model":"gpt-6.1-sol","agent":"main","tool":"","timestamp":1794902400000_i64,"kind":"tokens","tokens":{"input":10,"cached":0,"cacheWrite":0,"output":5,"reasoning":0,"total":15}})).unwrap();
    activity::merge_metric(&db, &legacy, true).unwrap();
    drop(db);
    let sync = root.join("sync-packets");
    let mut o = activity::options(&dir);
    o.sync_dir = sync.to_string_lossy().into();
    activity::save_options(&dir, &o).unwrap();
    activity::collect(&dir).unwrap();
    assert!(sync.join("quota-activity-v1").is_dir());
    assert!(sync.join("quota-activity-v2").is_dir());
    let state = activity::sync_storage::inspect(&dir).unwrap();
    assert!(state.files >= 2);
    let (peer, _) = setup(&root.join("peer"));
    let mut p = activity::options(&peer);
    p.device_id = "00000000-0000-4000-8000-000000000003".into();
    p.sync_dir = sync.to_string_lossy().into();
    activity::save_options(&peer, &p).unwrap();
    activity::collect(&peer).unwrap();
    let r = activity::report(&peer, None, None, None).unwrap();
    assert_eq!(r.totals.tokens.total, 15);
    let mut imported = sources::load(&peer, &p).unwrap();
    assert!(imported
        .environments
        .iter()
        .any(|e| e.id == mounted.id && !e.included));
    imported
        .environments
        .iter_mut()
        .find(|e| e.id == mounted.id)
        .unwrap()
        .included = true;
    sources::save(&peer, &imported).unwrap();
    let r = activity::report(&peer, None, None, None).unwrap();
    assert_eq!(r.totals.tokens.total, 115);
    assert!(r
        .details
        .iter()
        .any(|d| d.software == "claude" && d.launcher == "multica"));
    activity::collect(&peer).unwrap();
    assert_eq!(
        activity::report(&peer, None, None, None)
            .unwrap()
            .totals
            .tokens
            .total,
        115
    );
    println!("PASS environment opt-in and retention, registry validation, native ID remapping, consistent SQLite backup, mixed v1/v2 sync and idempotent replay");
}

fn remote_projection(root: &Path, python: &str) {
    let (_, mut db) = setup(&root.join("remote"));
    let logs = root.join("remote-logs");
    let path = logs.join("claude/session.jsonl");
    let mut source = instance("claude", path.parent().unwrap());
    let mut rows = vec![];
    for i in 0..4008 {
        rows.push(assistant(
            &format!("remote-{i}"),
            "remote-session",
            "claude-sonnet-4-6",
            100,
        ));
    }
    append(&path, &rows);
    let codex_profile=root.join("codex-profile");
    let run = |request: Value| {
        let mut p = Command::new(python)
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts/activity-remote-metrics.py"))
            .env("CODEX_HOME",&codex_profile)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        p.stdin
            .take()
            .unwrap()
            .write_all(request.to_string().as_bytes())
            .unwrap();
        let out = p.wait_with_output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        out.stdout
    };
    let home = root.canonicalize().unwrap();
    let home = home
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_string();
    let identity: Value =
        serde_json::from_slice(&run(json!({"mode":"identity","home":home}))).unwrap();
    let mut previous=Command::new(python).arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts/codex-ssh-metrics.py"))
        .env("CODEX_HOME",&codex_profile).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    previous.stdin.take().unwrap().write_all(json!({"format":"quota-codex-ssh-v1","mode":"identity","home":codex_profile}).to_string().as_bytes()).unwrap();
    let output=previous.wait_with_output().unwrap();assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
    let previous:Value=serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(previous["deviceId"],identity["deviceId"],"custom CODEX_HOME retains the previous SSH device identity");
    let env = Environment {
        id: identity["deviceId"].as_str().unwrap().into(),
        name: "Fixture remote".into(),
        kind: "ssh".into(),
        target: "fixture".into(),
        home: home.clone(),
        identity_root: String::new(),
        included: true,
        legacy: false,
    };
    source.environment = env.id.clone();
    let bytes = run(json!({"home":home,"instances":[source]}));
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["partial"], true);
    assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_"));
    remote::apply(&mut db, &env, &[source.clone()], &bytes).unwrap();
    assert_eq!(total(&db), 400000);
    let batch = &value["files"][0];
    let mut source_request = serde_json::to_value(&source).unwrap();
    source_request["offsets"] =
        json!({batch["path"].as_str().unwrap():{"offset":batch["offset"],"stamp":batch["stamp"]}});
    let bytes = run(json!({"home":home,"instances":[source_request]}));
    remote::apply(&mut db, &env, &[source.clone()], &bytes).unwrap();
    assert_eq!(total(&db), 400800);
    // Complete source replay preserves canonical IDs, even with a fresh reader cursor.
    let replay = run(json!({"home":home,"instances":[source]}));
    let mut value: Value = serde_json::from_slice(&replay).unwrap();
    value["files"][0]["reset"] = json!(true);
    remote::apply(
        &mut db,
        &env,
        &[source],
        &serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    assert_eq!(total(&db), 400800);
    println!("PASS remote fixed whitelist, identity-only probe, 4000-record pagination, persisted offsets and canonical replay; real SSH/WSL connections not exercised");
}
fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/activity-source-checks")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    native_formats(&root);
    csv_formats(&root);
    workspace_and_sync(&root);
    if let Some(python) = std::env::args().nth(1) {
        remote_projection(&root, &python);
    } else {
        panic!("pass a Python 3.7+ executable for remote projection checks")
    };
    println!("PASS all multi-source checks; fixtures {}", root.display());
}
