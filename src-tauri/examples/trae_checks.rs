use quota_lib::activity::{self, trae};
use std::fs;
fn live() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/trae-checks")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    let mut options = activity::options(&root);
    options.codex_home = root.join("absent").to_string_lossy().into();
    options.zcode_home = options.codex_home.clone();
    options.trae_enabled = true;
    options.sync_dir.clear();
    activity::save_options(&root, &options).unwrap();
    activity::collect(&root).unwrap();
    let r = activity::report(&root, None, Some("trae".into()), None).unwrap();
    println!(
        "Live sessions={} Token={} models={} channels={:?} errors={:?}",
        r.totals.sessions,
        r.totals.tokens.total,
        r.models.len(),
        r.channels.iter().map(|row| (row.key.clone(), row.tokens.total)).collect::<Vec<_>>(),
        r.errors
    );
    assert!(r.errors.is_empty());
    // Every real turn is either Trae-provided or API-connected, and both stay separated.
    assert!(r.channels.iter().all(|row| row.key != "unknown"));
    assert!(r.models.iter().any(|row| row.key.ends_with("\u{1f}trae")));
    let before = r.totals.tokens;
    activity::collect(&root).unwrap();
    let after = activity::report(&root, None, Some("trae".into()), None).unwrap();
    assert!(before == after.totals.tokens);
    println!("PASS live repeat scan and real Trae/SOLO metrics, no duplicate counting");
}

