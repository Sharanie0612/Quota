//! 读取 Windows 系统代理，让应用跟随系统代理（Clash / Clash Verge 开的代理）。
//!
//! reqwest 默认只认环境变量代理（HTTP_PROXY 等），不认 Windows 的系统代理设置，
//! 所以用户开了系统代理、应用仍然直连——对 chatgpt.com 这类直连不通的站点就全挂。
//! 这里从注册表读 `HKCU\...\Internet Settings` 的 `ProxyEnable` / `ProxyServer`。
//!
//! 注意：代理设置改了要**重启应用**才会重新读取（只在启动时读一次）。

use std::process::Command;

const REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

/// 读一个注册表值；拿不到（非 Windows、值不存在、reg 命令失败）返回 None
fn query_reg_value(name: &str) -> Option<String> {
    let out = Command::new("reg")
        .args(["query", REG_KEY, "/v", name])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // 输出形如：`    ProxyServer    REG_SZ    127.0.0.1:7897`
    // 取 REG_* 类型字段之后的整段值（值名是 ASCII，不随系统语言变）
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && parts[1].starts_with("REG_") {
            return Some(parts[2..].join(" "));
        }
    }
    None
}

/// `ProxyServer` 有两种格式：全局 `host:port` 或分协议 `http=h:80;https=h:443;socks=...`
fn parse_proxy_server(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if !raw.contains('=') {
        return Some(with_scheme(raw));
    }
    let mut chosen: Option<&str> = None;
    for part in raw.split(';') {
        let Some((k, v)) = part.split_once('=') else {
            continue;
        };
        match k.trim().to_ascii_lowercase().as_str() {
            "http" => chosen = Some(v.trim()),
            "https" if chosen.is_none() => chosen = Some(v.trim()),
            _ => {}
        }
    }
    chosen.filter(|v| !v.is_empty()).map(with_scheme)
}

fn with_scheme(v: &str) -> String {
    if v.contains("://") {
        v.to_string()
    } else {
        format!("http://{v}")
    }
}

/// 系统代理地址（形如 `http://127.0.0.1:7897`）；未启用返回 None
pub fn system_proxy_url() -> Option<String> {
    let enable = query_reg_value("ProxyEnable")?;
    // ProxyEnable 是 REG_DWORD，`reg query` 输出成 `0x1` / `1`
    let on = matches!(enable.trim(), "1" | "0x1" | "0x00000001");
    if !on {
        return None;
    }
    parse_proxy_server(&query_reg_value("ProxyServer")?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_global_proxy() {
        assert_eq!(
            parse_proxy_server("127.0.0.1:7897").as_deref(),
            Some("http://127.0.0.1:7897")
        );
    }

    #[test]
    fn parses_per_protocol_proxy_preferring_http() {
        let raw = "socks5=127.0.0.1:1080;http=127.0.0.1:7897;https=127.0.0.1:7898";
        assert_eq!(parse_proxy_server(raw).as_deref(), Some("http://127.0.0.1:7897"));
    }

    #[test]
    fn keeps_existing_scheme_and_skips_malformed() {
        assert_eq!(parse_proxy_server("http://1.2.3.4:8080").as_deref(), Some("http://1.2.3.4:8080"));
        assert_eq!(parse_proxy_server(";;broken;http=1.2.3.4:9090").as_deref(), Some("http://1.2.3.4:9090"));
        assert!(parse_proxy_server("").is_none());
    }

    #[test]
    fn disabled_or_missing_returns_none() {
        // 本机注册表状态不固定，只保证函数不会 panic
        let _ = system_proxy_url();
    }
}
