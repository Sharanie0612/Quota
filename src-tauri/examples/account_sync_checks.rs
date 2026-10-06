//! Synthetic shared folders only; never reads keyring or a personal cloud directory.
use quota_lib::{
    account_sync, activity, Account, AccountStatus, AppState, Balance, BalanceAmount, Store,
};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn state(dir: &Path, shared: &Path, accounts: Vec<Account>) -> AppState {
    std::env::set_var("QUOTA_DATA_DIR", dir);
    let store = Store::new().unwrap();
    let mut config = store.load_config();
    config.accounts = accounts;
    store.save_config(&config).unwrap();
    let state = AppState::new(store, config, vec![]);
    let mut options = activity::options(dir);
    options.sync_dir = shared.to_string_lossy().into();
    activity::save_options(dir, &options).unwrap();
    state
}
fn main() {
    let root =
        std::env::temp_dir().join(format!("quota-account-sync-check-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let account:Account=serde_json::from_value(json!({"id":id,"provider":"deepseek","label":"共享账户","createdAt":"2026-10-05T00:00:00Z","balanceMode":"auto","manualBalance":0,"manualSpendTotal":0,
        "baseUrl":"https://SENTINEL-URL","rechargeUrl":"SENTINEL-RECHARGE","note":"SENTINEL-NOTE","customHeaders":"Bearer SENTINEL-KEY","customBody":"SENTINEL-BODY","customUrl":"SENTINEL-CUSTOM","customJsonPath":"SENTINEL-PATH"})).unwrap();
    let shared = root.join("shared");
    let a = state(&root.join("a"), &shared, vec![account]);
    let b = state(&root.join("b"), &shared, vec![]);
    let plan=quota_lib::parse_subscription_usage(&json!({"plan_type":"SENTINEL-PLAN","rate_limit":{"primary_window":{"used_percent":35,"limit_window_seconds":18000}}})).unwrap();
    a.statuses.lock().unwrap().insert(
        id.clone(),
        AccountStatus {
            last_checked: Some("2026-10-05T00:00:00Z".into()),
            subscription: Some(plan),
            balance: Some(Balance {
                currency: "CNY".into(),
                total: Some(0.0),
                source: "SENTINEL-SOURCE".into(),
                usable: Some(false),
                note: Some("SENTINEL-BALANCE-NOTE".into()),
                raw: Some(json!({"access_token":"SENTINEL-TOKEN","cookie":"SENTINEL-COOKIE"})),
                amounts: vec![BalanceAmount {
                    kind: "spent".into(),
                    value: 12.0,
                    label: "SENTINEL-AMOUNT-LABEL".into(),
                }],
            }),
            ..Default::default()
        },
    );
    account_sync::sync(&a).unwrap();
    account_sync::sync(&b).unwrap();
    assert_eq!(b.config.lock().unwrap().accounts.len(), 1);
    let imported = b.config.lock().unwrap().accounts[0].clone();
    assert_eq!(imported.manual_balance, Some(0.0));
    assert!(imported.custom_headers.is_none());
    assert!(imported.base_url.is_none());
    let status = b.statuses.lock().unwrap()[&id].clone();
    assert_eq!(status.balance.unwrap().total, Some(0.0));
    assert_eq!(status.subscription.unwrap().windows[0].remaining, 65.0);
    for file in fs::read_dir(shared.join("quota-accounts-v1")).unwrap() {
        let body = fs::read_to_string(file.unwrap().path()).unwrap();
        assert!(
            !body.contains("SENTINEL"),
            "credential/private field leaked"
        );
        for key in [
            "apiKey",
            "accessKey",
            "cookie",
            "raw",
            "customHeaders",
            "customBody",
            "baseUrl",
            "note",
        ] {
            assert!(
                !body.contains(&format!("\"{key}\"")),
                "forbidden field {key}"
            );
        }
    }
    println!("PASS whitelist excludes credentials, raw responses, URLs, notes and free-form provider labels; zero and subscription windows preserved");
    {
        let mut cfg = b.config.lock().unwrap();
        cfg.accounts[0].custom_headers = Some("LOCAL-ONLY".into());
        b.store.save_config(&cfg).unwrap();
    }
    {
        let mut cfg = a.config.lock().unwrap();
        cfg.accounts[0].label = "新的账户名称".into();
        a.store.save_config(&cfg).unwrap();
    }
    account_sync::sync(&a).unwrap();
    account_sync::sync(&b).unwrap();
    account_sync::sync(&a).unwrap();
    assert_eq!(b.config.lock().unwrap().accounts[0].label, "新的账户名称");
    assert_eq!(
        b.config.lock().unwrap().accounts[0]
            .custom_headers
            .as_deref(),
        Some("LOCAL-ONLY")
    );
    assert_eq!(a.config.lock().unwrap().accounts.len(), 1);
    a.statuses
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .last_checked = Some("2026-10-04T00:00:00Z".into());
    a.statuses
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .balance
        .as_mut()
        .unwrap()
        .total = Some(999.0);
    account_sync::sync(&a).unwrap();
    account_sync::sync(&b).unwrap();
    assert_eq!(
        b.statuses.lock().unwrap()[&id]
            .balance
            .as_ref()
            .unwrap()
            .total,
        Some(0.0)
    );
    println!("PASS profile merge preserves local connections; repeat sync is idempotent; stale balance cannot overwrite newer snapshot");
    {
        let mut cfg = b.config.lock().unwrap();
        cfg.accounts.clear();
        b.store.save_config(&cfg).unwrap();
    }
    account_sync::sync(&b).unwrap();
    account_sync::sync(&a).unwrap();
    account_sync::sync(&b).unwrap();
    assert!(b.config.lock().unwrap().accounts.is_empty());
    assert_eq!(a.config.lock().unwrap().accounts.len(), 1);
    println!("PASS local deletion stays hidden and never deletes another device's account");
    let bad = shared
        .join("quota-accounts-v1")
        .join(format!("{}.json", uuid::Uuid::new_v4()));
    let packet_path = fs::read_dir(shared.join("quota-accounts-v1"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut packet: Value = serde_json::from_slice(&fs::read(packet_path).unwrap()).unwrap();
    packet["credentials"] = json!({"apiKey":"FORBIDDEN"});
    fs::write(&bad, serde_json::to_vec(&packet).unwrap()).unwrap();
    assert!(account_sync::sync(&a).is_err());
    assert_eq!(a.config.lock().unwrap().accounts.len(), 1);
    fs::remove_file(bad).unwrap();
    let mut options = activity::options(a.store.dir());
    options.sync_accounts = false;
    activity::save_options(a.store.dir(), &options).unwrap();
    account_sync::sync(&a).unwrap();
    println!("PASS unknown/secret fields fail closed without changing accounts; disabled sync performs no exchange");
    let device_id = options.device_id.clone();
    options.sync_accounts = true;
    options.device_id = "../../invalid-device".into();
    activity::save_options(a.store.dir(), &options).unwrap();
    assert!(account_sync::sync(&a).is_err());
    options.device_id = device_id;
    activity::save_options(a.store.dir(), &options).unwrap();
    println!(
        "PASS invalid device IDs cannot select an output path outside the account-sync folder"
    );
    let cold = state(&root.join("cold"), &shared, vec![]);
    account_sync::sync(&cold).unwrap();
    assert_eq!(
        cold.statuses.lock().unwrap()[&id]
            .balance
            .as_ref()
            .unwrap()
            .total,
        Some(0.0)
    );
    println!("PASS restart restores display snapshot without credential access");
    // The account form stores '%' even when an automatic subscription has no
    // manual balance. It must not block the entire shared account exchange.
    let percent_shared = root.join("percent-shared");
    let mut percent_accounts = vec![];
    for provider in ["mimo-plan", "custom"] {
        for manual_balance in [None, Some(0.0), Some(65.0), Some(100.0)] {
            percent_accounts.push(serde_json::from_value(json!({
                "id":uuid::Uuid::new_v4().to_string(), "provider":provider,
                "label":"百分比订阅", "createdAt":"2026-10-05T00:00:00Z",
                "balanceMode":if manual_balance.is_some(){"manual"}else if provider=="custom"{"codex"}else{"console"},
                "manualBalance":manual_balance, "manualCurrency":"%",
                "manualRechargeCurrency":"CNY", "manualSpendCurrency":"CNY"
            })).unwrap());
        }
    }
    let percent_a = state(&root.join("percent-a"), &percent_shared, percent_accounts.clone());
    let percent_b = state(&root.join("percent-b"), &percent_shared, vec![]);
    for account in &percent_accounts {
        if let Some(total) = account.manual_balance {
            percent_a.statuses.lock().unwrap().insert(account.id.clone(), AccountStatus {
                last_checked: Some("2026-10-05T00:00:00Z".into()),
                balance: Some(Balance { currency:"%".into(), total:Some(total),
                    source:"manual".into(), usable:None, note:None, raw:None, amounts:vec![] }),
                ..Default::default()
            });
        }
    }
    account_sync::sync(&percent_a).unwrap();
    account_sync::sync(&percent_b).unwrap();
    account_sync::sync(&percent_a).unwrap();
    account_sync::sync(&percent_b).unwrap();
    let imported = percent_b.config.lock().unwrap();
    assert_eq!(imported.accounts.len(), percent_accounts.len());
    for original in &percent_accounts {
        let copy = imported.accounts.iter().find(|a| a.id==original.id).unwrap();
        assert_eq!(copy.manual_currency.as_deref(), Some("%"));
        assert_eq!(copy.manual_balance, original.manual_balance);
        if let Some(total) = original.manual_balance {
            let statuses = percent_b.statuses.lock().unwrap();
            let balance = statuses[&original.id].balance.as_ref().unwrap();
            assert_eq!(balance.currency, "%");
            assert_eq!(balance.total, Some(total));
        }
    }
    drop(imported);
    println!("PASS automatic and manual MiMo/ChatGPT percentage profiles and snapshots sync across devices; absent, zero, 65 and 100 stay distinct; repeat sync is idempotent");
    for invalid in [-1.0, 101.0] {
        percent_a.config.lock().unwrap().accounts[0].manual_balance = Some(invalid);
        assert!(account_sync::sync(&percent_a).is_err());
    }
    percent_a.config.lock().unwrap().accounts[0].manual_balance = None;
    for field in ["manualRechargeCurrency", "manualSpendCurrency", "manualCurrency"] {
        let invalid_account = serde_json::from_value(json!({
            "id":uuid::Uuid::new_v4().to_string(), "provider":"mimo-plan",
            "label":"无效单位", "createdAt":"2026-10-05T00:00:00Z",
            (field):if field=="manualCurrency"{"FORBIDDEN-UNIT"}else{"%"}
        })).unwrap();
        let invalid_state = state(&root.join(field), &root.join(format!("invalid-{field}")), vec![invalid_account]);
        assert!(account_sync::sync(&invalid_state).is_err());
    }
    println!("PASS percentages outside 0..100, percentages used as spend/recharge currencies and unknown units are rejected");
    fs::remove_dir_all(root).unwrap();
}
