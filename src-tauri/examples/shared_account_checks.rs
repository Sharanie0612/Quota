//! Multi-device fixtures only, using an instrumented in-memory credential store.
#[path = "support/memory_keyring.rs"]
mod memory_keyring;
use quota_lib::{account_sync, activity, Account, AppState, Store};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn account(label: &str) -> Account {
    serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"provider":"deepseek","label":label,"createdAt":"2026-10-01T00:00:00Z","baseUrl":"LOCAL-ONLY"})).unwrap()
}
fn state(dir: &Path, shared: &Path, accounts: Vec<Account>) -> AppState {
    std::env::set_var("QUOTA_DATA_DIR", dir);
    let store = Store::new().unwrap();
    let mut cfg = store.load_config();
    cfg.accounts = accounts;
    store.save_config(&cfg).unwrap();
    let mut opts = activity::options(dir);
    opts.sync_dir = shared.to_string_lossy().into();
    activity::save_options(dir, &opts).unwrap();
    AppState::new(store, cfg, vec![])
}
fn put(id: &str, key: &str) {
    keyring::Entry::new("Quota", id)
        .unwrap()
        .set_password(&json!({"apiKey":key}).to_string())
        .unwrap()
}
fn main() {
    let memory = memory_keyring::MemoryKeyring::default();
    keyring::set_default_credential_builder(Box::new(memory.clone()));
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("shared-account-checks-{}", uuid::Uuid::new_v4()));
    let shared = root.join("shared");
    let aa = account("My account A");
    let mut bb = account("My account B");
    bb.created_at = "2026-10-02T00:00:00Z".into();
    let mut cc = account("My account C");
    cc.created_at = "2026-10-03T00:00:00Z".into();
    let a = state(&root.join("a"), &shared, vec![aa.clone()]);
    let b = state(&root.join("b"), &shared, vec![bb.clone()]);
    put(&aa.id, "SYNTHETIC-SAME-LOGIN");
    put(&bb.id, "SYNTHETIC-SAME-LOGIN");
    for _ in 0..2 {
        account_sync::sync(&a).unwrap();
        account_sync::sync(&b).unwrap();
    }
    account_sync::resolve(&b, &aa.id, Some(&bb.id)).unwrap();
    account_sync::sync(&b).unwrap();
    account_sync::sync(&a).unwrap();
    assert!(account_sync::candidates(&a).unwrap().is_empty());
    assert_eq!(a.config.lock().unwrap().accounts[0].id, aa.id);
    assert_eq!(b.config.lock().unwrap().accounts[0].id, bb.id);
    for _ in 0..10 {
        account_sync::sync(&a).unwrap();
        account_sync::sync(&b).unwrap();
    }
    println!("PASS one confirmed association converges both devices with original local IDs and connections retained");
    let c = state(&root.join("c"), &shared, vec![]);
    memory.reads.lock().unwrap().clear();
    account_sync::sync(&c).unwrap();
    assert_eq!(c.config.lock().unwrap().accounts.len(), 1);
    let reads = memory.reads.lock().unwrap().clone();
    assert!(!reads
        .iter()
        .any(|id| id.ends_with(&aa.id) || id.ends_with(&bb.id)));
    assert!(account_sync::candidates(&c).unwrap().is_empty());
    println!("PASS a new device receives one logical account without probing any remote UUID credentials");
    // A third independently created UUID needs one confirmation; the whole component then converges.
    let d = state(&root.join("d"), &shared, vec![cc.clone()]);
    put(&cc.id, "SYNTHETIC-SAME-LOGIN");
    account_sync::sync(&d).unwrap();
    let source = account_sync::candidates(&d)
        .unwrap()
        .into_iter()
        .find(|x| x.pending)
        .unwrap()
        .id;
    account_sync::resolve(&d, &source, Some(&cc.id)).unwrap();
    account_sync::sync(&d).unwrap();
    for _ in 0..6 {
        for st in [&a, &b, &c, &d] {
            account_sync::sync(st).unwrap();
            assert_eq!(st.config.lock().unwrap().accounts.len(), 1);
            assert!(account_sync::candidates(st).unwrap().is_empty());
        }
    }
    let restarted = state(
        &root.join("d"),
        &shared,
        d.config.lock().unwrap().accounts.clone(),
    );
    account_sync::sync(&restarted).unwrap();
    assert_eq!(restarted.config.lock().unwrap().accounts[0].id, cc.id);
    println!("PASS transitive association, repeated exchange, stale v1 packets and restart do not recreate duplicate cards");
    {
        let mut cfg = a.config.lock().unwrap();
        cfg.accounts[0].label = "Edited once".into();
        a.store.save_config(&cfg).unwrap();
    }
    account_sync::sync(&a).unwrap();
    for st in [&b, &c, &d] {
        account_sync::sync(st).unwrap();
        assert_eq!(st.config.lock().unwrap().accounts[0].label, "Edited once");
    }
    for _ in 0..3 {
        for st in [&a, &b, &c, &d] {
            account_sync::sync(st).unwrap();
        }
    }
    let stable = fs::read(a.store.dir().join("account-sync-state.json")).unwrap();
    account_sync::sync(&a).unwrap();
    assert_eq!(
        stable,
        fs::read(a.store.dir().join("account-sync-state.json")).unwrap()
    );
    println!("PASS an edit made once reaches every associated device without ongoing edit churn");
    let mut imported = c.config.lock().unwrap().accounts[0].clone();
    imported.created_at = "2026-10-04T00:00:00Z".into();
    let imported_device = state(&root.join("imported-alias"), &shared, vec![imported]);
    for _ in 0..4 {
        for st in [&a, &b, &c, &d, &imported_device] {
            account_sync::sync(st).unwrap();
        }
    }
    let stable = fs::read(b.store.dir().join("account-sync-state.json")).unwrap();
    account_sync::sync(&b).unwrap();
    assert_eq!(
        stable,
        fs::read(b.store.dir().join("account-sync-state.json")).unwrap()
    );
    println!("PASS alias-imported UUIDs with different creation dates converge without edit timestamp churn");
    // A cloud client may temporarily omit another device's sidecar. Retained evidence must survive.
    let offline = root.join("offline-shared");
    fs::create_dir_all(offline.join("quota-accounts-v1")).unwrap();
    for file in fs::read_dir(shared.join("quota-accounts-v1")).unwrap() {
        let file = file.unwrap();
        fs::copy(
            file.path(),
            offline.join("quota-accounts-v1").join(file.file_name()),
        )
        .unwrap();
    }
    let mut opts = activity::options(a.store.dir());
    opts.sync_dir = offline.to_string_lossy().into();
    activity::save_options(a.store.dir(), &opts).unwrap();
    account_sync::sync(&a).unwrap();
    assert!(account_sync::candidates(&a).unwrap().is_empty());
    assert_eq!(a.config.lock().unwrap().accounts.len(), 1);
    let fresh = state(&root.join("fresh-offline"), &offline, vec![]);
    account_sync::sync(&fresh).unwrap();
    assert_eq!(fresh.config.lock().unwrap().accounts.len(), 1);
    opts.sync_dir = shared.to_string_lossy().into();
    activity::save_options(a.store.dir(), &opts).unwrap();
    println!("PASS retained and forwarded association evidence survives missing device files and a new device does not recreate aliases");
    // A remote decision cannot discard an existing local account with a conflicting login.
    let conflict = state(
        &root.join("conflict"),
        &shared,
        vec![aa.clone(), bb.clone()],
    );
    put(&bb.id, "SYNTHETIC-DIFFERENT-LOGIN");
    assert!(account_sync::sync(&conflict).is_err());
    assert_eq!(conflict.config.lock().unwrap().accounts.len(), 2);
    put(&bb.id, "SYNTHETIC-SAME-LOGIN");
    account_sync::sync(&conflict).unwrap();
    assert_eq!(conflict.config.lock().unwrap().accounts.len(), 1);
    println!("PASS different local logins are preserved and reported, not silently merged by a remote association");
    let links = shared.join("quota-account-links-v1");
    let device = uuid::Uuid::new_v4().to_string();
    let invalid = links.join(format!("{device}.json"));
    fs::write(&invalid,json!({"schema":1,"device":device,"associations":[{"source":aa.id,"target":bb.id,"provider":"deepseek","cookie":"SYNTHETIC-SECRET"}]}).to_string()).unwrap();
    let before = fs::read(c.store.dir().join("config.json")).unwrap();
    assert!(account_sync::sync(&c).is_err());
    assert_eq!(before, fs::read(c.store.dir().join("config.json")).unwrap());
    fs::remove_file(&invalid).unwrap();
    fs::write(&invalid,json!({"schema":1,"device":device,"associations":[{"source":aa.id,"target":bb.id,"provider":"mimo"}]}).to_string()).unwrap();
    assert!(account_sync::sync(&c).is_err());
    fs::remove_file(&invalid).unwrap();
    account_sync::sync(&c).unwrap();
    let deleted_id = c.config.lock().unwrap().accounts[0].id.clone();
    account_sync::remove_account(&c, &deleted_id).unwrap();
    for _ in 0..3 {
        account_sync::sync(&c).unwrap();
    }
    assert!(c.config.lock().unwrap().accounts.is_empty());
    for dir in [shared.join("quota-accounts-v1"), links] {
        for file in fs::read_dir(dir).unwrap() {
            let raw = fs::read_to_string(file.unwrap().path()).unwrap();
            let _: Value = serde_json::from_str(&raw).unwrap();
            assert!(
                !raw.contains("SYNTHETIC-")
                    && !raw.contains("LOCAL-ONLY")
                    && !raw.contains("mimoSession")
            );
        }
    }
    println!("PASS strict association whitelist/platform checks, local deletion and credential privacy preserved");
}
