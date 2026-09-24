//! MiMo 控制台返回解析的验证：走与主程序相同的解析代码。
//! 运行：cargo run --release --example mimo_console
//! 样例结构全部取自**实测返回**（2026-09-23 用真实 Cookie 调 platform.xiaomimimo.com），
//! 其中余额是负数（欠费）的情况也覆盖到了。

use quota_lib::{parse_balance, parse_plan_detail, parse_token_plan_usage};

/// 实测 /api/v1/balance（金额是字符串，含负数）
const BALANCE: &str = r#"{"code":0,"message":"","data":{"balance":"-0.15","frozenBalance":"0.00","currency":"CNY","overdraftLimit":"0.00","remainingOverdraftLimit":"0.00","giftBalance":"0.00","cashBalance":"0.00"}}"#;

/// 实测 /api/v1/tokenPlan/usage
const USAGE: &str = r#"{"code":0,"message":"","data":{
    "monthUsage":{"percent":0.1293,"items":[{"name":"month_total_token","used":530082816,"limit":4100000000,"percent":0.1293}]},
    "usage":{"percent":0.13,"items":[
        {"name":"plan_total_token","used":530082816,"limit":4100000000,"percent":0.13},
        {"name":"compensation_total_token","used":0,"limit":0,"percent":0}]}
}}"#;

/// 实测 /api/v1/tokenPlan/detail
const PLAN: &str = r#"{"code":0,"message":"","data":{"planCode":"lite","planName":"Lite","currentPeriodEnd":"2026-10-23 23:59:59","expired":false,"enableAutoRenew":true,"autoRenewDiscount":null,"hasAutoRenewSubscribed":true,"clawEnabled":false,"clawPeriodEnd":null,"clawPurchased":false}}"#;

const NOT_LOGGED_IN: &str =
    r#"{"code":401,"loginUrl":"https://account.xiaomi.com/pass/serviceLogin?sid=api-platform"}"#;

fn main() {
    println!("== 余额（/balance）==");
    let money = parse_balance(BALANCE).expect("应解析成功");
    println!(
        "  可用余额 {:?} {}（现金 {:?} / 赠送 {:?} / 冻结 {:?}）",
        money.balance, money.currency, money.cash, money.gift, money.frozen
    );
    assert_eq!(money.balance, Some(-0.15), "负数（欠费）必须解析出来");
    assert_eq!(money.currency, "CNY");
    println!("  断言通过 ✓");

    println!("== 套餐与本月用量（/tokenPlan/usage）==");
    let quotas = parse_token_plan_usage(USAGE).expect("应解析成功");
    for q in &quotas {
        println!(
            "  {}：已用 {:?} / 上限 {:?}，剩余 {:?}",
            q.label, q.used, q.limit, q.remaining()
        );
    }
    let plan = quotas.iter().find(|q| q.name == "plan_total_token").unwrap();
    assert_eq!(plan.remaining(), Some(3569917184.0), "41亿 − 5.3亿");
    let month = quotas.iter().find(|q| q.name == "month_total_token").unwrap();
    assert_eq!(month.limit, Some(4100000000.0));
    println!("  断言通过 ✓");

    println!("== 套餐详情（/tokenPlan/detail）==");
    let info = parse_plan_detail(PLAN).expect("应解析成功").expect("应有套餐");
    println!("  {}", info.summary());
    assert_eq!(info.plan_name, "Lite");
    assert!(!info.expired && info.enable_auto_renew);
    assert_eq!(info.summary(), "Lite 套餐 · 当前期至 2026-10-23 · 自动续费已开");
    println!("  断言通过 ✓");

    println!("== Cookie 失效 / 未登录 ==");
    let err = parse_token_plan_usage(NOT_LOGGED_IN).unwrap_err();
    assert!(err.contains("Cookie"), "应提示重新复制 Cookie：{err}");
    println!("  {}", err);
    println!("  断言通过 ✓");

    println!("\n全部通过");
}