fn fixture() {
    use rusqlite::{params, Connection};
    use serde_json::json;
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/trae-checks")
        .join(uuid::Uuid::new_v4().to_string());
    let local = root.join("local");
    fs::create_dir_all(&local).unwrap();
    let mut o = activity::options(&local);
    o.auto_collect = false;
    o.codex_home = root.join("absent").to_string_lossy().into();
    o.zcode_home = o.codex_home.clone();
    o.sync_dir.clear();
    o.trae_home = root.join("fixture").to_string_lossy().into();
    o.trae_enabled = true;
    let source_path = root.join("fixture/ModularData/ai-agent/database.db");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    let source = Connection::open(&source_path).unwrap();
    source.execute_batch("PRAGMA page_size=4096;PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;CREATE TABLE chat_turn(turn_id TEXT,session_id TEXT,created_at REAL,updated_at REAL,context TEXT);PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    let context = |input: u64, output: u64, info: serde_json::Value| {
        json!({"private":"PRIVATE_PROMPT","token_usage":{"prompt_tokens":input,"completion_tokens":output,"total_tokens":input+output,"cache_read_input_tokens":20,"cache_creation_input_tokens":5,"reasoning_tokens":2},"persist_user_message_context":{"model_info":info,"text":"PRIVATE_MESSAGE"}}).to_string()
    };
    // Trae's own preset configuration: the tokens came from a model Trae provides.
    let builtin = json!({"config_name":"glm-5.3","display_model_name":"GLM-5.3","is_preset":true,"config_source":1});
    // A configuration the user added with their own endpoint and key.
    let api = json!({"config_name":"deepseek-v4-pro","is_preset":false,"config_source":3,"base_url":"https://api.deepseek.com","ak":"PRIVATE_KEY","sk":""});
    // No marker at all: the name still falls back, the channel stays undetermined.
    let unmarked = json!({"config_name":"","display_model_name":"GLM-5.3-Flash","model_name":"glm-5.3-flash__dev"});
    source
        .execute(
            "INSERT INTO chat_turn VALUES('turn-a','session-a',1791072000,1791072001,?1)",
            [context(100, 30, builtin.clone())],
        )
        .unwrap();
    source
        .execute(
            "INSERT INTO chat_turn VALUES('pending','session-a',1791072000,1791072001,'{}')",
            [],
        )
        .unwrap();
    activity::save_options(&local, &o).unwrap();
    activity::collect(&local).unwrap();
    let report = || activity::report(&local, None, Some("trae".into()), None).unwrap();
    let key = |name: &str, channel: &str| if channel.is_empty() { name.to_string() } else { format!("{name}\u{1f}{channel}") };
    let has = |report: &activity::Report, name: &str, channel: &str| report.models.iter().any(|row| row.key == key(name, channel));
    assert!(report().errors.is_empty());
    assert_eq!(report().totals.tokens.total, 130);
    assert_eq!(report().totals.tokens.cached, 20);
    assert_eq!(report().totals.sessions, 1);
    assert!(has(&report(), "glm-5.3", "trae"));
    assert_eq!(report().channels.len(), 1);
    assert_eq!(report().channels[0].key, "trae");
    assert_eq!(report().channels[0].tokens.total, 130);
    assert_eq!(activity::collect(&local).unwrap(), 0);
    // Lower corrected settlement replaces the old count; an older copy cannot restore it.
    source
        .execute(
            "UPDATE chat_turn SET context=?1,updated_at=1791072002 WHERE turn_id='turn-a'",
            [context(40, 10, builtin.clone())],
        )
        .unwrap();
    activity::collect(&local).unwrap();
    assert_eq!(report().totals.tokens.total, 50);
    source
        .execute(
            "UPDATE chat_turn SET context=?1,updated_at=1791072001 WHERE turn_id='turn-a'",
            [context(100, 30, builtin.clone())],
        )
        .unwrap();
    activity::collect(&local).unwrap();
    assert_eq!(report().totals.tokens.total, 50);
    // Millisecond timestamps remain unchanged, and unknown models are not fabricated.
    source
        .execute(
            "INSERT INTO chat_turn VALUES('turn-b','session-b',1791072000000,1791072003000,?1)",
            [context(40, 10, api.clone())],
        )
        .unwrap();
    source
        .execute(
            "INSERT INTO chat_turn VALUES('turn-c','session-c',1791072000000,1791072003000,?1)",
            [context(40, 10, unmarked.clone())],
        )
        .unwrap();
    activity::collect(&local).unwrap();
    assert_eq!(report().totals.tokens.total, 150);
    assert_eq!(report().totals.sessions, 3);
    // Trae-provided and API-connected usage of the same account stay separate rows,
    // the empty config name falls back to its display name, and unmarked turns stay
    // undetermined instead of being claimed as either side.
    assert!(has(&report(), "glm-5.3", "trae"));
    assert!(has(&report(), "deepseek-v4-pro", "api"));
    assert!(has(&report(), "GLM-5.3-Flash", ""));
    let channels = report().channels;
    assert_eq!(channels.len(), 3);
    let total = |channels: &[activity::Group], key: &str| channels.iter().find(|row| row.key == key).map_or(0, |row| row.tokens.total);
    assert_eq!(total(&channels, "trae"), 50);
    assert_eq!(total(&channels, "api"), 50);
    assert_eq!(total(&channels, "unknown"), 50);
    let api_only = activity::report_filtered(&local, None, Some("trae".into()), None, Some("channel:api".into())).unwrap();
    assert_eq!(api_only.totals.tokens.total, 50);
    assert_eq!(api_only.models.len(), 1);
    let exact = activity::report_filtered(&local, None, Some("trae".into()), None, Some(key("deepseek-v4-pro", "api"))).unwrap();
    assert_eq!(exact.totals.tokens.total, 50);
    assert_eq!(activity::report_filtered(&local, None, Some("trae".into()), None, Some(key("deepseek-v4-pro", "trae"))).unwrap().totals.tokens.total, 0);
    // Native WAL is read in memory, includes commits and ignores an incomplete tail.
    let bytes = fs::read(&source_path).unwrap();
    let wal_path = std::path::PathBuf::from(format!("{}-wal", source_path.display()));
    let mut wal = fs::read(wal_path).unwrap();
    let normal = trae::cipher::database_image(&bytes, &wal, None).unwrap();
    wal.extend_from_slice(b"partial-tail");
    assert_eq!(
        normal,
        trae::cipher::database_image(&bytes, &wal, None).unwrap()
    );
    wal[24] ^= 1;
    assert!(trae::cipher::database_image(&bytes, &wal, None).is_err());
    assert!(!trae::cipher::verify_key(&[0; 32], &bytes[..4096]));
    let db = Connection::open(local.join("activity.sqlite")).unwrap();
    let mut q = db.prepare("SELECT body FROM metrics").unwrap();
    for body in q.query_map([], |r| r.get::<_, String>(0)).unwrap() {
        let text = body.unwrap();
        assert!(!text.contains("PRIVATE_PROMPT"));
        assert!(!text.contains("PRIVATE_MESSAGE"));
        // The endpoint and key of an API-connected model are read, never stored.
        assert!(!text.contains("PRIVATE_KEY"));
        assert!(!text.contains("api.deepseek.com"));
    }
    // A copied source on a second device retains global event IDs across sync.
    let remote = root.join("remote");
    fs::create_dir_all(&remote).unwrap();
    let mut b = o.clone();
    b.device_id = uuid::Uuid::new_v4().to_string();
    o.sync_dir = root.join("shared").to_string_lossy().into();
    b.sync_dir = o.sync_dir.clone();
    activity::save_options(&local, &o).unwrap();
    activity::save_options(&remote, &b).unwrap();
    activity::collect(&remote).unwrap();
    activity::collect(&local).unwrap();
    activity::collect(&remote).unwrap();
    let r = activity::report(&remote, None, Some("trae".into()), None).unwrap();
    assert_eq!(r.totals.tokens.total, 150);
    assert_eq!(r.totals.sessions, 3);
    // Channels survive cross-device exchange.
    assert_eq!(r.channels.len(), 3);
    // Invalid usage rolls back the source transaction, and missing opt-in preserves identity.
    source
        .execute(
            "INSERT INTO chat_turn VALUES('bad','session-b',1791072000,1791072004,?1)",
            params![
                json!({"token_usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":10}})
                    .to_string()
            ],
        )
        .unwrap();
    activity::collect(&local).unwrap();
    assert_eq!(report().totals.tokens.total, 150);
    assert!(!report().errors.is_empty());
    let mut previous = serde_json::to_value(o.clone()).unwrap();
    previous.as_object_mut().unwrap().remove("traeEnabled");
    previous.as_object_mut().unwrap().remove("traeHome");
    fs::write(local.join("activity-settings.json"), previous.to_string()).unwrap();
    let migrated = activity::options(&local);
    assert_eq!(migrated.device_id, o.device_id);
    assert!(!migrated.trae_enabled);
    println!("PASS Trae: actual WAL, partial tail, checksum rejection, seconds/ms, repeat/copy/sync dedup, downward settlements, privacy, malformed-usage rollback and opt-in migration");
    println!("PASS Trae channels: Trae-provided and API-connected usage stays separated, empty model names fall back, endpoint and key are never stored");
}
fn main() {
    fixture();
    if std::env::args().any(|a| a == "--live") {
        live();
    }
}
