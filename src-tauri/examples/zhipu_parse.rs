//! 本机跑不了 `cargo test`（测试 harness 缺 DLL 入口），这个 example 用与主程序相同的
//! 链接方式真正执行智谱返回解析，作为可运行的验证。运行：cargo run --example zhipu_parse
//!
//! 样例 JSON 的字段名与真实接口一致，数字为合成值（真实返回已在接入时人工核对过）。

use agentprice_lib::parse_zhipu_report;

const REPORT_OK: &str = r#"{"code":200,"msg":"操作成功","data":{"balance":11.596398650,
    "rechargeAmount":40.000000,"giveAmount":3.500000,"totalSpendAmount":28.403601350,
    "todaySpendAmount":null,"availableBalance":11.596398650,"frozenBalance":0E-9,
    "creditBalance":null,"availableCreditBalance":null,"creditStatus":"NOT_OPEN",
    "modelSpendAmountList":null,"isKA":false},"success":true}"#;

const REPORT_AUTH_FAIL: &str =
    r#"{"code":1001,"msg":"Header中未收到Authorization参数，无法进行身份验证。","success":false}"#;

fn main() {
    println!("== 正常返回 ==");
    match parse_zhipu_report(REPORT_OK, "智谱 AI（BigModel）") {
        Ok(b) => {
            println!("  currency={} total={:?} usable={:?}", b.currency, b.total, b.usable);
            for a in &b.amounts {
                println!("  - {} = {}", a.label, a.value);
            }
            // 断言：余额、可用性、明细项
            assert_eq!(b.total, Some(11.596398650));
            assert_eq!(b.usable, Some(true));
            let labels: Vec<&str> = b.amounts.iter().map(|a| a.label.as_str()).collect();
            assert!(labels.contains(&"累计充值"));
            assert!(labels.contains(&"累计消费"));
            assert!(labels.contains(&"赠送余额"), "赠送 > 0 时应显示");
            assert!(!labels.contains(&"冻结"), "冻结为 0 时不应显示");
            println!("  断言通过 ✓");
        }
        Err(e) => panic!("正常返回不应报错：{e}"),
    }

    println!("== 鉴权失败（HTTP 200 但 success=false） ==");
    match parse_zhipu_report(REPORT_AUTH_FAIL, "智谱 AI（BigModel）") {
        Ok(_) => panic!("鉴权失败不应解析成功"),
        Err(e) => {
            println!("  错误信息：{e}");
            assert!(e.contains("1001") && e.contains("API Key 无效"));
            println!("  断言通过 ✓");
        }
    }

    println!("== 异常返回 ==");
    assert!(parse_zhipu_report("<html>登录页</html>", "智谱").is_err(), "HTML 应报错");
    assert!(
        parse_zhipu_report(r#"{"code":200,"data":{"foo":1},"success":true}"#, "智谱").is_err(),
        "缺 availableBalance 应报错"
    );
    println!("  断言通过 ✓");

    println!("\n全部通过");
}
