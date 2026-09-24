//! 「其他方式获取余额」之一：阿里云账户余额。
//!
//! 百炼（通义千问）本身没有用 API Key 查余额的接口，但它的费用出自阿里云账户，
//! 而阿里云在 BSS OpenAPI 里提供了 `QueryAccountBalance`。用户填一对 AccessKey
//! 后，就能读到该账户的可用额度，让百炼账户也参与低余额提醒。
//!
//! 该接口是 RPC 风格，需要 HMAC-SHA1 签名（阿里云通用签名机制）：
//!   StringToSign = "GET&%2F&" + percentEncode(规范化查询串)
//!   Signature    = Base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign))
//! 文档：https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance

use crate::model::{Balance, BalanceAmount};
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha1::Sha1;

const ENDPOINT: &str = "https://business.aliyuncs.com/";
const API_VERSION: &str = "2017-12-14";

/// 阿里云通用签名的百分号编码：保留 A-Z a-z 0-9 - _ . ~，其余按字节编码。
/// 注意空格编码为 %20（不是 +），且 ~ 不编码。
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 按阿里云签名要求把参数排序并拼成规范化查询串
fn canonical_query(params: &[(String, String)]) -> String {
    let mut sorted: Vec<(String, String)> = params.to_vec();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    sorted
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// 计算签名（对 AccessKeySecret 做 HMAC-SHA1 后 Base64）
pub fn sign(canonical: &str, access_key_secret: &str) -> String {
    let string_to_sign = format!("GET&{}&{}", percent_encode("/"), percent_encode(canonical));
    let mut mac = Hmac::<Sha1>::new_from_slice(format!("{access_key_secret}&").as_bytes())
        .expect("HMAC 接受任意长度密钥");
    mac.update(string_to_sign.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

/// 调用 QueryAccountBalance，读取阿里云账户可用额度
pub async fn fetch_account_balance(
    client: &reqwest::Client,
    access_key_id: &str,
    access_key_secret: &str,
) -> Result<Balance, String> {
    let params: Vec<(String, String)> = vec![
        ("AccessKeyId".into(), access_key_id.trim().to_string()),
        ("Action".into(), "QueryAccountBalance".into()),
        ("Format".into(), "JSON".into()),
        ("SignatureMethod".into(), "HMAC-SHA1".into()),
        ("SignatureVersion".into(), "1.0".into()),
        ("SignatureNonce".into(), uuid::Uuid::new_v4().to_string()),
        ("Timestamp".into(), Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        ("Version".into(), API_VERSION.into()),
    ];

    let canonical = canonical_query(&params);
    let signature = sign(&canonical, access_key_secret);
    let url = format!("{ENDPOINT}?{canonical}&Signature={}", percent_encode(&signature));

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "连接阿里云账单接口超时。".to_string()
            } else {
                format!("请求阿里云账单接口失败：{e}")
            }
        })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(220).collect();
        return Err(format!(
            "阿里云账单接口返回 HTTP {}：{}",
            status.as_u16(),
            snippet.trim()
        ));
    }

    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析阿里云账单接口返回失败：{e}"))?;

    // 阿里云错误也会返回 HTTP 200，需要看 Success / Code
    let success = v.get("Success").and_then(|s| s.as_bool()).unwrap_or(false);
    if !success {
        let code = v.get("Code").and_then(|c| c.as_str()).unwrap_or("Unknown");
        let message = v.get("Message").and_then(|m| m.as_str()).unwrap_or("");
        return Err(explain_aliyun_error(code, message));
    }

    let data = v
        .get("Data")
        .ok_or_else(|| "阿里云账单接口没有返回 Data 字段".to_string())?;

    let num = |key: &str| -> Option<f64> {
        data.get(key).and_then(|x| match x {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.trim().parse::<f64>().ok(),
            _ => None,
        })
    };

    let currency = data
        .get("Currency")
        .and_then(|c| c.as_str())
        .unwrap_or("CNY")
        .to_string();
    let available = num("AvailableAmount");
    if available.is_none() {
        return Err("阿里云账单接口返回里没有 AvailableAmount 字段".into());
    }

    let mut amounts = Vec::new();
    if let Some(v) = num("AvailableCashAmount") {
        amounts.push(BalanceAmount {
            label: "现金余额".into(),
            value: v,
            kind: "cash".into(),
        });
    }
    if let Some(v) = num("CreditAmount") {
        amounts.push(BalanceAmount {
            label: "信控额度".into(),
            value: v,
            kind: "credit".into(),
        });
    }
    if let Some(v) = num("QuotaLimit") {
        amounts.push(BalanceAmount {
            label: "配额上限".into(),
            value: v,
            kind: "quota".into(),
        });
    }

    Ok(Balance {
        currency,
        total: available,
        source: "aliyun".into(),
        amounts,
        usable: available.map(|a| a > 0.0),
        note: Some("来自阿里云 BSS 账单接口（QueryAccountBalance），是阿里云账户的可用额度".into()),
        raw: Some(v),
    })
}

