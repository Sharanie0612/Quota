//! 小米 MiMo 控制台数据查询（余额 / 当月用量 / 套餐余量）。
//!
//! 官方文档没有任何余额或用量查询 API（见 mimo.mi.com/llms.txt 的接口索引），
//! 但控制台 platform.xiaomimimo.com 的前端调的是 `https://platform.xiaomimimo.com/api/v1/...`
//! 这批接口，可以用浏览器里的小米账号 SSO Cookie 直接调（社区已有同样做法：
//! github.com/w101723/xiaomimimo_token_usage_detection）。
//!
//! 鉴权三件套：`Cookie`（小米 SSO 会话）+ `referer` + `x-timezone`。
//! 成功返回 `{"code":0,...}`，未登录返回 `{"code":401,"loginUrl":...}`。

use crate::model::{Balance, BalanceAmount};
use serde_json::Value;

const CONSOLE_BASE: &str = "https://platform.xiaomimimo.com/api/v1";
const CONSOLE_REFERER: &str = "https://platform.xiaomimimo.com/";

/// 一项额度用量（套餐余量 / 本月用量 / 补偿额度等），单位是 Credits
#[derive(Clone, Debug)]
pub struct QuotaItem {
    /// 接口里的原始名，如 plan_total_token / month_total_token
    pub name: String,
    pub label: String,
    pub used: Option<f64>,
    pub limit: Option<f64>,
}

impl QuotaItem {
    /// 剩余额度
    pub fn remaining(&self) -> Option<f64> {
        Some(self.limit? - self.used.unwrap_or(0.0))
    }
}

fn label_for(name: &str) -> String {
    match name {
        "plan_total_token" => "套餐余量".into(),
        "month_total_token" => "本月用量".into(),
        "compensation_total_token" => "补偿额度".into(),
        other => other.to_string(),
    }
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().trim_start_matches('¥').parse::<f64>().ok(),
        _ => None,
    }
}

/// 解析 `GET /api/v1/tokenPlan/usage` 的返回。
/// 结构（社区实测）：`data.usage.items[]` 与 `data.monthUsage.items[]`，
/// 每项是 `{name, used, limit, percent}`。
pub fn parse_token_plan_usage(text: &str) -> Result<Vec<QuotaItem>, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("解析 MiMo 用量接口返回失败：{e}"))?;
    check_envelope(&v, "用量")?;

    let mut out = Vec::new();
    for group in ["usage", "monthUsage"] {
        if let Some(items) = v
            .get("data")
            .and_then(|d| d.get(group))
            .and_then(|g| g.get("items"))
            .and_then(|i| i.as_array())
        {
            for item in items {
                let name = item
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                out.push(QuotaItem {
                    label: label_for(&name),
                    name,
                    used: item.get("used").and_then(num),
                    limit: item.get("limit").and_then(num),
                });
            }
        }
    }
    Ok(out)
}

/// 余额接口 `/api/v1/balance` 的返回（实测字段是字符串，如 "-0.15"）
#[derive(Clone, Debug, Default)]
pub struct MimoMoney {
    /// 透支后的可用余额（含透支，负数表示欠费）
    pub balance: Option<f64>,
    pub cash: Option<f64>,
    pub gift: Option<f64>,
    pub frozen: Option<f64>,
    pub overdraft: Option<f64>,
    pub currency: String,
    /// 结构变动时发现的其他数值字段，方便排查
    pub discovered: Vec<(String, f64)>,
}

