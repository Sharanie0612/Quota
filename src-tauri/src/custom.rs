//! 「其他方式获取余额」的通用实现：自定义余额接口。
//!
//! 平台没有官方余额接口时（智谱、百炼、小米 MiMo、各种中转站），用户可以把任意能
//! 返回余额 JSON 的地址填进来（自己控制台的接口、账单接口、中转站接口都可以），
//! 指定请求方式、请求头与 JSON 路径，软件按同样的节奏查询并参与低余额提醒。
//!
//! 路径没填或填错时，会遍历返回 JSON 里所有数值字段，把「像余额的那些」列出来
//! 让用户一键选用，避免靠猜。

use crate::model::{Account, Balance, DiscoveredPath};
use serde_json::Value;
use std::time::Duration;

/// 形似余额的字段名，用于给自动发现的候选排序
const BALANCE_HINTS: [&str; 18] = [
    "balance",
    "available",
    "avail",
    "remain",
    "remaining",
    "quota",
    "credit",
    "amount",
    "total",
    "money",
    "fund",
    "cash",
    "coin",
    "point",
    "余额",
    "可用",
    "剩余",
    "额度",
];

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let cleaned: String = s
                .trim()
                .trim_start_matches('$')
                .trim_start_matches('¥')
                .chars()
                .filter(|c| !c.is_whitespace() && *c != ',')
                .collect();
            cleaned.parse::<f64>().ok()
        }
        _ => None,
    }
}

/// 按 `a.b[0].c` 形式的路径取 JSON 节点
pub fn json_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = value;
    for part in path.split('.') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        match part.find('[') {
            Some(idx_start) => {
                let name = &part[..idx_start];
                if !name.is_empty() {
                    cur = cur.get(name)?;
                }
                let rest = &part[idx_start..];
                for chunk in rest.split('[').filter(|c| !c.is_empty()) {
                    let index: usize = chunk.trim_end_matches(']').trim().parse().ok()?;
                    cur = cur.get(index)?;
                }
            }
            None => {
                cur = cur.get(part)?;
            }
        }
    }
    Some(cur)
}

/// 递归收集 JSON 里所有「路径 → 数值」，供用户挑选金额字段。
/// 只走到第 4 层，避免在超大返回里迷路。
pub fn discover_numeric_paths(value: &Value) -> Vec<DiscoveredPath> {
    let mut out = Vec::new();
    walk(value, "", 0, &mut out);
    // 形似余额的字段排前面，其余按路径字母序
    out.sort_by(|a, b| {
        let ka = balance_key_rank(&a.path);
        let kb = balance_key_rank(&b.path);
        ka.cmp(&kb).then_with(|| a.path.cmp(&b.path))
    });
    out.truncate(60);
    out
}

fn balance_key_rank(path: &str) -> u8 {
    let lower = path.to_lowercase();
    let hit = BALANCE_HINTS.iter().any(|h| lower.contains(h));
    if hit {
        0
    } else {
        1
    }
}

