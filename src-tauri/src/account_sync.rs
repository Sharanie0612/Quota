//! Shared-directory display data only. This module never reads the credential store.
use crate::{
    commands::AppState,
    model::{Account, AccountStatus, Balance, BalanceAmount},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::Path,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Profile {
    id: String,
    provider: String,
    label: String,
    created_at: String,
    balance_mode: Option<String>,
    low_balance_threshold: f64,
    manual_balance: Option<f64>,
    manual_currency: Option<String>,
    manual_recharge_total: Option<f64>,
    manual_recharge_currency: Option<String>,
    manual_spend_total: Option<f64>,
    manual_spend_currency: Option<String>,
    quota_total: Option<f64>,
}
impl Profile {
    fn from(a: &Account) -> Self {
        Self {
            id: a.id.clone(),
            provider: a.provider.clone(),
            label: a.label.clone(),
            created_at: a.created_at.clone(),
            balance_mode: a.balance_mode.clone(),
            low_balance_threshold: a.low_balance_threshold,
            manual_balance: a.manual_balance,
            manual_currency: a.manual_currency.clone(),
            manual_recharge_total: a.manual_recharge_total,
            manual_recharge_currency: a.manual_recharge_currency.clone(),
            manual_spend_total: a.manual_spend_total,
            manual_spend_currency: a.manual_spend_currency.clone(),
            quota_total: a.quota_total,
        }
    }
    fn apply(&self, a: &mut Account) {
        a.label = self.label.clone();
        a.balance_mode = self.balance_mode.clone();
        a.low_balance_threshold = self.low_balance_threshold;
        a.manual_balance = self.manual_balance;
        a.manual_currency = self.manual_currency.clone();
        a.manual_recharge_total = self.manual_recharge_total;
        a.manual_recharge_currency = self.manual_recharge_currency.clone();
        a.manual_spend_total = self.manual_spend_total;
        a.manual_spend_currency = self.manual_spend_currency.clone();
        a.quota_total = self.quota_total;
    }
    fn valid(&self) -> bool {
        uuid::Uuid::parse_str(&self.id).is_ok()
            && crate::providers::find(&self.provider).is_some()
            && self.label.len() <= 640
            && !self.label.chars().any(char::is_control)
            && self
                .balance_mode
                .as_deref()
                .is_none_or(|m| matches!(m, "auto" | "manual" | "custom" | "console" | "codex"))
            && chrono::DateTime::parse_from_rfc3339(&self.created_at).is_ok()
            && self.low_balance_threshold.is_finite()
            && self.low_balance_threshold >= 0.0
            && [
                self.manual_balance,
                self.manual_recharge_total,
                self.manual_spend_total,
                self.quota_total,
            ]
            .iter()
            .flatten()
            .all(|v| v.is_finite())
            && self.manual_currency.as_deref().is_none_or(balance_unit)
            && (self.manual_currency.as_deref() != Some("%")
                || self.manual_balance.is_none_or(|v| (0.0..=100.0).contains(&v)))
            && [
                &self.manual_recharge_currency,
                &self.manual_spend_currency,
            ]
            .iter()
            .all(|c| c.as_deref().is_none_or(currency))
    }
}
fn currency(c: &str) -> bool {
    matches!(c, "CNY" | "USD" | "EUR" | "GBP" | "JPY" | "HKD" | "Credits")
}
fn balance_unit(unit: &str) -> bool {
    currency(unit) || unit == "%"
}
fn kind_label(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "total" => "总额",
        "cash" => "充值余额",
        "voucher" | "granted" => "赠送余额",
        "topped_up" => "充值余额",
        "cumulative_recharge" => "累计充值",
        "spent" | "cumulative_spend" => "累计消费",
        "charge" => "充值余额",
        "frozen" => "冻结",
        "overdraft" => "透支额度",
        "compensation" => "补偿额度",
        "credit" | "quota" => "额度",
        "used" => "已用额度",
        "month_used" => "本月已用",
        "month_limit" => "本月额度",
        _ => return None,
    })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Amount {
    kind: String,
    value: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Money {
    currency: String,
    total: Option<f64>,
    amounts: Vec<Amount>,
    usable: Option<bool>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Window {
    label: String,
    remaining: f64,
    reset_at: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    plan: String,
    windows: Vec<Window>,
}
fn plan_name(s: &str) -> &str {
    match s.to_ascii_lowercase().as_str() {
        "free" => "free",
        "plus" => "plus",
        "pro" => "pro",
        "team" => "team",
        "business" => "business",
        "enterprise" => "enterprise",
        "edu" => "edu",
        _ => "订阅",
    }
}
fn window_label(s: &str) -> bool {
    matches!(
        s,
        "5 小时额度" | "每周额度" | "每月额度" | "短期额度" | "长期额度"
    )
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    at: String,
    balance: Option<Money>,
    subscription: Option<Plan>,
}
impl Snapshot {
    fn from(s: &AccountStatus) -> Option<Self> {
        let at = s.last_checked.clone()?;
        let balance = s
            .balance
            .as_ref()
            .filter(|b| balance_unit(&b.currency))
            .map(|b| Money {
                currency: b.currency.clone(),
                total: b.total,
                usable: b.usable,
                amounts: b
                    .amounts
                    .iter()
                    .filter(|a| kind_label(&a.kind).is_some())
                    .take(32)
                    .map(|a| Amount {
                        kind: a.kind.clone(),
                        value: a.value,
                    })
                    .collect(),
            });
        let subscription = s.subscription.as_ref().map(|p| Plan {
            plan: plan_name(&p.plan).into(),
            windows: p
                .windows
                .iter()
                .filter(|w| window_label(&w.label))
                .take(8)
                .map(|w| Window {
                    label: w.label.clone(),
                    remaining: w.remaining,
                    reset_at: w.reset_at,
                })
                .collect(),
        });
        let value = Self {
            at,
            balance,
            subscription,
        };
        if value.valid() {
            Some(value)
        } else {
            None
        }
    }
    fn valid(&self) -> bool {
        chrono::DateTime::parse_from_rfc3339(&self.at).is_ok_and(|t| {
            t.timestamp_millis() <= chrono::Utc::now().timestamp_millis() + 24 * 3600 * 1000
        }) && (self.balance.is_some() || self.subscription.is_some())
            && self.balance.as_ref().is_none_or(|b| {
                balance_unit(&b.currency)
                    && b.total.is_none_or(f64::is_finite)
                    && (b.currency != "%"
                        || (b.total.is_none_or(|v| (0.0..=100.0).contains(&v))
                            && b.amounts.iter().all(|a| (0.0..=100.0).contains(&a.value))))
                    && b.amounts.len() <= 32
                    && b.amounts
                        .iter()
                        .all(|a| kind_label(&a.kind).is_some() && a.value.is_finite())
            })
            && self.subscription.as_ref().is_none_or(|p| {
                p.plan == plan_name(&p.plan)
                    && p.windows.len() <= 8
                    && p.windows.iter().all(|w| {
                        window_label(&w.label)
                            && w.remaining.is_finite()
                            && (0.0..=100.0).contains(&w.remaining)
                    })
            })
    }
    fn apply(&self, s: &mut AccountStatus) {
        s.balance = self.balance.as_ref().map(|b| Balance {
            currency: b.currency.clone(),
            total: b.total,
            source: "shared".into(),
            usable: b.usable,
            note: Some("共享目录快照；登录信息仅在本机配置".into()),
            raw: None,
            amounts: b
                .amounts
                .iter()
                .map(|a| BalanceAmount {
                    label: kind_label(&a.kind).unwrap_or("额度").into(),
                    kind: a.kind.clone(),
                    value: a.value,
                })
                .collect(),
        });
        s.subscription = self
            .subscription
            .as_ref()
            .map(|p| crate::subscription::Subscription {
                plan: p.plan.clone(),
                windows: p
                    .windows
                    .iter()
                    .map(|w| crate::subscription::UsageWindow {
                        label: w.label.clone(),
                        remaining: w.remaining,
                        reset_at: w.reset_at,
                    })
                    .collect(),
            });
        s.last_checked = Some(self.at.clone());
    }
}
fn newer_time(a: &str, b: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(a).ok() > chrono::DateTime::parse_from_rfc3339(b).ok()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    profile: Profile,
    edited: i64,
    device: String,
    snapshot: Option<Snapshot>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Local {
    records: BTreeMap<String, Record>,
    hidden: BTreeSet<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Packet {
    schema: u32,
    device: String,
    records: Vec<Record>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub last_synced: Option<String>,
    pub error: Option<String>,
}
fn read<T: serde::de::DeserializeOwned>(p: &Path) -> Result<T, String> {
    if fs::symlink_metadata(p)
        .map_err(|_| "同步文件暂不可用")?
        .file_type()
        .is_symlink()
    {
        return Err("不读取同步目录中的符号链接".into());
    }
    let file = fs::File::open(p).map_err(|_| "同步文件暂不可用")?;
    let mut bytes = Vec::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "同步文件尚未下载完成")?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("账户同步文件超过 4 MB 上限".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "账户同步格式无效，未覆盖本机数据".into())
}
fn write<T: Serialize>(p: &Path, v: &T) -> Result<(), String> {
    let body = serde_json::to_string(v).map_err(|_| "编码同步数据失败")?;
    if body.len() > 4 * 1024 * 1024 {
        return Err("账户同步文件过大".into());
    }
    let parent = p.parent().ok_or("保存目录无效")?;
    let temp = parent.join(format!(".quota-account-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(body.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, p)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result.map_err(|_| "保存账户同步数据失败，稍后可重试".into())
}

pub fn sync(state: &AppState) -> Result<(), String> {
    let _guard = state.account_sync_lock.lock().map_err(|_| "账户同步忙碌")?;
    let options = crate::activity::options(state.store.dir());
    if options.sync_dir.is_empty() || !options.sync_accounts {
        return Ok(());
    }
    let result = exchange(state);
    let previous: SyncStatus =
        read(&state.store.dir().join("account-sync-status.json")).unwrap_or_default();
    let status = SyncStatus {
        last_synced: if result.is_ok() {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            previous.last_synced
        },
        error: result.as_ref().err().cloned(),
    };
    write(&state.store.dir().join("account-sync-status.json"), &status)?;
    result
}
fn exchange(state: &AppState) -> Result<(), String> {
    let options = crate::activity::options(state.store.dir());
    if options.sync_dir.is_empty() || !options.sync_accounts {
        return Ok(());
    }
    if uuid::Uuid::parse_str(&options.device_id).is_err() {
        return Err("本机设备标识无效，未写入共享目录".into());
    }
    let root = Path::new(&options.sync_dir).join("quota-accounts-v1");
    if fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("账户同步子目录不能是符号链接".into());
    }
    fs::create_dir_all(&root).map_err(|_| "共享目录不可用，账户保留在本机")?;
    let path = state.store.dir().join("account-sync-state.json");
    let mut local: Local = if path.exists() {
        read(&path)?
    } else {
        Local::default()
    };
    let mut config = state.config.lock().map_err(|_| "读取账户失败")?;
    let mut statuses = state.statuses.lock().map_err(|_| "读取余额失败")?;
    let now = chrono::Utc::now().timestamp_millis();
    let ids: BTreeSet<_> = config.accounts.iter().map(|a| a.id.clone()).collect();
    for id in local.records.keys() {
        if !ids.contains(id) {
            local.hidden.insert(id.clone());
        }
    }
    for account in &config.accounts {
        local.hidden.remove(&account.id);
        let profile = Profile::from(account);
        if !profile.valid() {
            return Err("账户显示资料不符合共享格式，请检查币种或账户标识".into());
        }
        let old = local.records.get(&account.id);
        let edited = old.map_or(now, |r| {
            if r.profile == profile {
                r.edited
            } else {
                now.max(r.edited.saturating_add(1))
            }
        });
        let device = old
            .filter(|r| r.profile == profile)
            .map_or(options.device_id.clone(), |r| r.device.clone());
        let snapshot = statuses
            .get(&account.id)
            .and_then(Snapshot::from)
            .filter(|s| {
                old.and_then(|r| r.snapshot.as_ref())
                    .is_none_or(|o| newer_time(&s.at, &o.at))
            })
            .or_else(|| old.and_then(|r| r.snapshot.clone()));
        local.records.insert(
            account.id.clone(),
            Record {
                profile,
                edited,
                device,
                snapshot,
            },
        );
    }
    if local.records.len() > 1000 {
        return Err("账户同步最多支持 1000 个账户".into());
    }
    // Persist observed local edits before network-directory IO; retry never loses them.
    write(&path, &local)?;
    let mut files = 0;
    for entry in fs::read_dir(&root).map_err(|_| "共享目录暂不可用")? {
        let entry = entry.map_err(|_| "共享目录暂不可用")?;
        if entry.path().extension().is_none_or(|e| e != "json")
            || !entry.file_type().is_ok_and(|t| t.is_file())
        {
            continue;
        }
        files += 1;
        if files > 100 {
            return Err("账户同步设备文件过多".into());
        }
        let packet: Packet = read(&entry.path())?;
        if packet.schema != 1
            || uuid::Uuid::parse_str(&packet.device).is_err()
            || packet.records.len() > 1000
        {
            return Err("账户同步格式无效".into());
        }
        for remote in packet.records {
            if !remote.profile.valid()
                || uuid::Uuid::parse_str(&remote.device).is_err()
                || remote.edited < 0
                || remote.edited > now + 24 * 3600 * 1000
                || remote.snapshot.as_ref().is_some_and(|s| !s.valid())
            {
                return Err("账户同步记录无效".into());
            }
            if local.hidden.contains(&remote.profile.id) {
                continue;
            }
            let id = remote.profile.id.clone();
            if let Some(old) = local.records.get_mut(&id) {
                if old.profile.provider != remote.profile.provider {
                    return Err("同一账户标识的平台冲突，未合并".into());
                }
                if (remote.edited, &remote.device) > (old.edited, &old.device) {
                    old.profile = remote.profile;
                    old.edited = remote.edited;
                    old.device = remote.device;
                }
                if let Some(snapshot) = remote.snapshot {
                    if old
                        .snapshot
                        .as_ref()
                        .is_none_or(|s| newer_time(&snapshot.at, &s.at))
                    {
                        old.snapshot = Some(snapshot)
                    }
                }
            } else {
                local.records.insert(id, remote);
            }
        }
    }
    if local.records.len() > 1000 {
        return Err("账户同步最多支持 1000 个账户".into());
    }
    let mut next = config.clone();
    for (id, row) in &local.records {
        if local.hidden.contains(id) {
            continue;
        }
        if let Some(account) = next.accounts.iter_mut().find(|a| &a.id == id) {
            row.profile.apply(account)
        } else {
            // Construct from the whitelist only. All connection fields default to absent.
            let mut account:Account=serde_json::from_value(serde_json::json!({"id":id,"provider":row.profile.provider,"label":row.profile.label,"createdAt":row.profile.created_at})).map_err(|_|"创建共享账户失败")?;
            row.profile.apply(&mut account);
            next.accounts.push(account);
        }
    }
    state.store.save_config(&next)?;
    *config = next;
    for (id, row) in &local.records {
        if !local.hidden.contains(id) {
            if let Some(snapshot) = &row.snapshot {
                let status = statuses.entry(id.clone()).or_default();
                if status
                    .last_checked
                    .as_deref()
                    .is_none_or(|at| newer_time(&snapshot.at, at))
                {
                    snapshot.apply(status)
                }
            }
        }
    }
    write(&path, &local)?;
    let packet = Packet {
        schema: 1,
        device: options.device_id.clone(),
        records: local
            .records
            .into_iter()
            .filter(|(id, _)| !local.hidden.contains(id))
            .map(|(_, row)| row)
            .collect(),
    };
    let own = root.join(format!("{}.json", options.device_id));
    if fs::symlink_metadata(&own).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("账户同步文件不能是符号链接".into());
    }
    write(&own, &packet)
}
#[tauri::command]
pub fn get_account_sync_status(app: AppHandle) -> SyncStatus {
    read(
        &app.state::<AppState>()
            .store
            .dir()
            .join("account-sync-status.json"),
    )
    .unwrap_or_default()
}
#[tauri::command]
pub async fn sync_accounts(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = sync(&app.state::<AppState>());
        let _ = app.emit("accounts-updated", ());
        result
    })
    .await
    .map_err(|_| "账户同步任务中断")?
}
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        loop {
            let options = crate::activity::options(app.state::<AppState>().store.dir());
            if options.sync_accounts && !options.sync_dir.is_empty() {
                let _ = sync_accounts(app.clone()).await;
            }
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    });
}
