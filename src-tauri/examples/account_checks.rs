//! Production account fallback and GLM parsing checks. Synthetic input only; no credentials or network.
use quota_lib::{apply_manual_balance, parse_subscription_usage, parse_zhipu_report, Account, AccountStatus};
use serde_json::json;

fn main() {
    let mut account: Account = serde_json::from_value(json!({
        "id":"synthetic-account", "provider":"custom", "label":"Synthetic",
        "createdAt":"2026-10-04T00:00:00Z", "balanceMode":"codex",
        "manualBalance":42.5, "manualCurrency":"%"
    })).unwrap();
    let mut status = AccountStatus::default();
    apply_manual_balance(&account, &mut status);
    assert_eq!(status.balance.as_ref().unwrap().total, Some(42.5));
    assert_eq!(status.balance.as_ref().unwrap().currency, "%");
    assert!(status.last_checked.is_none());
    println!("PASS saved manual fallback visible before first refresh; no invented sync time");

    let mut status = AccountStatus::default();
    status.subscription = Some(parse_subscription_usage(&json!({
        "plan_type":"plus", "rate_limit":{"primary_window":{"used_percent":35.5,"limit_window_seconds":18000}}
    })).unwrap());
    apply_manual_balance(&account, &mut status);
    assert!(status.balance.is_none());
    assert_eq!(status.subscription.as_ref().unwrap().windows[0].remaining, 64.5);
    println!("PASS successful automatic subscription not hidden by backup manual value");

    account.balance_mode = Some("manual".into());
    account.manual_balance = Some(0.0);
    status.balance_error = Some("old automatic failure".into());
    apply_manual_balance(&account, &mut status);
    assert!(status.subscription.is_none());
    assert!(status.balance_error.is_none());
    assert_eq!(status.balance.as_ref().unwrap().total, Some(0.0));
    account.manual_balance = None;
    apply_manual_balance(&account, &mut status);
    assert!(status.balance.is_none());
    println!("PASS explicit manual mode overrides stale automatic data, preserves zero and clears removed value");

    let balance = parse_zhipu_report(r#"{"success":true,"data":{"availableBalance":0,"giveAmount":0,"rechargeAmount":20,"totalSpendAmount":20}}"#, "Synthetic GLM").unwrap();
    assert_eq!(balance.amounts.iter().find(|item| item.kind == "granted").unwrap().value, 0.0);
    assert_eq!(balance.amounts.iter().find(|item| item.kind == "cumulative_recharge").unwrap().value, 20.0);
    assert_eq!(balance.amounts.iter().find(|item| item.kind == "cumulative_spend").unwrap().value, 20.0);
    let missing = parse_zhipu_report(r#"{"success":true,"data":{"availableBalance":0}}"#, "Synthetic GLM").unwrap();
    assert!(!missing.amounts.iter().any(|item| item.kind == "granted"));
    println!("PASS GLM zero gift distinguished from missing; cumulative recharge distinct from cash balance");
    let valid: quota_lib::AccountInput = serde_json::from_value(json!({"provider":"deepseek","label":"Synthetic","manualRechargeTotal":0,"manualRechargeCurrency":"USD"})).unwrap();
    assert!(valid.validate_numbers().is_ok());
    let mut invalid = valid.clone(); invalid.manual_recharge_total=Some(-1.0); assert!(invalid.validate_numbers().is_err());
    invalid.manual_recharge_total=Some(f64::NAN); assert!(invalid.validate_numbers().is_err());
    invalid.manual_recharge_total=Some(10.0); invalid.manual_recharge_currency=Some("%".into()); assert!(invalid.validate_numbers().is_err());
    println!("PASS manual cumulative recharge numeric/currency validation");
    let mut spend = valid.clone(); spend.manual_spend_total=Some(0.0); spend.manual_spend_currency=Some("USD".into()); assert!(spend.validate_numbers().is_ok());
    spend.manual_spend_total=Some(-1.0); assert!(spend.validate_numbers().is_err());
    spend.manual_spend_total=Some(f64::NAN); assert!(spend.validate_numbers().is_err());
    spend.manual_spend_total=Some(1.0); spend.manual_spend_currency=Some("%".into()); assert!(spend.validate_numbers().is_err());
    let money=quota_lib::parse_balance(r#"{"code":0,"data":{"balance":"10","totalSpendAmount":"0"}}"#).unwrap(); assert_eq!(money.cumulative_spend,Some(0.0));
    let money=quota_lib::parse_balance(r#"{"code":0,"data":{"balance":"10","rechargeAmount":"40","used":"100"}}"#).unwrap(); assert_eq!(money.cumulative_spend,None);
    println!("PASS spend validation and MiMo explicit consumption only; old config compatible");
}
