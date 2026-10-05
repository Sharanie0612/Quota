//! Runs production persistence against a fresh directory under target/, without credentials.
use quota_lib::{AppConfig, Store};
use serde_json::json;
use std::{fs, sync::{Arc, Mutex}};

fn main() {
    let root = std::env::current_dir().unwrap().join("target").join("config-checks").join(uuid::Uuid::new_v4().to_string());
    let previous = std::env::var_os("QUOTA_DATA_DIR");
    std::env::set_var("QUOTA_DATA_DIR", &root);
    let store = Arc::new(Store::new().unwrap());
    if let Some(value) = previous { std::env::set_var("QUOTA_DATA_DIR", value); } else { std::env::remove_var("QUOTA_DATA_DIR"); }
    assert_eq!(store.dir(), root);
    let mut config = AppConfig::default();
    config.accounts.push(serde_json::from_value(json!({
        "id":"synthetic", "provider":"deepseek", "label":"原账户", "createdAt":"2026-10-04T00:00:00+08:00",
        "lowBalanceThreshold":20, "manualBalance":128.5, "manualCurrency":"CNY", "balanceMode":"manual"
    })).unwrap());
    store.save_config(&config).unwrap();
    let original = serde_json::to_value(&config).unwrap();
    let original_file = fs::read(root.join("config.json")).unwrap();

    // An actual filesystem write failure, not a simulated Result from the helper.
    fs::create_dir(root.join("config.json.tmp")).unwrap();
    assert!(store.update_config(&mut config, |next| {
        next.accounts.clear(); next.settings.refresh_interval_minutes = 47;
    }).is_err());
    assert_eq!(serde_json::to_value(&config).unwrap(), original);
    assert_eq!(fs::read(root.join("config.json")).unwrap(), original_file);
    fs::remove_dir(root.join("config.json.tmp")).unwrap();
    println!("PASS failed write preserves account, settings, memory and original file");

    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        // Share reads but deny delete/replace to force the Windows atomic rename to fail.
        let locked = fs::OpenOptions::new().read(true).share_mode(1).open(root.join("config.json")).unwrap();
        assert!(store.update_config(&mut config, |next| next.accounts[0].label = "未保存".into()).is_err());
        assert_eq!(serde_json::to_value(&config).unwrap(), original);
        assert_eq!(fs::read(root.join("config.json")).unwrap(), original_file);
        drop(locked);
        println!("PASS Windows replace failure preserves original file and memory");
    }

    store.update_config(&mut config, |next| {
        next.accounts[0].manual_balance = Some(5.25); next.settings.refresh_interval_minutes = 47;
    }).unwrap();
    assert_eq!(config.accounts[0].manual_balance, Some(5.25));
    assert_eq!(serde_json::to_value(store.load_config()).unwrap(), serde_json::to_value(&config).unwrap());
    println!("PASS retry persists manual balance and settings before committing memory");

    let current = Arc::new(Mutex::new(config));
    let threads: Vec<_> = (0..2).map(|_| {
        let current = Arc::clone(&current); let store = Arc::clone(&store);
        std::thread::spawn(move || for _ in 0..25 {
            let mut locked = current.lock().unwrap();
            store.update_config(&mut locked, |next| next.accounts[0].low_balance_threshold += 1.0).unwrap();
        })
    }).collect();
    for thread in threads { thread.join().unwrap(); }
    let config = current.lock().unwrap();
    assert_eq!(config.accounts[0].low_balance_threshold, 70.0);
    assert_eq!(serde_json::to_value(store.load_config()).unwrap(), serde_json::to_value(&*config).unwrap());
    println!("PASS concurrent updates retain all changes in memory and on disk");

    // Startup recovery must distinguish absent files from unreadable/corrupt files.
    let guarded_root = root.join("guarded");
    let guarded = isolated_store(&guarded_root);
    assert!(guarded.load_config().accounts.is_empty());
    assert!(guarded.load_overrides().is_empty());
    assert!(guarded.load_hidden_models().is_empty());
    assert!(guarded.read_issues().is_empty());
    guarded.save_config(&AppConfig::default()).unwrap();
    guarded.save_overrides(&[]).unwrap();
    guarded.save_hidden_models(&[]).unwrap();
    guarded.ensure_core_files_writable().unwrap();
    println!("PASS truly missing files initialize normally");

    let secret_marker = "synthetic-private-value-never-log";
    fs::write(guarded_root.join("config.json"), format!("{{\"accounts\":\"{secret_marker}\"}}")).unwrap();
    fs::write(guarded_root.join("catalog_overrides.json"), b"[").unwrap();
    fs::write(guarded_root.join("hidden_models.json"), b"[42]").unwrap();
    let originals: Vec<_> = ["config.json", "catalog_overrides.json", "hidden_models.json"].iter()
        .map(|name| fs::read(guarded_root.join(name)).unwrap()).collect();
    let mut fallback = guarded.load_config();
    assert!(guarded.load_overrides().is_empty());
    assert!(guarded.load_hidden_models().is_empty());
    assert_eq!(guarded.read_issues().len(), 3);
    assert!(!guarded.read_issues().join(" ").contains(secret_marker));
    let error = guarded.update_config(&mut fallback, |next| next.settings.refresh_interval_minutes = 79).unwrap_err();
    assert!(!error.contains(secret_marker));
    assert_ne!(fallback.settings.refresh_interval_minutes, 79);
    assert!(guarded.save_overrides(&[]).is_err());
    assert!(guarded.save_hidden_models(&[]).is_err());
    assert!(guarded.ensure_core_files_writable().is_err());
    for (index, name) in ["config.json", "catalog_overrides.json", "hidden_models.json"].iter().enumerate() {
        assert_eq!(fs::read(guarded_root.join(name)).unwrap(), originals[index]);
        assert!(!guarded_root.join(name).with_extension("json.tmp").exists());
    }
    println!("PASS corrupt core files remain unchanged; defaults cannot overwrite them; errors omit private values");

    // A repair requires restart, so a stale default in memory cannot replace repaired data.
    fs::write(guarded_root.join("config.json"), &original_file).unwrap();
    fs::write(guarded_root.join("catalog_overrides.json"), b"[]").unwrap();
    fs::remove_file(guarded_root.join("hidden_models.json")).unwrap();
    assert!(guarded.save_config(&fallback).is_err());
    assert!(guarded.save_hidden_models(&[]).is_err());
    let restarted = isolated_store(&guarded_root);
    assert_eq!(restarted.load_config().accounts.len(), 1);
    restarted.ensure_core_files_writable().unwrap();
    assert!(restarted.read_issues().is_empty());
    restarted.save_hidden_models(&[]).unwrap();
    println!("PASS repair/removal cannot unlock stale memory; restart reloads recovered data");

    // Do not require an initial load for protection; detect corruption at save time too.
    fs::write(guarded_root.join("catalog_overrides.json"), b"null").unwrap();
    assert!(restarted.save_overrides(&[]).is_err());
    assert_eq!(fs::read(guarded_root.join("catalog_overrides.json")).unwrap(), b"null");
    let unreadable_root = root.join("unreadable");
    let unreadable = isolated_store(&unreadable_root);
    fs::create_dir(unreadable_root.join("config.json")).unwrap();
    assert!(unreadable.load_config().accounts.is_empty());
    assert_eq!(unreadable.read_issues().len(), 1);
    assert!(unreadable.save_config(&AppConfig::default()).is_err());
    assert!(unreadable_root.join("config.json").is_dir());
    println!("PASS runtime corruption and unreadable path fail safely without overwriting");
}

fn isolated_store(root: &std::path::Path) -> Store {
    let previous = std::env::var_os("QUOTA_DATA_DIR");
    std::env::set_var("QUOTA_DATA_DIR", root);
    let store = Store::new().unwrap();
    if let Some(value) = previous { std::env::set_var("QUOTA_DATA_DIR", value); } else { std::env::remove_var("QUOTA_DATA_DIR"); }
    store
}