fn walk(value: &Value, prefix: &str, depth: usize, out: &mut Vec<DiscoveredPath>) {
    if depth > 4 || out.len() > 200 {
        return;
    }
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                let path = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                match v {
                    Value::Object(_) | Value::Array(_) => walk(v, &path, depth + 1, out),
                    _ => {
                        if let Some(n) = num(v) {
                            out.push(DiscoveredPath { path, value: n });
                        }
                    }
                }
            }
        }
        Value::Array(arr) => {
            for (i, v) in arr.iter().enumerate().take(10) {
                let path = format!("{prefix}[{i}]");
                match v {
                    Value::Object(_) | Value::Array(_) => walk(v, &path, depth + 1, out),
                    _ => {
                        if let Some(n) = num(v) {
                            out.push(DiscoveredPath { path, value: n });
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// 从自动发现的候选里挑一个最像余额的（用于用户没填路径时）
fn best_guess(paths: &[DiscoveredPath]) -> Option<DiscoveredPath> {
    paths.first().cloned()
}

/// 解析「Key: Value」多行请求头
pub fn parse_headers(raw: &Option<String>) -> Vec<(String, String)> {
    raw.as_deref()
        .unwrap_or("")
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (k, v) = line.split_once(':')?;
            let (k, v) = (k.trim(), v.trim());
            if k.is_empty() || v.is_empty() {
                None
            } else {
                Some((k.to_string(), v.to_string()))
            }
        })
        .collect()
}

fn is_post(account: &Account) -> bool {
    account
        .custom_method
        .as_deref()
        .map(|m| m.trim().eq_ignore_ascii_case("POST"))
        .unwrap_or(false)
}

/// 找出第一个「没有冒号」的请求头行（用户常把整串 Cookie 值直接粘进去，漏掉 `Cookie:` 前缀）。
/// 返回 0 起的行号；都有冒号或没有非空行时返回 None。
fn first_header_without_colon(raw: &str) -> Option<usize> {
    raw.lines()
        .map(str::trim)
        .enumerate()
        .filter(|(_, l)| !l.is_empty() && !l.starts_with('#'))
        .find(|(_, l)| !l.contains(':'))
        .map(|(i, _)| i + 1)
}

/// 发起自定义余额请求并返回 (响应 JSON, 原始文本)
pub async fn call_custom(
    client: &reqwest::Client,
    account: &Account,
) -> Result<(Value, String), String> {
    let url = account
        .custom_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .ok_or_else(|| "还没有填写自定义余额接口地址（需要以 http/https 开头）".to_string())?;

    // 防呆：只粘了相对路径（如 /backend-api/xxx）会很难排查，直接给完整写法的提示
    if url.starts_with('/') {
        return Err(format!(
            "接口地址要写完整：{url} ← 这是相对路径，请补上域名，例如 https://chatgpt.com{url}"
        ));
    }
    if !url.starts_with("http") {
        return Err("自定义余额接口地址需要以 http/https 开头".into());
    }

    // 防呆：整行粘了 Cookie/令牌值但漏了「Cookie:」前缀，会被静默忽略
    if let Some(line) = account
        .custom_headers
        .as_deref()
        .and_then(first_header_without_colon)
    {
        return Err(format!(
            "请求头第 {line} 行缺少冒号，会被忽略。每行格式是「键: 值」，例如：Cookie: 整行cookie，或 Authorization: Bearer 令牌"
        ));
    }

    let mut req = if is_post(account) {
        let body = account.custom_body.clone().unwrap_or_default();
        let req = client.post(url).timeout(Duration::from_secs(20));
        let has_content_type = parse_headers(&account.custom_headers)
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("content-type"));
        if body.trim().is_empty() {
            req
        } else if has_content_type {
            req.body(body)
        } else {
            req.header("content-type", "application/json").body(body)
        }
    } else {
        client.get(url).timeout(Duration::from_secs(20))
    };

    for (k, v) in parse_headers(&account.custom_headers) {
        req = req.header(k, v);
    }

    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("自定义余额接口超时：{url}")
        } else {
            format!("请求自定义余额接口失败：{e}")
        }
    })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(180).collect();
        return Err(format!(
            "自定义余额接口返回 HTTP {}：{}",
            status.as_u16(),
            snippet.trim()
        ));
    }

    let json: Value = serde_json::from_str(&text)
        .map_err(|e| format!("自定义余额接口返回的不是合法 JSON：{e}"))?;
    Ok((json, text))
}

