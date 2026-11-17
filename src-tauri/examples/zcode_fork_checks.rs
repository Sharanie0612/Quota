//! Fork-history correction and mixed-version replay; sources are always read-only.
use quota_lib::activity::{self, Options};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}};

const DEVICE: &str = "00000000-0000-4000-8000-000000000001";
const SCHEMA: &str = "CREATE TABLE model_usage(id TEXT,logical_request_id TEXT,attempt_index INTEGER,session_id TEXT,turn_id TEXT,model_id TEXT,agent TEXT,started_at INTEGER,completed_at INTEGER,input_tokens INTEGER,cache_read_input_tokens INTEGER,cache_creation_input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,computed_total_tokens INTEGER,provider_total_tokens INTEGER,assistant_message_id TEXT);
    CREATE TABLE tool_usage(id TEXT,tool_call_id TEXT,session_id TEXT,turn_id TEXT,tool_name TEXT,started_at INTEGER,completed_at INTEGER);
    CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);
    CREATE TABLE part(id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);";
fn hash(value: &str) -> String { format!("{:x}", Sha256::digest(value.as_bytes())) }
fn setup(dir: &Path, home: &Path) {
    fs::create_dir_all(dir).unwrap();
    let mut options: Options = activity::options(dir);
    options.device_id = DEVICE.into(); options.device_name = "fixture".into();
    options.codex_home.clear(); options.zcode_home = home.to_string_lossy().into();
    options.harness_home.clear(); options.multica_enabled = false; options.trae_enabled = false;
    options.sync_dir.clear(); options.sync_accounts = false; options.codex_ssh_devices = Some(vec![]);
    activity::save_options(dir, &options).unwrap();
}
fn report(dir: &Path) -> activity::Report { activity::report(dir, None, None, None).unwrap() }
fn checks(root: &Path) {
    let home = root.join("source"); fs::create_dir_all(home.join("cli/db")).unwrap();
    let file = home.join("cli/db/db.sqlite"); let source = Connection::open(&file).unwrap();
    source.execute_batch(SCHEMA).unwrap();
    let at = chrono::Utc::now().timestamp_millis() - 60_000;
    for (id, session, offset, input, cached, model) in [
        ("original", "parent", 100, 100, 50, "GLM-test"),
        ("copied", "fork", 100, 100, 50, "GLM-test"),
        ("nested", "nested-fork", 100, 100, 50, "GLM-test"),
        ("ancestor-only", "grandchild", 100, 100, 50, "GLM-test"),
        ("same-amount-independent", "independent", 100, 100, 50, "GLM-test"),
        ("real-child-request", "fork", 1200, 100, 50, "GLM-test"),
        ("unmatched-old-request", "fork", 200, 80, 50, "GLM-test"),
        ("different-cache", "fork", 100, 100, 40, "GLM-test"),
        ("different-model", "fork", 100, 100, 50, "GLM-other"),
    ] {
        let body = json!({"role":"assistant","modelID":model,"tokens":{"input":input,"output":20,"reasoning":5,"cache":{"read":cached,"write":0}},"text":"PRIVATE_DO_NOT_SAVE"});
        source.execute("INSERT INTO message VALUES(?1,?2,?3,?3,?4)", params![id,session,at+offset,body.to_string()]).unwrap();
    }
    drop(source);
    let dir = root.join("upgrade"); setup(&dir, &home);
    activity::collect(&dir).unwrap(); assert_eq!(report(&dir).totals.tokens.total, 1060);
    let old_packets = activity::cloud_packets(&dir).unwrap();
    let db = Connection::open(dir.join("activity.sqlite")).unwrap();
    // The old cursor is already past the copied history. Upgrade must replay it.
    db.execute("UPDATE cursors SET body=json_set(body,'$.usage_version',0,'$.offset',?1) WHERE path LIKE '%:legacy'", [at+60_000]).unwrap();
    let source = Connection::open(&file).unwrap();
    source.execute_batch("CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,time_created INTEGER);").unwrap();
    for (id, parent, offset) in [("parent",None,0),("fork",Some("parent"),1000),("nested-fork",Some("fork"),2000),("intermediate",Some("parent"),1500),("grandchild",Some("intermediate"),2000),("independent",None,0)] {
        source.execute("INSERT INTO session VALUES(?1,?2,?3)", params![id,parent,at+offset]).unwrap();
    }
    drop(source); let source_bytes = fs::read(&file).unwrap();
    assert_eq!(activity::collect(&dir).unwrap(), 3);
    let current = report(&dir); assert!(current.errors.is_empty(), "{:?}", current.errors);
    assert_eq!(current.totals.tokens.total, 700);
    assert_eq!(current.totals.sessions, 3); // no inherited-only nested sessions
    assert_eq!(current.daily.iter().map(|g|g.tokens.total).sum::<u64>(), 700);
    assert_eq!(current.models.iter().map(|g|g.tokens.total).sum::<u64>(), 700);
    assert_eq!(current.sources.iter().map(|g|g.tokens.total).sum::<u64>(), 700);
    assert_eq!(activity::usage_summary(&dir).unwrap().total, 700);
    assert_eq!(activity::collect(&dir).unwrap(), 0);
    assert_eq!(fs::read(&file).unwrap(), source_bytes);
    // New forks retain old message update times; do not miss their corrections
    // just because the one-time upgrade replay has already completed.
    let source = Connection::open(&file).unwrap();
    source.execute("INSERT INTO session VALUES('later-fork','parent',?1)",[at+3000]).unwrap();
    source.execute("INSERT INTO message SELECT 'later-copy','later-fork',time_created,time_updated,data FROM message WHERE id='original'",[]).unwrap();
    drop(source);
    assert_eq!(activity::collect(&dir).unwrap(),1);
    assert_eq!(report(&dir).totals.tokens.total,700);
    assert_eq!(report(&dir).totals.sessions,3);
    assert_eq!(activity::collect(&dir).unwrap(),0);
    let corrected:i64 = db.query_row("SELECT count(*) FROM metrics WHERE json_extract(body,'$.revision')=1 AND json_extract(body,'$.tokens.total')=0", [], |row|row.get(0)).unwrap();
    assert_eq!(corrected, 4);
    let private:i64 = db.query_row("SELECT count(*) FROM metrics WHERE body LIKE '%PRIVATE_DO_NOT_SAVE%'", [], |row|row.get(0)).unwrap();
    assert_eq!(private, 0); drop(db);
    let new_packets = activity::cloud_packets(&dir).unwrap();
    for old_first in [false, true] {
        let peer = root.join(if old_first {"old-first"} else {"new-first"}); setup(&peer, &root.join("absent"));
        let batches = if old_first {[&old_packets,&new_packets]} else {[&new_packets,&old_packets]};
        for packets in batches { for (_, packet) in packets { activity::import_cloud_packet(&peer, packet.as_bytes()).unwrap(); } }
        assert_eq!(report(&peer).totals.tokens.total, 700);
        for (_, packet) in &old_packets {assert_eq!(activity::import_cloud_packet(&peer, packet.as_bytes()).unwrap(), 0);}
        assert_eq!(report(&peer).totals.tokens.total, 700);
    }
    // Simulate an old client retaining revision but max-merging the old tokens.
    let peer = root.join("old-relay-only"); setup(&peer, &root.join("absent"));
    let mut relay: Value = serde_json::from_str(&new_packets[0].1).unwrap();
    for event in relay["events"].as_array_mut().unwrap() {
        if event["revision"] == 1 { event["tokens"] = json!({"input":100,"cached":50,"cacheWrite":0,"output":20,"reasoning":5,"total":120}); }
    }
    activity::import_cloud_packet(&peer, &serde_json::to_vec(&relay).unwrap()).unwrap();
    assert_eq!(report(&peer).totals.tokens.total, 700);
    println!("PASS ZCode legacy fork/ancestor correction, consumed-cursor replay, exact metadata matching, independent/real child requests, source preservation, report totals, unique sessions and both sync orders/old relay");
}
fn cross_database_checks(root: &Path) {
    for modern_first in [false,true] {
        let root=root.join(if modern_first {"modern-first"} else {"legacy-first"});
        let home=root.join("source");let dir=root.join("quota");
        fs::create_dir_all(home.join("v2")).unwrap();fs::create_dir_all(home.join("cli/db")).unwrap();
        let paths=[home.join("v2/tasks-index.sqlite"),home.join("cli/db/db.sqlite")];
        for file in &paths {Connection::open(file).unwrap().execute_batch(SCHEMA).unwrap();}
        let at=chrono::Utc::now().timestamp_millis()-60_000;
        let modern=Connection::open(&paths[usize::from(!modern_first)]).unwrap();
        modern.execute("INSERT INTO model_usage VALUES('modern','request',0,'shared-session','turn','GLM-test','main',?1,?2,100,50,0,20,5,120,120,'shared-message')",params![at,at+100]).unwrap();drop(modern);
        let legacy=Connection::open(&paths[usize::from(modern_first)]).unwrap();
        let body=json!({"role":"assistant","modelID":"GLM-test","tokens":{"input":100,"output":20,"reasoning":5,"cache":{"read":50}}}).to_string();
        for (id,session) in [("shared-message","shared-session"),("independent-message","independent-session")] {
            legacy.execute("INSERT INTO message VALUES(?1,?2,?3,?3,?4)",params![id,session,at,body]).unwrap();
        }
        drop(legacy);setup(&dir,&home);report(&dir);
        let db=Connection::open(dir.join("activity.sqlite")).unwrap();
        for (id,session,timestamp) in [(hash("zcode:legacy:model:shared-message"),"shared-session",at),
            (hash("zcode:model:request:0"),"shared-session",at+100),
            (hash("zcode:legacy:model:independent-message"),"independent-session",at)] {
            let metric:activity::Metric=serde_json::from_value(json!({"id":id,"device":DEVICE,"source":"zcode","session":session,"model":"GLM-test","agent":"main","tool":"","timestamp":timestamp,"kind":"tokens","tokens":{"input":100,"cached":50,"cacheWrite":0,"output":20,"reasoning":5,"total":120}})).unwrap();
            activity::merge_metric(&db,&metric,true).unwrap();
        }
        drop(db);assert_eq!(report(&dir).totals.tokens.total,360);
        let old_packets=activity::cloud_packets(&dir).unwrap();
        activity::collect(&dir).unwrap();assert_eq!(report(&dir).totals.tokens.total,240);assert_eq!(report(&dir).totals.sessions,2);
        assert_eq!(activity::collect(&dir).unwrap(),0);
        let new_packets=activity::cloud_packets(&dir).unwrap();
        for old_first in [false,true] {
            let peer=root.join(if old_first {"old-first"} else {"new-first"});setup(&peer,&root.join("absent"));
            let batches=if old_first {[&old_packets,&new_packets]}else{[&new_packets,&old_packets]};
            for packets in batches {for (_,packet) in packets {activity::import_cloud_packet(&peer,packet.as_bytes()).unwrap();}}
            assert_eq!(report(&peer).totals.tokens.total,240);
        }
        let peer=root.join("relay");setup(&peer,&root.join("absent"));
        let mut relay:Value=serde_json::from_str(&new_packets[0].1).unwrap();
        for event in relay["events"].as_array_mut().unwrap() {if event["revision"]==2 {event["tokens"]=json!({"input":100,"cached":50,"cacheWrite":0,"output":20,"reasoning":5,"total":120});}}
        activity::import_cloud_packet(&peer,&serde_json::to_vec(&relay).unwrap()).unwrap();assert_eq!(report(&peer).totals.tokens.total,240);
        // Evidence in a source file is insufficient if the canonical request
        // could not be imported: the legacy record must retain known usage.
        let missing=root.join("missing-canonical");setup(&missing,&home);report(&missing);
        let modern=Connection::open(&paths[usize::from(!modern_first)]).unwrap();modern.execute("UPDATE model_usage SET started_at=0,completed_at=0",[]).unwrap();drop(modern);
        activity::collect(&missing).unwrap();assert_eq!(report(&missing).totals.tokens.total,240);
        assert!(report(&missing).errors.is_empty());
    }
    println!("PASS cross-database modern/legacy linkage in both source orders, correction replay/old relay, unrelated equal usage retained and missing-canonical fallback");
}
fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/zcode-fork-checks").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap(); checks(&root);cross_database_checks(&root);
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        assert_eq!(args.len(),4); assert_eq!(args[0],"--snapshot"); assert_eq!(args[2],"--zcode-home");
        assert!(Path::new(&args[1]).is_absolute() && Path::new(&args[3]).is_absolute());
        let dir = root.join("snapshot-replay"); setup(&dir, Path::new(&args[3]));
        fs::copy(&args[1], dir.join("activity.sqlite")).unwrap();
        let before = report(&dir).totals.tokens.total;
        activity::collect(&dir).unwrap(); let after = report(&dir);
        assert!(after.errors.is_empty(), "{:?}", after.errors);
        let db = Connection::open(dir.join("activity.sqlite")).unwrap();
        let corrected:i64 = db.query_row("SELECT count(*) FROM metrics WHERE json_extract(body,'$.source')='zcode' AND json_extract(body,'$.revision')=1", [], |row|row.get(0)).unwrap();
        let aliases:i64 = db.query_row("SELECT count(*) FROM metrics WHERE json_extract(body,'$.source')='zcode' AND json_extract(body,'$.revision')=2", [], |row|row.get(0)).unwrap();
        println!("Snapshot replay: before={before}, after={}, difference={}, inherited_rows={corrected}, legacy_aliases={aliases}, directory={}",after.totals.tokens.total,i128::from(before)-i128::from(after.totals.tokens.total),dir.display());
        assert_eq!(activity::collect(&dir).unwrap(),0);
    }
}
