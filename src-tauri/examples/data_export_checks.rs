use quota_lib::{data_export, Account, AccountStatus};
use rusqlite::{Connection, params};
use serde_json::{json, Value};
use std::fs;

fn main() {
    let base = std::env::current_dir().unwrap().join("target").canonicalize().unwrap();
    let root = base.join(format!("export-check-{}",uuid::Uuid::new_v4()));
    let data = root.join("data"); fs::create_dir_all(&data).unwrap();
    let account: Account = serde_json::from_value(json!({"id":"synthetic","provider":"zhipu","label":"测试账户","createdAt":"2026-10-04",
        "customHeaders":"Authorization: SECRET-SENTINEL","customBody":"SECRET-SENTINEL","baseUrl":"https://example.invalid/?key=SECRET-SENTINEL",
        "customUrl":"https://example.invalid/SECRET-SENTINEL","note":"SECRET-SENTINEL","manualSpendTotal":0,"manualSpendCurrency":"CNY"})).unwrap();
    let mut status = AccountStatus::default();
    let mut balance=quota_lib::parse_zhipu_report(r#"{"success":true,"data":{"availableBalance":2,"totalSpendAmount":5}}"#,"GLM").unwrap();
    balance.raw=Some(json!({"token":"SECRET-SENTINEL"})); balance.note=Some("SECRET-SENTINEL".into()); status.balance=Some(balance);
    let output=data_export::account_data(&account,Some(&status));
    assert!(!output.to_string().contains("SECRET-SENTINEL")); assert_eq!(output["manualSpendTotal"].as_f64(),Some(0.0));
    assert_eq!(output["balance"]["amounts"][0]["value"].as_f64(),Some(5.0));
    println!("PASS account values/zero preserved; custom requests, notes and raw responses excluded");

    assert_eq!(data_export::activity_data(&data).unwrap()["events"],json!([]));
    assert!(!data.join("activity.sqlite").exists());
    let db=Connection::open(data.join("activity.sqlite")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE metrics(id TEXT PRIMARY KEY,body TEXT);CREATE TABLE devices(id TEXT,name TEXT);CREATE TABLE outbox(seq INTEGER,event_id TEXT);CREATE TABLE cursors(path TEXT,body TEXT);").unwrap();
    let metric=json!({"id":"a".repeat(64),"device":uuid::Uuid::new_v4().to_string(),"source":"harness","session":"session-1","model":"deepseek-v3","agent":"主 Agent","tool":"","timestamp":1780000000000_i64,"kind":"tokens","revision":3,
        "tokens":{"input":5,"cached":2,"cacheWrite":0,"output":3,"reasoning":1,"total":8},"messages":"SECRET-SENTINEL"});
    db.execute("INSERT INTO metrics VALUES(?1,?2)",params![metric["id"].as_str().unwrap(),metric.to_string()]).unwrap();
    db.execute("INSERT INTO outbox VALUES(1,'keep')",[]).unwrap();db.execute("INSERT INTO cursors VALUES('SECRET-SENTINEL','keep')",[]).unwrap();
    let exported=data_export::activity_data(&data).unwrap();
    assert_eq!(exported["events"][0]["revision"],3);assert_eq!(exported["events"][0]["tokens"]["total"],8);
    assert!(!exported.to_string().contains("SECRET-SENTINEL"));
    assert_eq!(db.query_row("SELECT COUNT(*) FROM outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    println!("PASS committed WAL event/revision preserved; no messages, cursors, or queue mutations");

    let target=root.join("export.json");fs::write(&target,"old").unwrap();
    data_export::write_file(&target,&data,&exported).unwrap();assert_eq!(serde_json::from_slice::<Value>(&fs::read(&target).unwrap()).unwrap(),exported);
    let protected=data.join("config.json");fs::write(&protected,"keep").unwrap();
    assert!(data_export::write_file(&protected,&data,&exported).is_err());assert_eq!(fs::read_to_string(&protected).unwrap(),"keep");
    assert!(data_export::write_file(std::path::Path::new("relative.json"),&data,&exported).is_err());
    let invalid=root.join("directory.json");fs::create_dir(&invalid).unwrap();assert!(data_export::write_file(&invalid,&data,&exported).is_err());assert!(invalid.is_dir());
    assert!(!fs::read_dir(&root).unwrap().flatten().any(|entry|entry.file_name().to_string_lossy().starts_with(".quota-export-")));
    println!("PASS atomic replacement, protected configuration, failure cleanup and original target preservation");
    drop(db);
    let checked=root.canonicalize().unwrap();assert!(checked.starts_with(&base));fs::remove_dir_all(checked).unwrap();
}
