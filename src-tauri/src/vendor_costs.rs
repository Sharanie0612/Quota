//! Actual vendor spending. Never derive spending from public API token rates.
use crate::{
    activity::Metric,
    commands::AppState,
    model::{Account, AccountStatus},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expense {
    pub vendor: String,
    pub from: String,
    pub to: String,
    pub currency: String,
    pub subscription: Option<f64>,
    pub usage: Option<f64>,
    pub plan_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Sample {
    at: i64,
    currency: String,
    recharge: Option<f64>,
    spend: Option<f64>,
}
#[derive(Default, Serialize, Deserialize)]
struct CostFile {
    #[serde(default)]
    expenses: BTreeMap<String, Expense>,
    #[serde(default)]
    samples: BTreeMap<String, Vec<Sample>>,
}
fn load(dir: &Path) -> Result<CostFile, String> {
    let path = dir.join("vendor-costs.json");
    match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b).map_err(|_| "实际支出记录损坏，已保留原文件".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(CostFile::default()),
        Err(_) => Err("无法读取实际支出记录".into()),
    }
}
fn save(dir: &Path, value: &CostFile) -> Result<(), String> {
    crate::storage::write_atomic(
        &dir.join("vendor-costs.json"),
        &serde_json::to_string(value).map_err(|_| "编码实际支出失败")?,
    )
}
fn vendor(provider: &str) -> &str {
    if provider == "mimo-plan" {
        "mimo"
    } else {
        provider
    }
}
fn known_vendor(v: &str) -> bool {
    matches!(
        v,
        "custom"
            | "mimo"
            | "moonshot"
            | "zhipu"
            | "deepseek"
            | "anthropic"
            | "google"
            | "alibaba"
            | "unknown"
    )
}
fn date(s: &str) -> Result<chrono::NaiveDate, String> {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "支出日期无效".into())
}
fn key(v: &str, from: &str, to: &str, currency: &str) -> String {
    serde_json::json!([v, from, to, currency]).to_string()
}