/// 解析 `GET /api/v1/balance`。字段取自实测返回，不猜别的路径。
pub fn parse_balance(text: &str) -> Result<MimoMoney, String> {
    let v: Value =
        serde_json::from_str(text).map_err(|e| format!("解析 MiMo 余额接口返回失败：{e}"))?;
    check_envelope(&v, "余额")?;

    let data = v
        .get("data")
        .ok_or_else(|| "MiMo 余额接口返回缺少 data 字段".to_string())?;
    let get = |k: &str| data.get(k).and_then(num);

    let mut money = MimoMoney {
        balance: get("balance"),
        cash: get("cashBalance"),
        gift: get("giftBalance"),
        frozen: get("frozenBalance"),
        overdraft: get("overdraftLimit"),
        currency: data
            .get("currency")
            .and_then(|c| c.as_str())
            .unwrap_or("CNY")
            .to_string(),
        ..Default::default()
    };
    // 兜底：把 data 下的数值字段列出来（结构改动时能从这里看出问题）
    let mut found = Vec::new();
    walk_numbers(data, "data", 0, &mut found);
    let known = |p: &str| {
        let l = p.to_lowercase();
        ["balance", "cashbalance", "giftbalance", "frozenbalance", "overdraftlimit"]
            .iter()
            .any(|k| l.ends_with(k))
    };
    money.discovered = found.into_iter().filter(|(p, _)| !known(p)).collect();

    if money.balance.is_none() && money.cash.is_none() {
        return Err("MiMo 余额接口返回里没有 balance/cashBalance 字段，接口可能已改版".into());
    }
    Ok(money)
}

/// 套餐详情 `/api/v1/tokenPlan/detail`（实测字段）
#[derive(Clone, Debug, Default)]
pub struct PlanInfo {
    pub plan_name: String,
    pub plan_code: String,
    /// 当前期结束时间，如 "2026-10-23 23:59:59"
    pub current_period_end: String,
    pub expired: bool,
    pub enable_auto_renew: bool,
}

impl PlanInfo {
    /// 形如「Lite 套餐 · 当前期至 2026-10-23 · 自动续费已开」
    pub fn summary(&self) -> String {
        let mut parts = vec![format!("{} 套餐", self.plan_name)];
        if !self.current_period_end.is_empty() {
            let day = &self.current_period_end[..10.min(self.current_period_end.len())];
            parts.push(format!("当前期至 {day}"));
        }
        if self.expired {
            parts.push("已过期".into());
        } else {
            parts.push(if self.enable_auto_renew { "自动续费已开".into() } else { "自动续费未开".into() });
        }
        parts.join(" · ")
    }
}

/// 解析 `GET /api/v1/tokenPlan/detail`；data 为空说明该账号没有套餐
pub fn parse_plan_detail(text: &str) -> Result<Option<PlanInfo>, String> {
    let v: Value =
        serde_json::from_str(text).map_err(|e| format!("解析 MiMo 套餐接口返回失败：{e}"))?;
    check_envelope(&v, "套餐")?;
    let data = match v.get("data") {
        Some(Value::Object(_)) => v.get("data"),
        _ => None,
    };
    let Some(data) = data else { return Ok(None) };
    let name = data.get("planName").and_then(|n| n.as_str()).unwrap_or("");
    if name.is_empty() {
        return Ok(None);
    }
    Ok(Some(PlanInfo {
        plan_name: name.to_string(),
        plan_code: data.get("planCode").and_then(|c| c.as_str()).unwrap_or("").to_string(),
        current_period_end: data
            .get("currentPeriodEnd")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
        expired: data.get("expired").and_then(|b| b.as_bool()).unwrap_or(false),
        enable_auto_renew: data.get("enableAutoRenew").and_then(|b| b.as_bool()).unwrap_or(false),
    }))
}

/// 统一处理控制台接口的错误包络：未登录是 `{"code":401,"loginUrl":...}`
fn check_envelope(v: &Value, what: &str) -> Result<(), String> {
    let code = match v.get("code") {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(-1),
        _ => 0,
    };
    if code == 0 {
        return Ok(());
    }
    let msg = v.get("message").or_else(|| v.get("msg")).and_then(|m| m.as_str()).unwrap_or("");
    if code == 401 {
        return Err(
            "MiMo 控制台 Cookie 已失效或未登录，请到浏览器重新复制 Cookie（打开 platform.xiaomimimo.com 后 F12 → Network → 任意请求 → 复制 Cookie 请求头）"
                .into(),
        );
    }
    Err(format!("MiMo {what}接口返回 code {code}：{msg}"))
}

