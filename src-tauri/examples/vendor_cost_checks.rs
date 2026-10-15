//! Isolated monetary fixtures; no personal credentials or network requests.
use chrono::TimeZone;
use quota_lib::{
    activity,
    vendor_costs::{self, Expense},
    Account, AppState, Store,
};
use serde_json::json;
use std::fs;
fn bill(currency: &str, amount: f64) -> Expense {
    Expense {
        vendor: "custom".into(),
        from: "2026-10-01".into(),
        to: "2026-10-31".into(),
        currency: currency.into(),
        subscription: Some(amount),
        usage: None,
        plan_id: None,
    }
}
fn main() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/vendor-cost-checks")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("QUOTA_DATA_DIR", &root);
    let store = Store::new().unwrap();
    let mut cfg = store.load_config();
    let account:Account=serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"provider":"deepseek","label":"Synthetic","createdAt":"2026-10-01T00:00:00Z"})).unwrap();
    cfg.accounts = vec![account.clone()];
    let state = AppState::new(store, cfg, vec![]);
    let mut public = bill("USD", 20.0);
    public.plan_id = Some("plus".into());
    vendor_costs::save_expense(&root, public.clone()).unwrap();
    public.to = "2026-10-30".into();
    assert!(vendor_costs::save_expense(&root, public.clone()).is_err());
    public.to = "2026-10-31".into();
    public.subscription = Some(21.0);
    assert!(vendor_costs::save_expense(&root, public).is_err());
    let original = fs::read(root.join("vendor-costs.json")).unwrap();
    let mut bad = bill("USD", f64::NAN);
    assert!(vendor_costs::save_expense(&root, bad.clone()).is_err());
    assert_eq!(original, fs::read(root.join("vendor-costs.json")).unwrap());
    bad.subscription = Some(5.0);
    bad.from = "2026-10-20".into();
    assert!(vendor_costs::save_expense(&root, bad).is_err());
    vendor_costs::save_expense(&root, bill("CNY", 100.0)).unwrap();
    activity::report(&root, None, None, None).unwrap();
    let db = rusqlite::Connection::open(root.join("activity.sqlite")).unwrap();
    for (id, day, model, total) in [
        (1, 2, "gpt-6-high", 1000),
        (2, 3, "gpt-6-low", 2000),
        (3, 2, "GLM-5", 5000),
        (4, 15, "gpt-6-high", 9000),
    ] {
        let mut at = chrono::Local
            .with_ymd_and_hms(2026, 10, day, 0, 0, 0)
            .unwrap()
            .timestamp_millis();
        if id == 4 {
            at = (chrono::Utc::now() + chrono::Duration::days(1)).timestamp_millis();
        }
        let e = activity::Metric {
            channel: String::new(),
            id: format!("{id:064x}"),
            device: uuid::Uuid::new_v4().to_string(),
            source: "codex".into(),
            session: "synthetic".into(),
            model: model.into(),
            agent: "主 Agent".into(),
            tool: String::new(),
            timestamp: at,
            kind: "tokens".into(),
            revision: 0,
            tokens: activity::Tokens {
                input: total - 100,
                output: 100,
                cached: 500,
                reasoning: 50,
                total,
                ..Default::default()
            },
        };
        activity::merge_metric(&db, &e, false).unwrap();
    }
    drop(db);
    let report = vendor_costs::report(&state, "2026-10-01", "2026-10-31").unwrap();
    assert_eq!(report.expenses.len(), 2);
    assert_eq!(
        report.covered_models["custom"]
            .iter()
            .map(|m| m.tokens.total)
            .sum::<u64>(),
        3000
    );
    assert_eq!(
        vendor_costs::report(&state, "2026-10-01", "2026-10-14")
            .unwrap()
            .covered_models["custom"]
            .iter()
            .map(|g| g.tokens.total)
            .sum::<u64>(),
        3000
    );
    let db = rusqlite::Connection::open(root.join("activity.sqlite")).unwrap();
    let body: String = db
        .query_row(
            "SELECT body FROM metrics WHERE id=?1",
            [format!("{:064x}", 1)],
            |r| r.get(0),
        )
        .unwrap();
    let mut excluded: activity::Metric = serde_json::from_str(&body).unwrap();
    excluded.id = format!("{:064x}", 5);
    excluded.source = "trae".into();
    excluded.tokens.total = 50_000;
    activity::merge_metric(&db, &excluded, false).unwrap();
    drop(db);
    let priced = vendor_costs::report(&state, "2026-10-01", "2026-10-31").unwrap();
    assert_eq!(priced.lifetime_tokens.total, 8000);
    assert_eq!(
        priced.covered_models["custom"]
            .iter()
            .map(|g| g.tokens.total)
            .sum::<u64>(),
        3000
    );
    assert_eq!(
        activity::report_range(
            &root,
            None,
            Some("without-trae".into()),
            None,
            None,
            Some("2026-10-01".into()),
            Some("2026-10-31".into())
        )
        .unwrap()
        .totals
        .tokens
        .total,
        8000
    );
    assert_eq!(
        activity::report_range(
            &root,
            None,
            None,
            None,
            None,
            Some("2026-10-01".into()),
            Some("2026-10-31".into())
        )
        .unwrap()
        .totals
        .tokens
        .total,
        58000
    );
    println!("PASS Trae excluded from price denominator, selected usage and lifetime totals; original Token activity preserved");
    let at = |day| {
        chrono::Local
            .with_ymd_and_hms(2026, 10, day, 0, 0, 0)
            .unwrap()
    };
    for (day, recharge, spend) in [
        (1, 40.0, 10.0),
        (2, 50.0, 12.0),
        (3, 50.0, 12.0),
        (4, 50.0, 12.0),
        (5, 50.0, 14.0),
    ] {
        let status = quota_lib::AccountStatus {
            last_checked: Some(at(day).to_rfc3339()),
            balance: Some(quota_lib::Balance {
                currency: "CNY".into(),
                total: Some(recharge - spend),
                source: "api".into(),
                amounts: vec![
                    quota_lib::BalanceAmount {
                        label: "累计充值".into(),
                        kind: "cumulative_recharge".into(),
                        value: recharge,
                    },
                    quota_lib::BalanceAmount {
                        label: "累计消费".into(),
                        kind: "cumulative_spend".into(),
                        value: spend,
                    },
                ],
                usable: None,
                note: None,
                raw: None,
            }),
            ..Default::default()
        };
        state
            .statuses
            .lock()
            .unwrap()
            .insert(account.id.clone(), status);
        vendor_costs::capture(&state, &account).unwrap();
    }
    let data: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("vendor-costs.json")).unwrap()).unwrap();
    assert_eq!(data["samples"][&account.id].as_array().unwrap().len(), 4);
    let report = vendor_costs::report(&state, "2026-10-01", "2026-10-31").unwrap();
    assert_eq!(report.accounts[0].observed_recharge, Some(10.0));
    assert_eq!(report.accounts[0].observed_spend, Some(4.0));
    assert_eq!(report.accounts[0].cumulative_recharge, Some(50.0));
    let mut status = state.statuses.lock().unwrap()[&account.id].clone();
    status.last_checked = Some(at(6).to_rfc3339());
    status.balance.as_mut().unwrap().amounts[1].value = 1.0;
    state
        .statuses
        .lock()
        .unwrap()
        .insert(account.id.clone(), status.clone());
    vendor_costs::capture(&state, &account).unwrap();
    assert!(vendor_costs::report(&state, "2026-10-01", "2026-10-31")
        .unwrap()
        .accounts[0]
        .observed_spend
        .is_none());
    status.last_checked = Some(at(7).to_rfc3339());
    status.balance.as_mut().unwrap().currency = "Credits".into();
    state
        .statuses
        .lock()
        .unwrap()
        .insert(account.id.clone(), status);
    let original = fs::read(root.join("vendor-costs.json")).unwrap();
    vendor_costs::capture(&state, &account).unwrap();
    assert_eq!(original, fs::read(root.join("vendor-costs.json")).unwrap());
    let mut clear = bill("USD", 0.0);
    clear.subscription = None;
    vendor_costs::save_expense(&root, clear).unwrap();
    assert_eq!(
        vendor_costs::report(&state, "2026-10-01", "2026-10-31")
            .unwrap()
            .expenses
            .len(),
        1
    );
    println!("PASS public plan price/cycle, invalid-write preservation, overlapping period rejection, currencies, covered token union, future exclusion and clipped dates, recharge/spend changes, bounded unchanged sampling, counter reset, Credits exclusion, record deletion");
    let before = bill("USD", 20.0);
    vendor_costs::save_expense(&root, before.clone()).unwrap();
    let mut moved = before.clone();
    moved.from = "2026-10-15".into();
    moved.to = "2026-11-14".into();
    vendor_costs::update_expense(&root, moved.clone(), Some(before.clone())).unwrap();
    let records = vendor_costs::report(&state, "2026-10-01", "2026-10-31")
        .unwrap()
        .expenses;
    assert_eq!(records.len(), 2);
    assert!(records.iter().any(|e| e == &moved));
    assert!(!records.iter().any(|e| e == &before));
    let intact = fs::read(root.join("vendor-costs.json")).unwrap();
    assert!(vendor_costs::update_expense(&root, before.clone(), Some(before.clone())).is_err());
    assert_eq!(intact, fs::read(root.join("vendor-costs.json")).unwrap());
    let mut overlap = moved.clone();
    overlap.currency = "CNY".into();
    assert!(vendor_costs::update_expense(&root, overlap, Some(moved.clone())).is_err());
    assert_eq!(intact, fs::read(root.join("vendor-costs.json")).unwrap());
    let mut duplicate = bill("CNY", 100.0);
    assert!(vendor_costs::update_expense(&root, duplicate.clone(), Some(moved.clone())).is_err());
    assert_eq!(intact, fs::read(root.join("vendor-costs.json")).unwrap());
    duplicate = moved.clone();
    duplicate.subscription = None;
    vendor_costs::update_expense(&root, duplicate, Some(moved)).unwrap();
    assert_eq!(
        vendor_costs::report(&state, "2026-10-01", "2026-10-31")
            .unwrap()
            .expenses
            .len(),
        1
    );
    println!("PASS atomic bill date replacement, stale editor protection, overlap and target collision rollback, original bill deletion");
    let resolved = root.canonicalize().unwrap();
    assert!(resolved.starts_with(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .canonicalize()
            .unwrap()
    ));
    fs::remove_dir_all(resolved).unwrap();
}