pub(crate) fn expense_key(e: &Expense) -> String {
    key(&e.vendor, &e.from, &e.to, &e.currency)
}
pub(crate) fn valid_sync_key(id: &str) -> bool {
    let Ok([vendor, from, to, currency]) = serde_json::from_str::<[String; 4]>(id) else { return false; };
    known_vendor(&vendor) && date(&from).is_ok() && date(&to).is_ok() && from <= to
        && matches!(currency.as_str(), "CNY" | "USD") && key(&vendor, &from, &to, &currency) == id
}
pub(crate) fn valid_expense(e: &Expense) -> bool {
    valid_sync_key(&expense_key(e)) && (e.subscription.is_some() || e.usage.is_some())
        && [e.subscription, e.usage].iter().flatten().all(|n| n.is_finite() && (0.0..=1e9).contains(n))
        && e.plan_id.as_ref().is_none_or(|id| plans().iter().any(|p| p.id == *id && p.vendor == e.vendor))
}
pub(crate) fn validate_expenses(rows: &BTreeMap<String, Expense>) -> Result<(), String> {
    let mut ranges = BTreeMap::new();
    for (id, e) in rows {
        if expense_key(e) != *id || !valid_expense(e) { return Err("同步账期格式无效".into()); }
        ranges.entry((&e.vendor, &e.currency)).or_insert_with(Vec::new).push(e);
    }
    for ((vendor, currency), mut group) in ranges {
        group.sort_by_key(|e| &e.from);
        for pair in group.windows(2) {
            if pair[0].to >= pair[1].from {
                return Err(format!("{vendor} {currency} 的账期 {}–{} 与 {}–{} 重叠；请在原设备调整或删除其中一条后同步，当前账期已保留", pair[0].from, pair[0].to, pair[1].from, pair[1].to));
            }
        }
    }
    Ok(())
}
pub(crate) type Samples = BTreeMap<String, Vec<Sample>>;
pub(crate) fn valid_samples(rows: &Samples) -> bool {
    rows.len() <= 1000 && rows.values().map(Vec::len).sum::<usize>() <= 50_000
        && rows.iter().all(|(id, values)| uuid::Uuid::parse_str(id).is_ok() && values.iter().all(|s|
            s.at > 0 && s.at <= chrono::Utc::now().timestamp() + 86400
            && matches!(s.currency.as_str(), "CNY" | "USD") && (s.recharge.is_some() || s.spend.is_some())
            && [s.recharge, s.spend].iter().flatten().all(|n| n.is_finite() && (0.0..=1e15).contains(n))))
}
pub(crate) fn sync_data(dir: &Path) -> Result<(BTreeMap<String, Expense>, Samples), String> {
    let value = load(dir)?;
    validate_expenses(&value.expenses)?;
    if !valid_samples(&value.samples) { return Err("消费快照格式无效，原文件已保留".into()); }
    Ok((value.expenses, value.samples))
}
pub(crate) fn apply_sync(dir: &Path, expenses: BTreeMap<String, Expense>, incoming: Samples) -> Result<(), String> {
    validate_expenses(&expenses)?;
    if !valid_samples(&incoming) { return Err("同步消费快照格式无效".into()); }
    let mut file = load(dir)?;
    file.expenses = expenses;
    for (id, samples) in incoming {
        let list = file.samples.entry(id).or_default();
        list.extend(samples);
        // A provider observation is identified by account/time/currency, never summed.
        list.sort_by(|a,b| (a.at, &a.currency, serde_json::to_string(a).unwrap_or_default()).cmp(&(b.at, &b.currency, serde_json::to_string(b).unwrap_or_default())));
        list.dedup_by(|a,b| a.at == b.at && a.currency == b.currency);
        let mut compact: Vec<Sample> = Vec::new();
        for sample in list.drain(..) {
            let same = |a: &Sample, b: &Sample| a.currency == b.currency && a.recharge == b.recharge && a.spend == b.spend;
            if compact.len() >= 2 && same(&compact[compact.len()-1], &sample) && same(&compact[compact.len()-2], &sample) { compact.pop(); }
            compact.push(sample);
        }
        *list = compact;
    }
    if !valid_samples(&file.samples) { return Err("合并消费快照超过上限，原记录已保留".into()); }
    save(dir, &file)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub vendor: String,
    pub name: String,
    pub currency: String,
    pub amount: f64,
    pub months: u32,
    pub source: String,
    pub verified_at: String,
    pub condition: String,
}
pub fn plans() -> Vec<Plan> {
    let mut result = Vec::new();
    let mut add = |id: &str,
                   v: &str,
                   name: &str,
                   currency: &str,
                   amount: f64,
                   months: u32,
                   url: &str,
                   condition: &str| {
        result.push(Plan {
            id: id.into(),
            vendor: v.into(),
            name: name.into(),
            currency: currency.into(),
            amount,
            months,
            source: url.into(),
            verified_at: "2026-10-14".into(),
            condition: condition.into(),
        })
    };
    let openai = "https://learn.chatgpt.com/docs/pricing";
    for (id, name, value) in [
        ("plus", "ChatGPT Plus", 20.0),
        ("pro100", "ChatGPT Pro 100", 100.0),
        ("pro200", "ChatGPT Pro 200", 200.0),
        ("pro500", "ChatGPT Pro 500", 500.0),
    ] {
        add(
            id,
            "custom",
            name,
            "USD",
            value,
            1,
            openai,
            "公开月费；不含税费、额外额度购买或渠道加价",
        )
    }
    let mimo = "https://mimo.mi.com/static/docs/tokenplan/Token%20Plan/subscription.md";
    for (id, name, cny, usd) in [
        ("lite", "Lite", 39.0, 6.0),
        ("standard", "Standard", 99.0, 16.0),
        ("pro", "Pro", 329.0, 50.0),
        ("max", "Max", 659.0, 100.0),
    ] {
        add(
            &format!("mimo-{id}-cn"),
            "mimo",
            &format!("MiMo {name} 月付"),
            "CNY",
            cny,
            1,
            mimo,
            "中国区公开月费；续费/首购折扣请改填实付",
        );
        add(
            &format!("mimo-{id}-global"),
            "mimo",
            &format!("MiMo {name} 海外月付"),
            "USD",
            usd,
            1,
            mimo,
            "海外区公开月费；续费/首购折扣请改填实付",
        );
    }
    for (id, name, value) in [
        ("lite-year", "MiMo Lite 年付", 411.84),
        ("standard-year", "MiMo Standard 年付", 1045.44),
    ] {
        add(
            id,
            "mimo",
            name,
            "CNY",
            value,
            12,
            mimo,
            "全年一次支付金额，不能当成月付费用",
        )
    }
    let kimi = "https://www.kimi.com/help/membership/membership-pricing";
    for (id, name, value, year) in [
        ("kimi-plus", "Kimi Plus", 99.0, 948.0),
        ("kimi-pro", "Kimi Pro", 199.0, 1908.0),
        ("kimi-max", "Kimi Max", 699.0, 6708.0),
    ] {
        add(
            id,
            "moonshot",
            &format!("{name} 月付"),
            "CNY",
            value,
            1,
            kimi,
            "国内新套餐；包含 Kimi Code，其他会员功能共享额度",
        );
        add(
            &format!("{id}-year"),
            "moonshot",
            &format!("{name} 年付"),
            "CNY",
            year,
            12,
            kimi,
            "国内新套餐；全年一次付款，按实际订阅期统计",
        );
    }
    for (id, name, value) in [
        ("glm-lite", "GLM Coding Lite", 118.0),
        ("glm-pro", "GLM Coding Pro", 538.0),
        ("glm-max", "GLM Coding Max", 1078.0),
    ] {
        add(
            id,
            "zhipu",
            name,
            "CNY",
            value,
            1,
            "https://zcode.z.ai/cn",
            "官网展示的月付原价；优惠价与实付请按订单填写",
        )
    }
    result
}
pub fn save_expense(dir: &Path, input: Expense) -> Result<(), String> {
    update_expense(dir, input, None)
}