/// 递归收集数值字段（解析兜底用），最多 4 层
fn walk_numbers(v: &Value, prefix: &str, depth: usize, out: &mut Vec<(String, f64)>) {
    if depth > 4 || out.len() > 60 {
        return;
    }
    match v {
        Value::Object(map) => {
            for (k, val) in map {
                let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
                match val {
                    Value::Object(_) | Value::Array(_) => walk_numbers(val, &path, depth + 1, out),
                    _ => {
                        if let Some(n) = num(val) {
                            out.push((path, n));
                        }
                    }
                }
            }
        }
        Value::Array(arr) => {
            for (i, val) in arr.iter().enumerate().take(10) {
                walk_numbers(val, &format!("{prefix}[{i}]"), depth + 1, out);
            }
        }
        _ => {}
    }
}

fn get_json(client: &reqwest::Client, url: &str, cookie: &str) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header("Cookie", cookie.trim())
        .header("referer", CONSOLE_REFERER)
        .header("x-timezone", "Asia/Shanghai")
}

/// 把 Credits 格式化成人能一眼看懂的量级（41 亿 > 4100000000）
fn fmt_quota(v: f64) -> String {
    if v.abs() >= 1.0e8 {
        format!("{:.2} 亿", v / 1.0e8)
    } else if v.abs() >= 1.0e4 {
        format!("{:.2} 万", v / 1.0e4)
    } else {
        format!("{:.0}", v)
    }
}

