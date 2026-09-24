//! 智谱余额查询的端到端诊断：走与主程序完全相同的代码路径
//! （读凭据管理器 → 调账户报表接口 → 解析），只打印余额、不打印密钥。
//!
//! 用法：cargo run --release --example zhipu_live -- <账户id>
//! 账户 id 看 %APPDATA%\Quota\config.json。

use quota_lib::{fetch_balance, find, get_secrets};

fn main() {
    let account_id = match std::env::args().nth(1) {
        Some(id) => id,
        None => {
            eprintln!("用法：zhipu_live <账户id>（账户 id 见 %APPDATA%\\Quota\\config.json）");
            std::process::exit(2);
        }
    };

    let blob = match get_secrets(&account_id) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("读凭据失败：{e}");
            std::process::exit(1);
        }
    };
    let key = match blob.api_key.filter(|k| !k.trim().is_empty()) {
        Some(k) => k,
        None => {
            eprintln!("该账户没有保存 API Key");
            std::process::exit(1);
        }
    };

    let def = match find("zhipu") {
        Some(d) => d,
        None => {
            eprintln!("providers 里没有 zhipu 定义");
            std::process::exit(1);
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .expect("构建 http 客户端");
    let rt = tokio::runtime::Runtime::new().expect("构建 tokio runtime");
    let base = def.default_base_url.to_string();

    match rt.block_on(fetch_balance(&client, def, &base, key.trim())) {
        Ok(b) => {
            println!("查询成功：");
            println!("  可用余额：{:?} {}", b.total, b.currency);
            for a in &b.amounts {
                println!("  - {}：{}", a.label, a.value);
            }
            println!("  说明：{}", b.note.unwrap_or_default());
        }
        Err(e) => {
            println!("查询失败：{e}");
            std::process::exit(1);
        }
    }
}
