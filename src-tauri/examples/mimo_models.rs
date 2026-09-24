//! 诊断工具：用本机凭据真实调用小米 MiMo 两个端点的 GET /v1/models，
//! 打印返回的模型 id（不打印任何密钥），核对模型列表的实际内容与资料库的差异。
//! 运行：cargo run --release --example mimo_models（账户 id 见下方 ACCOUNTS）

use quota_lib::get_secrets;
use std::time::Duration;

const ACCOUNTS: [(&str, &str, &str); 2] = [
    (
        "c77675f9-cfa9-418c-a844-73de3307d099",
        "mimo（按量付费）",
        "https://api.xiaomimimo.com/v1/models",
    ),
    (
        "1144d01c-21b2-4082-9726-1ac4ec8ef575",
        "mimo-plan（Token Plan 订阅）",
        "https://token-plan-cn.xiaomimimo.com/v1/models",
    ),
];

fn main() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("http client");
    let rt = tokio::runtime::Runtime::new().expect("tokio");

    for (account_id, title, url) in ACCOUNTS {
        println!("== {title} ==");
        let key = match get_secrets(account_id) {
            Ok(b) => match b.api_key {
                Some(k) if !k.trim().is_empty() => k,
                _ => {
                    println!("  （未保存 API Key，跳过）");
                    continue;
                }
            },
            Err(e) => {
                println!("  读凭据失败：{e}");
                continue;
            }
        };
        let resp = rt.block_on(async { client.get(url).bearer_auth(key).send().await });
        match resp {
            Ok(r) => {
                let status = r.status();
                let text = rt.block_on(async { r.text().await.unwrap_or_default() });
                if !status.is_success() {
                    println!("  HTTP {status}: {}", &text.chars().take(300).collect::<String>());
                    continue;
                }
                let v: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(e) => {
                        println!("  解析失败：{e}");
                        continue;
                    }
                };
                let arr = v.get("data").and_then(|a| a.as_array()).cloned().unwrap_or_default();
                println!("  共 {} 个模型：", arr.len());
                for (i, item) in arr.iter().enumerate() {
                    let id = item.get("id").and_then(|x| x.as_str()).unwrap_or("?");
                    let owned = item.get("owned_by").and_then(|x| x.as_str()).unwrap_or("");
                    let desc = item
                        .get("description")
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    // 除 id/owned_by 外还有别的字段也一并露出来，方便看清单结构
                    let extra: Vec<&str> = item
                        .as_object()
                        .map(|o| {
                            o.keys()
                                .filter(|k| !matches!(k.as_str(), "id" | "owned_by" | "created"))
                                .map(|k| k.as_str())
                                .collect()
                        })
                        .unwrap_or_default();
                    println!(
                        "  [{i:2}] {id}  (owned_by={owned}){}{}",
                        if desc.is_empty() { String::new() } else { format!("  desc={desc:?}") },
                        if extra.is_empty() { String::new() } else { format!("  extra={extra:?}") },
                    );
                }
            }
            Err(e) => println!("  请求失败：{e}"),
        }
    }
}