/// 查 MiMo 控制台：余额（/balance）、套餐与本月用量（/tokenPlan/usage）、套餐详情（/tokenPlan/detail）。
///
/// 两个接口用的都是同一个小米账号的 Cookie，所以同账号下两个账户读到的是同一份数据；
/// `provider_id` 决定卡片上「大数字」放什么：按量付费看现金余额（元），订阅读套餐剩余额度（Credits）。
pub async fn fetch_console(
    client: &reqwest::Client,
    cookie: &str,
    provider_id: &str,
) -> Result<Balance, String> {
    // 1) 余额（balance / cashBalance / giftBalance / frozenBalance）
    let mut money: Option<MimoMoney> = None;
    let mut money_err: Option<String> = None;
    match get_json(client, &format!("{CONSOLE_BASE}/balance"), cookie)
        .send()
        .await
    {
        Ok(resp) => match parse_balance(&resp.text().await.unwrap_or_default()) {
            Ok(m) => money = Some(m),
            Err(e) => money_err = Some(e),
        },
        Err(e) => money_err = Some(format!("请求 MiMo 余额接口失败：{e}")),
    }

    // 2) 套餐额度 + 本月用量
    let usage_url = format!("{CONSOLE_BASE}/tokenPlan/usage");
    let usage_text = get_json(client, &usage_url, cookie)
        .send()
        .await
        .map_err(|e| format!("请求 MiMo 用量接口失败：{e}"))?
        .text()
        .await
        .unwrap_or_default();
    let quotas = parse_token_plan_usage(&usage_text)?;

    // 3) 套餐详情（套餐名 / 到期时间 / 自动续费），没有套餐就跳过
    let plan_info = match get_json(client, &format!("{CONSOLE_BASE}/tokenPlan/detail"), cookie)
        .send()
        .await
    {
        Ok(resp) => parse_plan_detail(&resp.text().await.unwrap_or_default()).ok().flatten(),
        Err(_) => None,
    };

    if money.is_none() && quotas.is_empty() {
        return Err(money_err.unwrap_or_else(|| {
            "MiMo 控制台没有返回余额或额度数据（Cookie 可能已失效，请重新复制）。".into()
        }));
    }

    let plan = quotas.iter().find(|q| q.name == "plan_total_token");
    let month = quotas.iter().find(|q| q.name == "month_total_token");
    let mut amounts = Vec::new();
    let mut total: Option<f64> = None;
    let mut currency = "CNY".to_string();
    let mut note; // 两个分支各自赋值；按量付费没有套餐时余额接口也没读到会提前 return

    let month_text = month
        .and_then(|m| match (m.used, m.limit) {
            (Some(u), Some(l)) if l > 0.0 => Some(format!(
                "本月已用 {} / {} Credits（{:.1}%）",
                fmt_quota(u),
                fmt_quota(l),
                u / l * 100.0
            )),
            _ => None,
        })
        .unwrap_or_default();
    let plan_text = plan_info.as_ref().map(|p| p.summary()).unwrap_or_default();

    if provider_id == "mimo-plan" && plan.and_then(|q| q.remaining()).is_some() {
        // 订阅账户：大数字 = 套餐剩余额度
        let p = plan.unwrap();
        currency = "CREDITS".into();
        total = p.remaining();
        if let (Some(u), Some(l)) = (p.used, p.limit) {
            amounts.push(BalanceAmount { label: "套餐已用".into(), value: u, kind: "used".into() });
            amounts.push(BalanceAmount { label: "套餐总额度".into(), value: l, kind: "total".into() });
        }
        if let Some((u, l)) = month.and_then(|m| Some((m.used?, m.limit?))) {
            amounts.push(BalanceAmount { label: "本月已用".into(), value: u, kind: "month_used".into() });
            amounts.push(BalanceAmount { label: "本月额度".into(), value: l, kind: "month_limit".into() });
        }
        for q in quotas.iter().filter(|q| q.name == "compensation_total_token") {
            if let Some(r) = q.remaining().filter(|r| *r > 0.0) {
                amounts.push(BalanceAmount { label: "补偿额度".into(), value: r, kind: "compensation".into() });
            }
        }
        note = plan_text;
        if let Some(m) = &money {
            let cash_total = m.balance.or(m.cash);
            if cash_total.map(|v| v != 0.0).unwrap_or(false) {
                note.push_str(&format!(
                    " · 余额 {}{}",
                    m.currency,
                    fmt_quota(cash_total.unwrap_or(0.0))
                ));
            }
        }
    } else {
        // 按量付费（或没有套餐）：大数字 = 可用余额（元，含透支）
        if let Some(m) = &money {
            currency = m.currency.clone();
            total = Some(m.balance.or(m.cash).unwrap_or(0.0));
            if let Some(v) = m.cash {
                amounts.push(BalanceAmount { label: "现金余额".into(), value: v, kind: "cash".into() });
            }
            if let Some(v) = m.gift.filter(|v| *v > 0.0) {
                amounts.push(BalanceAmount { label: "赠送余额".into(), value: v, kind: "granted".into() });
            }
            if let Some(v) = m.frozen.filter(|v| *v > 0.0) {
                amounts.push(BalanceAmount { label: "冻结".into(), value: v, kind: "frozen".into() });
            }
            if let Some(v) = m.overdraft.filter(|v| *v > 0.0) {
                amounts.push(BalanceAmount { label: "透支额度".into(), value: v, kind: "overdraft".into() });
            }
        } else if let Some(r) = plan.and_then(|q| q.remaining()) {
            // 余额接口没读到、但有套餐额度：退化成显示额度
            currency = "CREDITS".into();
            total = Some(r);
            note = format!("未读到现金余额，先显示套餐剩余额度。{plan_text}");
            return Ok(Balance {
                currency,
                total,
                source: "console".into(),
                amounts,
                usable: total.map(|t| t > 0.0),
                note: Some(note),
                raw: Some(serde_json::json!({ "usage": serde_json::from_str::<Value>(&usage_text).unwrap_or(Value::Null) })),
            });
        }
        let mut parts: Vec<String> = Vec::new();
        if !month_text.is_empty() {
            parts.push(month_text);
        }
        if !plan_text.is_empty() {
            parts.push(plan_text);
        }
        note = parts.join(" · ");
    }

    if note.is_empty() {
        note = "来自 MiMo 控制台接口（platform.xiaomimimo.com，需浏览器 Cookie）".into();
    } else {
        note.push_str(" ·来自 MiMo 控制台接口");
    }

    Ok(Balance {
        currency,
        total,
        source: "console".into(),
        amounts,
        usable: total.map(|t| t > 0.0),
        note: Some(note),
        raw: Some(serde_json::json!({
            "usage": serde_json::from_str::<Value>(&usage_text).unwrap_or(Value::Null),
        })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 按社区实测结构构造的样例（数字为合成值）
    const USAGE: &str = r#"{"code":0,"data":{
        "usage":{"items":[
            {"name":"plan_total_token","used":320.5,"limit":1100,"percent":29.1},
            {"name":"compensation_total_token","used":0,"limit":50,"percent":0}]},
        "monthUsage":{"items":[
            {"name":"month_total_token","used":320.5,"limit":1100,"percent":29.1}]}
    }}"#;

    #[test]
    fn parses_plan_and_month_quota() {
        let q = parse_token_plan_usage(USAGE).expect("应解析成功");
        assert_eq!(q.len(), 3);
        let plan = q.iter().find(|x| x.name == "plan_total_token").unwrap();
        assert_eq!(plan.remaining(), Some(779.5));
        let month = q.iter().find(|x| x.name == "month_total_token").unwrap();
        assert_eq!(month.label, "本月用量");
    }

    #[test]
    fn auth_failure_is_readable() {
        let body = r#"{"code":401,"loginUrl":"https://account.xiaomi.com/pass/serviceLogin?sid=api-platform"}"#;
        let err = parse_token_plan_usage(body).unwrap_err();
        assert!(err.contains("Cookie"), "{err}");
    }

    #[test]
    fn parses_money_fields_and_keeps_discovered_fallback() {
        // 字段名与实测 /api/v1/balance 返回一致（金额是字符串，含负数）
        let body = r#"{"code":0,"message":"","data":{"balance":"-0.15","frozenBalance":"0.00","currency":"CNY","overdraftLimit":"0.00","remainingOverdraftLimit":"0.00","giftBalance":"0.00","cashBalance":"0.00"}}"#;
        let m = parse_balance(body).expect("应解析成功");
        assert_eq!(m.balance, Some(-0.15));
        assert_eq!(m.cash, Some(0.0));
        assert_eq!(m.gift, Some(0.0));
        assert_eq!(m.frozen, Some(0.0));
        assert_eq!(m.overdraft, Some(0.0));
        assert_eq!(m.currency, "CNY");
    }

    #[test]
    fn balance_without_amount_fields_is_reported() {
        let err = parse_balance(r#"{"code":0,"data":{"foo":1}}"#).unwrap_err();
        assert!(err.contains("balance"), "{err}");
    }

    #[test]
    fn parses_plan_detail_and_summary() {
        let body = r#"{"code":0,"message":"","data":{"planCode":"lite","planName":"Lite","currentPeriodEnd":"2026-10-23 23:59:59","expired":false,"enableAutoRenew":true,"autoRenewDiscount":null,"hasAutoRenewSubscribed":true}}"#;
        let p = parse_plan_detail(body)
            .expect("应解析成功")
            .expect("应有套餐");
        assert_eq!(p.plan_name, "Lite");
        assert!(!p.expired);
        assert!(p.enable_auto_renew);
        assert_eq!(
            p.summary(),
            "Lite 套餐 · 当前期至 2026-10-23 · 自动续费已开"
        );
    }

    #[test]
    fn plan_detail_without_data_means_no_plan() {
        assert!(
            parse_plan_detail(r#"{"code":0,"message":""}"#)
                .expect("应解析成功")
                .is_none()
        );
    }
}
