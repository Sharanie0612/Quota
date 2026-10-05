use quota_lib::{migration::{self, ImportSelection}, AppState, Store};
use serde_json::{json, Value};
use std::{collections::HashSet, fs};

fn account(id: &str, label: &str) -> Value {
    json!({"id":id,"label":label,"provider":"mimo","createdAt":"2026-10-05T00:00:00Z","balanceMode":"console","manualBalance":0,"manualCurrency":"CNY","manualSpendTotal":0})
}
fn main() {
    let base = std::env::current_dir().unwrap().join("target").canonicalize().unwrap();
    let root = base.join(format!("migration-check-{}",uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("QUOTA_DATA_DIR", &root);
    let store = Store::new().unwrap();
    let mut config = store.load_config();
    config.accounts = serde_json::from_value(json!([account("keep", "本机保留"), account("same", "原名称")])).unwrap();
    config.accounts[1].custom_headers = Some("LOCAL-SENTINEL".into());
    config.settings.refresh_interval_minutes = 37;
    store.save_config(&config).unwrap();
    let state = AppState::new(store, config, vec![]);
    let export = json!({"format":"quota-data-export","schemaVersion":2,"accounts":[account("same","更新名称"),account("new","迁移账户")],
        "settings":{"autoRefresh":false,"refreshIntervalMinutes":55,"notifyLowBalance":false,"closeToTray":false,"defaultLowThreshold":10},
        "catalogOverrides":[],"hiddenModels":["hidden-model"],"balanceHistory":{"new":[{"t":1780000000,"v":0},{"t":1780000000,"v":0}],"orphan":[{"t":1780000000,"v":1}]},
        "activity":{"events":[],"devices":[]},"credentials":[{"accountId":"new","blob":{"apiKey":"PLAIN-SECRET-SENTINEL"}}]});
    let bytes = serde_json::to_vec(&export).unwrap();
    let decoded = migration::decode(&bytes, "").unwrap();
    assert!(decoded.credentials.is_empty());
    let preview = serde_json::to_value(migration::preview(&decoded,&bytes)).unwrap();
    assert!(!preview.to_string().contains("PLAIN-SECRET-SENTINEL"));
    assert_eq!(preview["accounts"].as_array().unwrap().len(),2);
    println!("PASS plain migration preview excludes credentials");

    let selected = ImportSelection {account_ids:vec!["new".into()],balance_history:true,..Default::default()};
    migration::apply(&state, decoded, selected.clone()).unwrap();
    let config = state.config.lock().unwrap().clone();
    assert_eq!(config.accounts.len(),3); assert_eq!(config.accounts.iter().find(|a|a.id=="same").unwrap().label,"原名称");
    assert_eq!(config.settings.refresh_interval_minutes,37);
    assert!(state.hidden_models.lock().unwrap().is_empty());
    assert_eq!(state.history.lock().unwrap().export_points()["new"].len(),1);
    assert!(!state.history.lock().unwrap().export_points().contains_key("orphan"));
    migration::apply(&state,migration::decode(&bytes, "").unwrap(),selected).unwrap();
    assert_eq!(state.config.lock().unwrap().accounts.len(),3); assert_eq!(state.history.lock().unwrap().export_points()["new"].len(),1);
    println!("PASS individual accounts, settings preservation, history scoping, zero and repeated-import deduplication");

    migration::apply(&state,migration::decode(&bytes," ").unwrap(),ImportSelection {account_ids:vec!["same".into()],catalog:true,..Default::default()}).unwrap();
    assert_eq!(state.config.lock().unwrap().accounts.iter().find(|a|a.id=="same").unwrap().custom_headers.as_deref(),Some("LOCAL-SENTINEL"));
    assert_eq!(*state.hidden_models.lock().unwrap(),vec!["hidden-model"]);
    println!("PASS selected account updated while local custom connection fields preserved");

    let mut broken = export.clone(); broken["activity"] = json!({"events":[{"invalid":true}],"devices":[]});
    broken["accounts"][0]["label"] = json!("should rollback");
    let before=fs::read(root.join("config.json")).unwrap();
    assert!(migration::apply(&state,migration::decode(&serde_json::to_vec(&broken).unwrap(),"").unwrap(),ImportSelection {account_ids:vec!["same".into()],settings:true,activity:true,..Default::default()}).is_err());
    assert_eq!(fs::read(root.join("config.json")).unwrap(),before);
    assert_eq!(state.config.lock().unwrap().settings.refresh_interval_minutes,37);
    println!("PASS failed activity import rolls configuration back on disk and in memory");

    let device=uuid::Uuid::new_v4().to_string();
    let event=json!({"id":"a".repeat(64),"device":device,"source":"codex","session":"synthetic-session","model":"synthetic-model","agent":"主 Agent","tool":"","timestamp":chrono::Utc::now().timestamp_millis(),"kind":"tokens","revision":0,
        "tokens":{"input":10,"cached":4,"cacheWrite":0,"output":5,"reasoning":2,"total":15}});
    let mut activity_export=export.clone();activity_export["activity"]=json!({"events":[event],"devices":[{"id":device,"name":"合成设备"}]});
    let activity_bytes=serde_json::to_vec(&activity_export).unwrap();
    for _ in 0..2 {migration::apply(&state,migration::decode(&activity_bytes,"").unwrap(),ImportSelection {activity:true,..Default::default()}).unwrap();}
    let migrated=quota_lib::data_export::activity_data(&root).unwrap();
    assert_eq!(migrated["events"].as_array().unwrap().len(),1);assert_eq!(migrated["events"][0]["tokens"]["total"],15);
    assert_eq!(state.config.lock().unwrap().settings.refresh_interval_minutes,37);
    println!("PASS activity-only migration preserves settings and cumulative token/cache/reasoning semantics across repeated imports");

    let config = state.config.lock().unwrap().clone();
    for version in [1,2] {
        let payload=json!({"version":version,"config":config,"catalogOverrides":[],"hiddenModels":[],"credentials":[{"accountId":"new","blob":{"apiKey":"ENCRYPTED-SENTINEL"}}],"balanceHistory":{},"activity":{"events":[],"devices":[]}});
        let sealed=quota_lib::seal_backup("synthetic-password",&serde_json::to_vec(&payload).unwrap()).unwrap();
        assert!(!String::from_utf8_lossy(&sealed).contains("ENCRYPTED-SENTINEL"));
        let decoded=migration::decode(&sealed,"synthetic-password").unwrap();
        assert_eq!(decoded.credentials[0].blob.api_key.as_deref(),Some("ENCRYPTED-SENTINEL"));
        let preview=serde_json::to_value(migration::preview(&decoded,&sealed)).unwrap();
        assert!(!preview.to_string().contains("ENCRYPTED-SENTINEL"));assert_eq!(preview["credentials"],true);
        assert!(migration::decode(&sealed,"wrong-password").is_err());
    }
    let mut old=export.clone();old["schemaVersion"]=json!(1);
    assert_eq!(migration::decode(&serde_json::to_vec(&old).unwrap(),"").unwrap().accounts.len(),2);
    assert!(migration::merge_accounts(&config,&migration::decode(&bytes,"").unwrap(),&ImportSelection {account_ids:vec!["missing".into()],..Default::default()}).is_err());
    assert!(migration::apply(&state,migration::decode(&bytes,"").unwrap(),ImportSelection {account_ids:vec!["new".into()],credentials:true,..Default::default()}).is_err());
    let allowed=HashSet::from(["new".into()]);
    assert!(migration::merge_history(&Default::default(),&Default::default(),&allowed).is_empty());
    println!("PASS v1/v2 encrypted backup compatibility, password checks, secret-free preview and invalid selection rejection");
    #[cfg(windows)]
    {
        struct Cleanup(Vec<String>);
        impl Drop for Cleanup {
            fn drop(&mut self) { for id in &self.0 { let _ = keyring::Entry::new("Quota", id).unwrap().delete_credential(); } }
        }
        let ids:Vec<String>=(0..3).map(|_|format!("quota-migration-check-{}",uuid::Uuid::new_v4())).collect();
        let _cleanup=Cleanup(ids.clone());
        let mut first=account(&ids[0],"合成余额");
        let mut second=account(&ids[1],"合成订阅");second["provider"]=json!("mimo-plan");
        let third=account(&ids[2],"合成其他账号");
        first["manualSpendTotal"]=json!(0);
        let payload=json!({"version":2,"config":{"accounts":[first,second,third],"settings":config.settings},"credentials":[
            {"accountId":ids[0],"blob":{"consoleCookie":"SYNTHETIC-OLD"}},
            {"accountId":ids[1],"blob":{"consoleCookie":"SYNTHETIC-OLD","apiKey":"SYNTHETIC-API"}},
            {"accountId":ids[2],"blob":{"consoleCookie":"SYNTHETIC-OTHER"}}]});
        let sealed=quota_lib::seal_backup("synthetic-password",&serde_json::to_vec(&payload).unwrap()).unwrap();
        migration::apply(&state,migration::decode(&sealed,"synthetic-password").unwrap(),ImportSelection {account_ids:ids.clone(),credentials:true,..Default::default()}).unwrap();
        assert_eq!(quota_lib::get_secrets(&ids[1]).unwrap().api_key.as_deref(),Some("SYNTHETIC-API"));
        quota_lib::update_mimo_cookie(&state,&ids[0],"SYNTHETIC-NEW").unwrap();
        assert_eq!(quota_lib::get_secrets(&ids[0]).unwrap().console_cookie.as_deref(),Some("SYNTHETIC-NEW"));
        assert_eq!(quota_lib::get_secrets(&ids[1]).unwrap().console_cookie.as_deref(),Some("SYNTHETIC-NEW"));
        assert_eq!(quota_lib::get_secrets(&ids[1]).unwrap().api_key.as_deref(),Some("SYNTHETIC-API"));
        assert_eq!(quota_lib::get_secrets(&ids[2]).unwrap().console_cookie.as_deref(),Some("SYNTHETIC-OTHER"));
        println!("PASS encrypted credentials restored to system keyring; shared Xiaomi renewal preserves other users and API keys");
    }
    drop(state);
    let checked=root.canonicalize().unwrap();assert!(checked.starts_with(&base));fs::remove_dir_all(checked).unwrap();
}