fn explain_aliyun_error(code: &str, message: &str) -> String {
    let tail = if message.trim().is_empty() {
        String::new()
    } else {
        format!("（{message}）")
    };
    match code {
        "InvalidAccessKeyId.NotFound" | "InvalidAccessKeyId.Inactive" => format!(
            "阿里云返回 {code}：AccessKey ID 不存在或已禁用，请检查是否填写正确、是否已启用。{tail}"
        ),
        "SignatureDoesNotMatch" => format!(
            "阿里云返回 {code}：签名校验失败，通常是 AccessKey Secret 填错。{tail}"
        ),
        "Forbidden.RAM" | "NoPermission" | "Forbidden" => format!(
            "阿里云返回 {code}：该 AccessKey 没有读取账户余额的权限。请给它授予 bss:DescribeAcccount（只读）权限。{tail}"
        ),
        _ => format!("阿里云返回 {code}{tail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encode_follows_aliyun_rules() {
        assert_eq!(percent_encode("a b"), "a%20b");
        assert_eq!(percent_encode("a*b"), "a%2Ab");
        assert_eq!(percent_encode("a~b"), "a~b");
        assert_eq!(percent_encode("/"), "%2F");
        assert_eq!(percent_encode("a=b&c"), "a%3Db%26c");
        assert_eq!(percent_encode("sk-abc_1.2"), "sk-abc_1.2");
    }

    #[test]
    fn canonical_query_sorts_by_key_and_encodes() {
        let params = vec![
            ("Version".to_string(), "2017-12-14".to_string()),
            ("Action".to_string(), "QueryAccountBalance".to_string()),
        ];
        assert_eq!(
            canonical_query(&params),
            "Action=QueryAccountBalance&Version=2017-12-14"
        );
    }

    /// 固定一组参数，核对规范化查询串的排序/编码，以及签名输出的稳定性与长度。
    #[test]
    fn signature_is_stable_and_well_formed() {
        let params = vec![
            ("AccessKeyId".to_string(), "testid".to_string()),
            ("Action".to_string(), "QueryAccountBalance".to_string()),
            (
                "Format".to_string(),
                "JSON".to_string(),
            ),
            ("SignatureMethod".to_string(), "HMAC-SHA1".to_string()),
            ("SignatureNonce".to_string(), "abc123".to_string()),
            ("SignatureVersion".to_string(), "1.0".to_string()),
            (
                "Timestamp".to_string(),
                "2026-09-23T00:00:00Z".to_string(),
            ),
            ("Version".to_string(), API_VERSION.to_string()),
        ];
        let canonical = canonical_query(&params);
        assert_eq!(
            canonical,
            "AccessKeyId=testid&Action=QueryAccountBalance&Format=JSON&SignatureMethod=HMAC-SHA1&SignatureNonce=abc123&SignatureVersion=1.0&Timestamp=2026-09-23T00%3A00%3A00Z&Version=2017-12-14"
        );
        // 签名是稳定的：同样的输入必须得到同样的 Base64 串
        let sig = sign(&canonical, "testsecret");
        assert_eq!(sig, sign(&canonical, "testsecret"));
        assert_eq!(sig.len(), 28, "SHA1 的 Base64 结果固定为 28 个字符");
    }
}
