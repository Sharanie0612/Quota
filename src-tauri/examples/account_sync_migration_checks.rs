//! Upgrade fixtures and a synthetic shared folder; credentials stay in an in-memory keyring.
#[path = "support/memory_keyring.rs"] mod memory_keyring;
use quota_lib::{account_sync, activity, Account, AppState, Store};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn account(provider: &str) -> Account {
    serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"provider":provider,
        "label":"Synthetic account","createdAt":"2026-10-01T00:00:00Z","balanceMode":"auto",
        "lowBalanceThreshold":5,"manualBalance":0,"manualCurrency":"CNY"})).unwrap()
}
fn state(dir: &Path, shared: &Path, accounts: Vec<Account>) -> AppState {
    std::env::set_var("QUOTA_DATA_DIR", dir);
    let store = Store::new().unwrap();
    let mut config = store.load_config(); config.accounts = accounts;
    store.save_config(&config).unwrap();
    let mut options = activity::options(dir);
    options.auto_collect = false; options.sync_accounts = true;
    options.sync_dir = shared.to_string_lossy().into();
    activity::save_options(dir, &options).unwrap();
    AppState::new(store, config, vec![])
}
fn record(account: &Account, device: &str) -> Value {
    json!({"profile":{"id":account.id,"provider":account.provider,"label":account.label,
        "createdAt":account.created_at,"balanceMode":"auto","lowBalanceThreshold":5,
        "manualBalance":0,"manualCurrency":"CNY"},"edited":chrono::Utc::now().timestamp_millis(),
        "device":device,"snapshot":null})
}
fn load(path: &Path) -> Value { serde_json::from_slice(&fs::read(path).unwrap()).unwrap() }
fn save(path: &Path, value: &Value) { fs::write(path, serde_json::to_vec(value).unwrap()).unwrap(); }
fn main() {
    let args:Vec<_>=std::env::args().collect();
    if let Some(at)=args.iter().position(|arg|arg=="--inspect-shared"){
        let count=account_sync::inspect_shared_packets(Path::new(args.get(at+1).expect("shared directory required"))).expect("shared packet validation");
        println!("PASS read-only cloud validation: {count} valid packets; redundant empty conflict copies ignored without modifying files");return
    }
    keyring::set_default_credential_builder(Box::new(memory_keyring::MemoryKeyring::default()));
    let root = std::env::current_dir().unwrap().join("target").join(format!("account-sync-migration-{}",uuid::Uuid::new_v4()));
    let old = state(&root.join("old"), &root.join("old-shared"), vec![account("deepseek")]);
    let old_path = old.store.dir().join("account-sync-state.json");
    save(&old_path, &json!({"records":{},"hidden":[]}));
    account_sync::sync(&old).unwrap();
    assert_eq!(old.config.lock().unwrap().accounts.len(),1);
    assert!(load(&old_path)["links"].is_object());
    println!("PASS pre-1.0.1401 ledger loads with defaults and retains local accounts");

    let mut kept = account("deepseek");
    kept.base_url = Some("https://SYNTHETIC-PRIVATE.invalid".into());
    kept.custom_headers = Some("SYNTHETIC-PRIVATE".into());
    let source = account("deepseek");
    let independent = account("deepseek");
    let pending = account("deepseek");
    let deleted = account("zhipu");
    let remote_device = uuid::Uuid::new_v4().to_string();
    let shared = root.join("shared");
    let first = state(&root.join("upgraded"), &shared, vec![kept.clone(),independent.clone()]);
    let path = first.store.dir().join("account-sync-state.json");
    let mut records = serde_json::Map::new();
    for a in [&kept,&source,&independent,&pending,&deleted] { records.insert(a.id.clone(),record(a,&remote_device)); }
    let ledger = json!({"records":records,"hidden":[source.id,deleted.id],"pending":[pending.id],
        "independent":[independent.id],"links":{(source.id.clone()):kept.id}});
    save(&path,&ledger);
    let mut update = record(&source,&remote_device);
    update["edited"] = json!(chrono::Utc::now().timestamp_millis()+1000);
    update["profile"]["label"] = json!("Remote update");
    update["snapshot"] = json!({"at":chrono::Utc::now().to_rfc3339(),
        "balance":{"currency":"CNY","total":25,"amounts":[],"usable":true},"subscription":null});
    fs::create_dir_all(shared.join("quota-accounts-v1")).unwrap();
    save(&shared.join("quota-accounts-v1").join(format!("{remote_device}.json")),
        &json!({"schema":1,"device":remote_device,"records":[update]}));
    for _ in 0..2 { account_sync::sync(&first).unwrap(); }
    let next = load(&path);
    for field in ["hidden","pending","independent"] {
        let actual: std::collections::BTreeSet<String> = serde_json::from_value(next[field].clone()).unwrap();
        let expected: std::collections::BTreeSet<String> = serde_json::from_value(ledger[field].clone()).unwrap();
        assert_eq!(actual,expected,"lost {field}");
    }
    assert_eq!(next["links"],ledger["links"]);
    let cfg = first.config.lock().unwrap().clone();
    assert_eq!(cfg.accounts.len(),2);
    assert!(!cfg.accounts.iter().any(|a| a.id==source.id || a.id==pending.id || a.id==deleted.id));
    let target = cfg.accounts.iter().find(|a| a.id==kept.id).unwrap();
    assert_eq!(target.label,"Remote update"); assert_eq!(target.base_url,kept.base_url);
    assert_eq!(target.custom_headers,kept.custom_headers);
    assert_eq!(first.statuses.lock().unwrap()[&kept.id].balance.as_ref().unwrap().total,Some(25.0));
    let status = load(&first.store.dir().join("account-sync-status.json"));
    assert!(status["error"].is_null()); assert!(status["lastSynced"].is_string());
    for file in fs::read_dir(shared.join("quota-accounts-v1")).unwrap() {
        let body = fs::read_to_string(file.unwrap().path()).unwrap(); assert!(!body.contains("SYNTHETIC-PRIVATE"));
        let packet: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(packet.as_object().unwrap().len(),3);
        assert!(packet.get("links").is_none()); assert!(packet.get("pending").is_none());
    }
    println!("PASS 1.0.1401/1402 extended ledger syncs without reset; associations, deletion, pending/independent decisions, local connections and remote snapshot retained; error cleared");
    let restart = state(first.store.dir(), &shared, cfg.accounts.clone());
    account_sync::sync(&restart).unwrap();
    assert_eq!(restart.config.lock().unwrap().accounts.len(),2);
    assert_eq!(load(&path)["links"],ledger["links"]);
    println!("PASS repeat exchange and restart keep the v1 packet and all local decisions");

    let device=activity::options(first.store.dir()).device_id;
    let packets=shared.join("quota-accounts-v1");
    let duplicate=packets.join(format!("{device}(1).json"));
    fs::write(&duplicate,b"").unwrap();
    let mac_copy=packets.join(format!("{device} 2.json"));
    fs::copy(packets.join(format!("{device}.json")),&mac_copy).unwrap();
    account_sync::sync(&restart).unwrap();
    assert_eq!(fs::metadata(&duplicate).unwrap().len(),0);
    assert!(mac_copy.exists());
    assert_eq!(restart.config.lock().unwrap().accounts.len(),2);
    let missing=packets.join(format!("{}(1).json",uuid::Uuid::new_v4()));
    fs::write(&missing,b"").unwrap();
    assert!(account_sync::sync(&restart).unwrap_err().contains("尚未下载完整"));
    fs::remove_file(missing).unwrap();
    account_sync::sync(&restart).unwrap();
    println!("PASS iCloud empty duplicate cannot block its validated sibling; valid conflict copies retained; unknown empty peers remain pending");

    let valid = load(&path);
    for malformed in [json!({"credentials":{"apiKey":"SYNTHETIC-FORBIDDEN"}}),json!({"links":[]})] {
        let mut bad = valid.clone();
        for (field,value) in malformed.as_object().unwrap() { bad[field] = value.clone(); }
        save(&path,&bad);
        let before = serde_json::to_value(restart.config.lock().unwrap().clone()).unwrap();
        assert!(account_sync::sync(&restart).is_err());
        assert_eq!(load(&path),bad);
        assert_eq!(serde_json::to_value(restart.config.lock().unwrap().clone()).unwrap(),before);
    }
    save(&path,&valid); account_sync::sync(&restart).unwrap();
    println!("PASS unknown/secret fields and malformed known fields are still rejected without replacing config or ledger; valid retry succeeds");
}