/// Replace a bill in one atomic write, including date/currency changes.
/// The previous value prevents stale editors from overwriting newer records.
pub fn update_expense(dir: &Path, input: Expense, previous: Option<Expense>) -> Result<(), String> {
    if !known_vendor(&input.vendor)
        || date(&input.from)? > date(&input.to)?
        || !matches!(input.currency.as_str(), "CNY" | "USD")
        || [input.subscription, input.usage]
            .iter()
            .flatten()
            .any(|n| !n.is_finite() || !(0.0..=1e9).contains(n))
    {
        return Err("支出范围、金额或币种无效".into());
    }
    if let Some(id) = &input.plan_id {
        let plan = plans()
            .into_iter()
            .find(|p| p.id == *id && p.vendor == input.vendor)
            .ok_or("公开套餐不存在")?;
        if plan.currency != input.currency || input.subscription != Some(plan.amount) {
            return Err("公开套餐价格已调整；实付金额请使用手动记录".into());
        }
        let end = date(&input.from)?
            .checked_add_months(chrono::Months::new(plan.months))
            .and_then(|d| d.pred_opt())
            .ok_or("订阅周期无效")?;
        if date(&input.to)? != end {
            return Err("公开套餐费应使用完整订阅周期；请核对起止日期".into());
        }
    }
    let mut value = load(dir)?;
    let id = key(&input.vendor, &input.from, &input.to, &input.currency);
    if let Some(previous) = previous {
        let old_id = key(
            &previous.vendor,
            &previous.from,
            &previous.to,
            &previous.currency,
        );
        if value.expenses.get(&old_id) != Some(&previous) {
            return Err("此账期已更新或删除，请关闭编辑并重新读取".into());
        }
        if old_id != id && value.expenses.contains_key(&id) {
            return Err("目标账期已有支出记录，请编辑该记录".into());
        }
        value.expenses.remove(&old_id);
    }
    if input.subscription.is_some() || input.usage.is_some() {
        if value.expenses.iter().any(|(old_key, e)| {
            *old_key != id
                && e.vendor == input.vendor
                && e.currency == input.currency
                && e.from <= input.to
                && e.to >= input.from
        }) {
            return Err("该厂商已有重叠支出周期，请编辑原记录或选择不重叠的日期".into());
        }
    }
    if input.subscription.is_none() && input.usage.is_none() {
        value.expenses.remove(&id);
    } else {
        value.expenses.insert(id, input);
    }
    save(dir, &value)
}
fn sample(account: &Account, status: &AccountStatus) -> Option<Sample> {
    if status.balance_error.is_some() {
        return None;
    }
    let balance = status.balance.as_ref()?;
    if !matches!(balance.currency.as_str(), "CNY" | "USD") {
        return None;
    }
    let amount = |kind: &str| {
        balance
            .amounts
            .iter()
            .find(|a| a.kind == kind)
            .map(|a| a.value)
            .filter(|n| n.is_finite() && *n >= 0.0)
    };
    let recharge = amount("cumulative_recharge").or(account
        .manual_recharge_total
        .filter(|_| account.manual_recharge_currency.as_deref() == Some(&balance.currency)));
    let spend = amount("cumulative_spend").or(account
        .manual_spend_total
        .filter(|_| account.manual_spend_currency.as_deref() == Some(&balance.currency)));
    if recharge.is_none() && spend.is_none() {
        return None;
    }
    Some(Sample {
        at: status
            .last_checked
            .as_deref()
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.timestamp())
            .unwrap_or_else(|| chrono::Utc::now().timestamp()),
        currency: balance.currency.clone(),
        recharge,
        spend,
    })
}
fn status_for(state: &AppState, account: &Account) -> Result<AccountStatus, String> {
    let live = state
        .statuses
        .lock()
        .map_err(|_| "读取账面消费失败")?
        .get(&account.id)
        .cloned();
    Ok(live
        .or_else(|| crate::account_sync::saved_finance_status(state.store.dir(), account))
        .unwrap_or_default())
}
pub fn capture(state: &AppState, account: &Account) -> Result<(), String> {
    let status = status_for(state, account)?;
    let Some(next) = sample(account, &status) else {
        return Ok(());
    };
    let _guard = state.billing_lock.lock().map_err(|_| "记录支出忙碌")?;
    let mut file = load(state.store.dir())?;
    let list = file.samples.entry(account.id.clone()).or_default();
    if list.iter().any(|s| s.at == next.at) {
        return Ok(());
    }
    if let Some(last) = list.last() {
        if next.at < last.at {
            return Ok(());
        }
    }
    // Preserve the first observation and each monetary change, with one latest
    // unchanged observation. This grows with money changes rather than polling.
    if list.len() >= 2
        && list[list.len() - 1].currency == next.currency
        && list[list.len() - 1].recharge == next.recharge
        && list[list.len() - 1].spend == next.spend
        && list[list.len() - 2].currency == next.currency
        && list[list.len() - 2].recharge == next.recharge
        && list[list.len() - 2].spend == next.spend
    {
        list.pop();
    }
    list.push(next);
    save(state.store.dir(), &file)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceAccount {
    pub id: String,
    pub vendor: String,
    pub label: String,
    pub currency: String,
    pub cumulative_recharge: Option<f64>,
    pub cumulative_spend: Option<f64>,
    pub observed_recharge: Option<f64>,
    pub observed_spend: Option<f64>,
    pub observed_from: Option<i64>,
    pub observed_to: Option<i64>,
    pub balance_rises: f64,
    pub balance_drops: f64,
    pub history_from: Option<i64>,
    pub history_to: Option<i64>,
    pub plan: Option<String>,
    pub issues: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub accounts: Vec<FinanceAccount>,
    pub expenses: Vec<Expense>,
    pub plans: Vec<Plan>,
    pub covered_models: BTreeMap<String, Vec<crate::activity::Group>>,
    pub lifetime_tokens: crate::activity::Tokens,
    pub lifetime_sessions: u64,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
}
fn covered_models(
    dir: &Path,
    expenses: &[Expense],
    from: &str,
    to: &str,
) -> Result<BTreeMap<String, Vec<crate::activity::Group>>, String> {
    let periods: Vec<_> = expenses
        .iter()
        .filter(|e| {
            e.from.as_str() <= to
                && e.to.as_str() >= from
                && date(&e.from).is_ok_and(|d| d <= chrono::Local::now().date_naive())
        })
        .map(|e| {
            Ok((
                e.vendor.as_str(),
                e.currency.as_str(),
                date(&e.from)?,
                date(&e.to)?,
            ))
        })
        .collect::<Result<_, String>>()?;
    if periods.is_empty() || !dir.join("activity.sqlite").exists() {
        return Ok(BTreeMap::new());
    }
    let db = rusqlite::Connection::open_with_flags(
        dir.join("activity.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| "读取实际用量失败")?;
    db.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "用量资料库忙碌")?;
    let mut statement = db
        .prepare("SELECT body FROM metrics WHERE json_extract(body,'$.kind')='tokens' AND json_extract(body,'$.source')!='trae'")
        .map_err(|_| "读取实际用量失败")?;
    let rows = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "读取实际用量失败")?;
    type Entry = (crate::activity::Tokens, std::collections::BTreeSet<String>);
    let mut groups: BTreeMap<(String, String), Entry> = BTreeMap::new();
    for row in rows {
        let event: Metric = serde_json::from_str(&row.map_err(|_| "读取用量记录失败")?)
            .map_err(|_| "用量记录损坏")?;
        let Some(time) = chrono::DateTime::from_timestamp_millis(event.timestamp) else {
            continue;
        };
        if time > chrono::Utc::now() {
            continue;
        }
        let day = time.with_timezone(&chrono::Local).date_naive();
        if day < date(from)? || day > date(to)? {
            continue;
        }
        let v = crate::activity::model_vendor(&event.model);
        let currencies: std::collections::BTreeSet<_> = periods
            .iter()
            .filter(|(vendor, _, first, last)| *vendor == v && day >= *first && day <= *last)
            .map(|(_, currency, _, _)| *currency)
            .collect();
        if currencies.is_empty() {
            continue;
        }
        for bucket in std::iter::once(v.to_string()).chain(
            currencies
                .into_iter()
                .map(|currency| format!("{v}:{currency}")),
        ) {
            let (t, sessions) = groups.entry((bucket, event.model.clone())).or_default();
            t.input = t.input.saturating_add(event.tokens.input);
            t.output = t.output.saturating_add(event.tokens.output);
            t.cached = t.cached.saturating_add(event.tokens.cached);
            t.cache_write = t.cache_write.saturating_add(event.tokens.cache_write);
            t.reasoning = t.reasoning.saturating_add(event.tokens.reasoning);
            t.total = t.total.saturating_add(event.tokens.total);
            sessions.insert(format!("{}:{}", event.source, event.session));
        }
    }
    let mut result: BTreeMap<String, Vec<crate::activity::Group>> = BTreeMap::new();
    for ((v, key), (tokens, sessions)) in groups {
        result.entry(v).or_default().push(crate::activity::Group {
            key,
            tokens,
            calls: 0,
            sessions: sessions.len() as u64,
        });
    }
    Ok(result)
}
pub fn report(state: &AppState, from: &str, to: &str) -> Result<Report, String> {
    let first = date(from)?;
    let last = date(to)?;
    if first > last {
        return Err("开始日期不能晚于结束日期".into());
    }
    let accounts = state
        .config
        .lock()
        .map_err(|_| "读取支出账户失败")?
        .accounts
        .clone();
    for a in &accounts {
        capture(state, a)?;
    }
    let file = load(state.store.dir())?;
    let history = state
        .history
        .lock()
        .map_err(|_| "读取余额历史失败")?
        .export_points();
    let in_range = |t: i64| {
        chrono::DateTime::from_timestamp(t, 0)
            .map(|t| t.with_timezone(&chrono::Local).date_naive())
            .is_some_and(|d| d >= first && d <= last)
    };
    let mut rows = Vec::new();
    for a in accounts {
        let status = status_for(state, &a)?;
        let ids = crate::account_sync::finance_ids(state.store.dir(), &a);
        let mut merged_samples: Vec<_> = ids.iter().filter_map(|id| file.samples.get(id)).flatten().collect();
        merged_samples.sort_by(|a,b| (a.at, &a.currency, serde_json::to_string(a).unwrap_or_default()).cmp(&(b.at, &b.currency, serde_json::to_string(b).unwrap_or_default())));
        merged_samples.dedup_by(|a,b| a.at == b.at && a.currency == b.currency);
        let current =
            sample(&a, &status).or_else(|| merged_samples.last().map(|s| (*s).clone()));
        let samples: Vec<_> = merged_samples.into_iter()
            .filter(|s| in_range(s.at))
            .collect();
        let mut issues = Vec::new();
        let head = samples.first();
        let tail = samples.last();
        let delta = |field: fn(&Sample) -> Option<f64>| -> Option<f64> {
            let start = head?;
            let end = tail?;
            if start.at >= end.at
                || samples
                    .iter()
                    .any(|s| s.currency != start.currency || field(s).is_none())
            {
                return None;
            }
            let a = field(start)?;
            let b = field(end)?;
            if b < a
                || samples
                    .windows(2)
                    .any(|w| field(w[0]).zip(field(w[1])).is_some_and(|(a, b)| b < a))
            {
                return None;
            }
            Some(b - a)
        };
        let observed_spend = delta(|s| s.spend);
        let observed_recharge = delta(|s| s.recharge);
        if observed_spend.is_none() {
            issues.push("缺少可比较的周期消费计数；累计金额不能直接当作本期支出".into());
        }
        let is_money = !matches!(a.provider.as_str(), "mimo-plan" | "custom")
            && status
                .balance
                .as_ref()
                .is_none_or(|b| matches!(b.currency.as_str(), "CNY" | "USD"));
        let points: Vec<_> = if is_money {
            history
                .get(&a.id)
                .into_iter()
                .flatten()
                .filter(|p| in_range(p.t))
                .collect()
        } else {
            Vec::new()
        };
        let mut rises = 0.0;
        let mut drops = 0.0;
        for p in points.windows(2) {
            let n = p[1].v - p[0].v;
            if n > 0.0 {
                rises += n
            } else {
                drops -= n
            }
        }
        let currency = current
            .as_ref()
            .map(|s| s.currency.clone())
            .or_else(|| {
                status
                    .balance
                    .as_ref()
                    .map(|b| b.currency.clone())
                    .filter(|c| matches!(c.as_str(), "CNY" | "USD"))
            })
            .unwrap_or(if a.provider == "custom" { "USD" } else { "CNY" }.into());
        rows.push(FinanceAccount {
            id: a.id.clone(),
            vendor: vendor(&a.provider).into(),
            label: a.label,
            currency,
            cumulative_recharge: current.as_ref().and_then(|s| s.recharge),
            cumulative_spend: current.as_ref().and_then(|s| s.spend),
            observed_recharge,
            observed_spend,
            observed_from: head.map(|s| s.at),
            observed_to: tail.map(|s| s.at),
            balance_rises: rises,
            balance_drops: drops,
            history_from: points.first().map(|p| p.t),
            history_to: points.last().map(|p| p.t),
            plan: status.subscription.map(|p| p.plan),
            issues,
        });
    }
    let expenses: Vec<_> = file.expenses.into_values().collect();
    let covered_models = covered_models(state.store.dir(), &expenses, from, to)?;
    let lifetime = crate::activity::report_range(
        state.store.dir(),
        None,
        Some("without-trae".into()),
        None,
        None,
        None,
        None,
    )?;
    Ok(Report {
        accounts: rows,
        expenses,
        plans: plans(),
        covered_models,
        lifetime_tokens: lifetime.totals.tokens,
        lifetime_sessions: lifetime.totals.sessions,
        first_date: lifetime.daily.first().map(|d| d.key.clone()),
        last_date: lifetime.daily.last().map(|d| d.key.clone()),
    })
}
#[tauri::command]
pub async fn get_vendor_costs(app: AppHandle, from: String, to: String) -> Result<Report, String> {
    tauri::async_runtime::spawn_blocking(move || report(&app.state::<AppState>(), &from, &to))
        .await
        .map_err(|_| "读取实际支出失败")?
}
#[tauri::command]
pub async fn save_vendor_expense(
    app: AppHandle,
    input: Expense,
    previous: Option<Expense>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.billing_lock.lock().map_err(|_| "支出记录忙碌")?;
        update_expense(state.store.dir(), input, previous)?;
        drop(_guard);
        crate::usage_sync::queue(app.clone());
        Ok(())
    })
    .await
    .map_err(|_| "保存实际支出失败")?
}
