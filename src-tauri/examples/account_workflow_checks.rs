//! Exercise account edits and production snapshot/history handling with synthetic provider results.
#[path = "support/memory_keyring.rs"]
mod memory_keyring;

use memory_keyring::MemoryKeyring;
use quota_lib::{accounts, get_secrets, Account, AccountInput, AccountStatus, AppState, Store};
use serde_json::{json, Value};

fn input(fields: Value) -> AccountInput {
    serde_json::from_value(fields).unwrap()
}

fn saved(state: &AppState) -> Account {
    let config = state.store.load_config();
    assert_eq!(config.accounts.len(), 1);
    config.accounts.into_iter().next().unwrap()
}

fn sample(state: &AppState, account: &Account, at: &str) -> Option<accounts::RechargeEvent> {
    accounts::record_status(
        state,
        account,
        AccountStatus {
            last_checked: Some(at.into()),
            ..Default::default()
        },
    )
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let root =
        std::env::temp_dir().join(format!("quota-account-workflow-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    std::env::set_var("QUOTA_DATA_DIR", &root);
    let keyring = MemoryKeyring::default();
    keyring::set_default_credential_builder(Box::new(keyring.clone()));
    let store = Store::new().unwrap();
    let mut config = store.load_config();
    config.settings.notify_recharge = true;
    let state = AppState::new(store, config, vec![]);

    let mut fields = json!({
        "provider": "custom", "label": "  Fixture  ", "balanceMode": "manual",
        "manualBalance": 0, "manualCurrency": " CNY ", "lowBalanceThreshold": 10,
        "apiKey": "fixture-only", "note": "old note"
    });
    let id = accounts::save(&state, input(fields.clone())).await.unwrap();
    let original = saved(&state);
    assert_eq!(original.label, "Fixture");
    assert!(!std::fs::read_to_string(root.join("config.json"))
        .unwrap()
        .contains("fixture-only"));
    assert_eq!(
        get_secrets(&id).unwrap().api_key.as_deref(),
        Some("fixture-only")
    );
    keyring.reads.lock().unwrap().clear();
    assert!(accounts::has_low_balance(&state, &original));
    assert!(keyring.reads.lock().unwrap().is_empty());
    assert!(accounts::view(&state, &original).low);
    assert!(sample(&state, &original, "2026-11-01T00:00:00Z").is_none());

    fields["id"] = json!(id);
    // Editing a legacy account keeps its stored provider and creation time.
    fields["provider"] = json!("deepseek");
    fields["manualBalance"] = json!(25);
    fields["apiKey"] = Value::Null;
    fields["note"] = json!("  ");
    assert_eq!(
        accounts::save(&state, input(fields.clone())).await.unwrap(),
        id
    );
    let edited = saved(&state);
    assert_eq!(edited.created_at, original.created_at);
    assert_eq!(edited.provider, original.provider);
    assert!(edited.note.is_none());
    assert!(!accounts::has_low_balance(&state, &edited));
    assert!(!accounts::view(&state, &edited).low);
    let event = sample(&state, &edited, "2026-11-01T00:01:00Z").unwrap();
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "accountId": id, "label": "Fixture", "currency": "CNY", "amount": 25.0, "total": 25.0
        })
    );
    assert!(sample(&state, &edited, "2026-11-01T00:02:00Z").is_none());

    fields["provider"] = json!("custom");
    state.config.lock().unwrap().settings.notify_recharge = false;
    fields["manualBalance"] = json!(100);
    accounts::save(&state, input(fields.clone())).await.unwrap();
    assert!(sample(&state, &saved(&state), "2026-11-01T00:03:00Z").is_none());
    let history = state.history.lock().unwrap().export_points();
    assert_eq!(history[&id].last().unwrap().v, 100.0);
    let last_checked = state.statuses.lock().unwrap()[&id]
        .last_checked
        .clone()
        .unwrap();

    fields["balanceMode"] = json!("codex");
    fields["manualBalance"] = Value::Null;
    accounts::save(&state, input(fields.clone())).await.unwrap();
    let automatic = saved(&state);
    let failed_query = AccountStatus {
        last_checked: Some("2026-11-01T00:04:00Z".into()),
        balance_error: Some("fixture provider unavailable".into()),
        ..Default::default()
    };
    assert!(accounts::record_status(&state, &automatic, failed_query).is_none());
    let view = accounts::view(&state, &automatic);
    assert!(view.status.balance_error.is_some());
    assert_eq!(view.status.last_checked, Some(last_checked));
    assert_eq!(view.status.balance.unwrap().total, Some(100.0));
    assert_eq!(
        state.history.lock().unwrap().export_points()[&id].len(),
        history[&id].len()
    );

    fields["connectionId"] = json!("expired-fixture");
    fields["label"] = json!("must not be saved");
    assert!(accounts::save(&state, input(fields.clone())).await.is_err());
    assert_eq!(saved(&state).label, "Fixture");
    assert_eq!(
        get_secrets(&id).unwrap().api_key.as_deref(),
        Some("fixture-only")
    );
    let pending_id = "pending-fixture";
    state
        .pending_connections
        .lock()
        .unwrap()
        .insert(pending_id.into(), "custom".into());
    keyring::Entry::new("Quota", pending_id)
        .unwrap()
        .set_password(&json!({"subscriptionAccount": "fixture-subscription"}).to_string())
        .unwrap();
    fields["connectionId"] = json!(pending_id);
    fields["label"] = json!("Fixture");
    accounts::save(&state, input(fields)).await.unwrap();
    let credentials = get_secrets(&id).unwrap();
    assert_eq!(credentials.api_key.as_deref(), Some("fixture-only"));
    assert_eq!(
        credentials.subscription_account.as_deref(),
        Some("fixture-subscription")
    );
    assert!(!state
        .pending_connections
        .lock()
        .unwrap()
        .contains_key(pending_id));
    assert!(get_secrets(pending_id)
        .unwrap()
        .subscription_account
        .is_none());

    accounts::remove(&state, &id).unwrap();
    assert!(state.store.load_config().accounts.is_empty());
    assert!(!state.statuses.lock().unwrap().contains_key(&id));
    assert!(!state
        .history
        .lock()
        .unwrap()
        .export_points()
        .contains_key(&id));
    assert!(get_secrets(&id).unwrap().api_key.is_none());
    drop(state);
    std::fs::remove_dir_all(&root).unwrap();
    println!("PASS account persistence, credential isolation, low balance, recharge, failed refresh and removal");
}
