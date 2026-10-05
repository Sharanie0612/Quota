//! No personal credentials or network. Run with cargo run --release --example product_checks.
use quota_lib::{display_version, open_backup, parse_ladder_rankings, parse_subscription_usage, seal_backup, AccountInput};
use serde_json::json;

fn main() {
    let mut input: AccountInput = serde_json::from_value(json!({"provider":"custom","label":"synthetic","manualCurrency":"%"})).unwrap();
    for value in [0.0, 42.5, 100.0] { input.manual_balance = Some(value); assert!(input.validate_numbers().is_ok()); }
    for value in [-1.0, 100.01, f64::NAN, f64::INFINITY] { input.manual_balance = Some(value); assert!(input.validate_numbers().is_err()); }
    input.manual_currency = Some("CNY".into()); input.manual_balance = Some(-0.15);
    assert!(input.validate_numbers().is_ok());
    for value in [-1.0, f64::NAN, f64::INFINITY] { input.low_balance_threshold = Some(value); assert!(input.validate_numbers().is_err()); }
    input.low_balance_threshold = Some(0.0); assert!(input.validate_numbers().is_ok());
    println!("PASS manual quota bounds, monetary overdraft and finite notification thresholds");
    if let Some(path) = std::env::args().nth(1) {
        let html = std::fs::read_to_string(path).expect("public source fixture");
        let live = parse_ladder_rankings(&html).expect("parse real AITier source");
        assert!(live.len() > 100);
        assert!(live.contains_key("mimo-v2-6-pro"));
        println!("PASS public AITier source: {} models", live.len());
    }
    let quota = parse_subscription_usage(&json!({"plan_type":"plus", "rate_limit": {
        "primary_window":{"used_percent":35.5,"limit_window_seconds":18000,"reset_at":1800000000},
        "secondary_window":{"used_percent":100,"limit_window_seconds":604800}
    }})).unwrap();
    assert_eq!(quota.windows[0].remaining, 64.5);
    assert_eq!(quota.windows[1].remaining, 0.0);
    assert_eq!(quota.windows[1].reset_at, None);
    assert!(parse_subscription_usage(&json!({"rate_limit":{"primary_window":{"used_percent":null}}})).is_err());
    assert!(parse_subscription_usage(&json!({"rate_limit":{"primary_window":{"used_percent":120}}})).is_err());
    let legacy = parse_subscription_usage(&json!({"rate_limits":{"primary_window":{"used_percent":0,"limit_window_seconds":2592000}}})).unwrap();
    assert_eq!(legacy.windows[0].label, "每月额度");
    println!("PASS subscription parsing: null, invalid percent, exhausted quota and legacy windows");

    let row = json!({"initialRankings":[
        {"modelId":"mimo-v2-6-pro","domain":"coding","rank":4,"score":97,"source":"artificial-analysis","updatedAt":"$D2026-10-03T10:00:00Z"},
        {"modelId":"bad","domain":"coding","rank":0,"score":999}
    ]});
    let description = "说明文字 without a newline";
    let rsc = format!("a:T{:x},{}4:{}\n", description.len(), description, json!(["$", "$L19", null, row]));
    let html = format!("<script>self.__next_f.push({})</script>", json!([1, rsc]));
    let parsed = parse_ladder_rankings(&html).unwrap();
    assert_eq!(parsed["mimo-v2-6-pro"]["coding"].rank, 4);
    assert!(!parsed.contains_key("bad"));
    assert!(parse_ladder_rankings("<html>layout changed</html>").is_err());
    println!("PASS ladder parsing: Next flight payload, validation and changed markup");

    let sealed = seal_backup("synthetic-test-password", b"synthetic payload").unwrap();
    assert_eq!(open_backup("synthetic-test-password", &sealed).unwrap(), b"synthetic payload");
    assert!(open_backup("wrong", &sealed).is_err());
    let mut damaged: serde_json::Value = serde_json::from_slice(&sealed).unwrap();
    damaged["nonce"] = json!("AA==");
    assert!(open_backup("test", &serde_json::to_vec(&damaged).unwrap()).is_err());
    damaged = serde_json::from_slice(&sealed).unwrap();
    damaged["iterations"] = json!(4294967295u32);
    assert!(open_backup("test", &serde_json::to_vec(&damaged).unwrap()).is_err());
    let shown = display_version();
    let fields: Vec<&str> = shown.split('.').collect();
    assert_eq!(fields.len(), 3);
    assert_eq!(fields[2].len(), 4);
    assert!(fields[2].bytes().all(|b| b.is_ascii_digit()));
    let mapped = format!("{}.{}.{}", fields[0], fields[1], fields[2].parse::<u32>().unwrap());
    assert_eq!(mapped, env!("CARGO_PKG_VERSION"));
    let package: serde_json::Value = serde_json::from_str(include_str!("../../package.json")).unwrap();
    assert_eq!(package["version"], env!("CARGO_PKG_VERSION"));
    println!("PASS backup round trip, wrong password, malformed metadata and display version");
}