/// 调用自定义余额接口
pub async fn fetch_custom_balance(
    client: &reqwest::Client,
    account: &Account,
) -> Result<Balance, String> {
    let (json, text) = call_custom(client, account).await?;

    let configured = account
        .custom_json_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string);

    let discovered = discover_numeric_paths(&json);

    // 优先按配置的路径取；没配置就自动挑一个最像余额的
    let (path, value) = match configured {
        Some(p) => match json_path(&json, &p).and_then(num) {
            Some(v) => (p, v),
            None => {
                let hint = if discovered.is_empty() {
                    String::new()
                } else {
                    format!(
                        "；返回内容里可用的金额字段有：{}",
                        discovered
                            .iter()
                            .take(6)
                            .map(|d| format!("{}={}", d.path, d.value))
                            .collect::<Vec<_>>()
                            .join("、")
                    )
                };
                let snippet: String = text.chars().take(160).collect();
                return Err(format!(
                    "返回内容里没有找到路径「{p}」，请检查 JSON 路径设置{hint}（当前返回：{snippet}）"
                ));
            }
        },
        None => match best_guess(&discovered) {
            Some(d) => (d.path, d.value),
            None => {
                let snippet: String = text.chars().take(160).collect();
                return Err(format!(
                    "返回内容里没有任何数值字段，自动识别失败，请手动填写 JSON 路径（当前返回：{snippet}）"
                ));
            }
        },
    };

    let currency = account
        .custom_currency
        .clone()
        .filter(|c| !c.trim().is_empty())
        .unwrap_or_else(|| "CNY".into());

    Ok(Balance {
        currency,
        total: Some(value),
        source: "custom".into(),
        amounts: Vec::new(),
        usable: Some(value > 0.0),
        note: Some(format!("来自自定义余额接口（字段 {path}）")),
        raw: Some(json),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_path_handles_dots_indexes_and_strings() {
        let v = json!({
            "data": { "balance": 12.5, "items": [ { "amount": "3,200.50" } ] },
            "available": "$9.99",
            "list": [10, 20]
        });
        assert_eq!(json_path(&v, "data.balance").and_then(num), Some(12.5));
        assert_eq!(
            json_path(&v, "data.items[0].amount").and_then(num),
            Some(3200.5)
        );
        assert_eq!(json_path(&v, "available").and_then(num), Some(9.99));
        assert_eq!(json_path(&v, "list[1]").and_then(num), Some(20.0));
        assert!(json_path(&v, "data.missing").is_none());
        assert!(json_path(&v, "data.items[5]").is_none());
    }

    #[test]
    fn json_path_supports_deep_path() {
        let v = json!({ "a": { "b": [ { "c": { "d": 7 } } ] } });
        assert_eq!(json_path(&v, "a.b[0].c.d").and_then(num), Some(7.0));
    }

    #[test]
    fn parse_headers_skips_blank_and_comment_lines() {
        let raw = Some(
            "# 注释\nAuthorization: Bearer sk-abc\n\nX-Token:  t  \nbad-line\n".to_string(),
        );
        let headers = parse_headers(&raw);
        assert_eq!(headers.len(), 2);
        assert_eq!(headers[0].0, "Authorization");
        assert_eq!(headers[0].1, "Bearer sk-abc");
        assert_eq!(headers[1].0, "X-Token");
        assert_eq!(headers[1].1, "t");
        assert!(parse_headers(&None).is_empty());
    }

    #[test]
    fn num_accepts_numbers_and_messy_strings() {
        assert_eq!(num(&json!(1.5)), Some(1.5));
        assert_eq!(num(&json!("¥ 88.80")), Some(88.8));
        assert_eq!(num(&json!("not a number")), None);
        assert_eq!(num(&json!(null)), None);
    }

    #[test]
    fn discover_numeric_paths_finds_nested_amounts_and_ranks_balance_like_keys() {
        let v = json!({
            "code": 200,
            "data": {
                "user": { "name": "团队号", "id": "u-1" },
                "available_balance": 88.5,
                "items": [ { "amount": 3, "label": "x" } ]
            }
        });
        let found = discover_numeric_paths(&v);
        let paths: Vec<&str> = found.iter().map(|d| d.path.as_str()).collect();
        assert!(paths.contains(&"data.available_balance"));
        assert!(paths.contains(&"data.items[0].amount"));
        assert!(paths.contains(&"code"));
        // 形似余额的字段排在前面
        assert_eq!(paths[0], "data.available_balance");
        let bal = found.iter().find(|d| d.path == "data.available_balance").unwrap();
        assert_eq!(bal.value, 88.5);
    }

    #[test]
    fn best_guess_picks_the_highest_ranked_candidate() {
        let v = json!({ "data": { "name": "x", "balance": 12.0 } });
        let found = discover_numeric_paths(&v);
        assert_eq!(best_guess(&found).map(|d| d.path), Some("data.balance".into()));
        assert!(best_guess(&[]).is_none());
    }

    #[test]
    fn detects_header_line_without_colon() {
        // 用户常把整串 cookie 值直接粘进请求头，漏掉「Cookie:」前缀
        assert_eq!(first_header_without_colon("ois1.eyJ2IjoxLCJhbGc"), Some(1));
        assert_eq!(first_header_without_colon("Cookie: a=1\nbad-line"), Some(2));
        assert_eq!(first_header_without_colon("Cookie: a=1\nX-T: y"), None);
        // 空行和注释不算
        assert_eq!(first_header_without_colon("\n# c\nCookie: a=1"), None);
        assert_eq!(first_header_without_colon(""), None);
    }
}
