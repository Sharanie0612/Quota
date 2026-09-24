//! 验证「跟随系统代理」是否生效：读系统代理，用和主程序一样的方式建 http 客户端，
//! 分别打一个国内站点和一个需要代理才能访问的国外站点。
//! 运行：cargo run --release --example network_check
//!
//! 说明：这台机器直连被墙域名时 DNS 已污染，请求会异常，所以国外站点只测代理路径。

use quota_lib::system_proxy_url;
use std::time::Duration;

fn main() {
    // 1) 国内站点（直连，确认基本请求链路可用）
    let direct = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("http client");
    let rt = tokio::runtime::Runtime::new().expect("tokio");
    let mimo = "https://platform.xiaomimimo.com/api/v1/balance";
    match rt.block_on(async { direct.get(mimo).send().await }) {
        Ok(resp) => println!("mimo console (direct) -> HTTP {} (domestic ok)", resp.status()),
        Err(e) => println!("mimo console (direct) -> err: {e}"),
    }

    // 2) 读系统代理，用它访问国外站点
    let chatgpt = "https://chatgpt.com/backend-api/subscriptions";
    match system_proxy_url() {
        Some(url) => {
            println!("system proxy: {url}");
            let mut b = reqwest::Client::builder().timeout(Duration::from_secs(15));
            match reqwest::Proxy::all(&url) {
                Ok(p) => {
                    b = b.proxy(p);
                }
                Err(e) => {
                    println!("bad proxy url {url}: {e}");
                    std::process::exit(1);
                }
            }
            let proxied = b.build().expect("proxy client");
            match rt.block_on(async { proxied.get(chatgpt).send().await }) {
                Ok(resp) => {
                    let code = resp.status().as_u16();
                    println!("chatgpt.com (via proxy) -> HTTP {code}");
                    // 401 = 路由存在但缺登录凭证，说明代理链路通了
                    if code != 401 && code != 200 {
                        std::process::exit(1);
                    }
                }
                Err(e) => {
                    println!("chatgpt.com (via proxy) -> err: {e}");
                    std::process::exit(1);
                }
            }
        }
        None => {
            println!("system proxy: none (direct only)");
            std::process::exit(1);
        }
    }

    println!("done");
}
