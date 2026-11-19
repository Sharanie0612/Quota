//! 按账户配置查询供应商余额、订阅额度和模型，并应用手动余额。

use crate::{
    aliyun, custom,
    model::{Account, AccountStatus, Balance, BalanceAmount},
    providers::{self, AdminProbe, BalanceProbe},
    secrets, AppState,
};
use chrono::Local;

/// 「其他方式获取余额」之一：用阿里云 AccessKey 读阿里云账户可用额度。
/// 百炼等平台本身没有余额接口，但费用从阿里云账户扣，这条路径能拿到真实余额。
async fn fetch_aliyun_balance(state: &AppState, account_id: &str) -> Result<Balance, String> {
    match secrets::get_access_key(account_id) {
        Some((id, secret)) => {
            aliyun::fetch_account_balance(&state.http, &id, &secret).await
        }
        None => Err(
            "还没有保存阿里云 AccessKey（需要 AccessKey ID 与 Secret 成对填写），无法读取阿里云账户余额。"
                .into(),
        ),
    }
}

/// 查询单个账户的余额与模型列表。
/// 余额按账户选择的「获取方式」来：
///   auto   —— 官方余额接口；没有官方接口时尝试管理员用量接口
///   custom —— 用户配置的自定义余额接口
///   manual —— 只用用户填写的手动余额
/// 任何自动方式失败都会退回手动余额，保证低余额提醒始终可用。
pub(super) async fn query(state: &AppState, account: &Account) -> AccountStatus {
    let mut status = AccountStatus::default();
    let mode = account
        .balance_mode
        .clone()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| "auto".into());

    match providers::find(&account.provider) {
        None => {
            status.balance_error = Some(format!("未知供应商：{}", account.provider));
        }
        Some(def) => {
            let base = providers::base_url_of(def, &account.base_url);
            let blob = secrets::get_secrets(&account.id).unwrap_or_default();
            let api_key = blob.api_key.filter(|k| !k.trim().is_empty());
            let admin_key = blob.admin_key.filter(|k| !k.trim().is_empty());

            // ---------------- 余额 ----------------
            if mode == "manual" {
                // 用户明确选择手动，不发起查询
            } else if def.id == "custom" && matches!(mode.as_str(), "codex" | "auto") {
                match blob.subscription_account.as_deref() {
                    Some(id) => match crate::subscription::fetch(&state.http, Some(id)).await {
                        Ok((quota, _)) => status.subscription = Some(quota),
                        Err(e) => status.balance_error = Some(e),
                    },
                    None => status.balance_error = Some("请连接本机 ChatGPT 登录".into()),
                }
            } else if mode == "custom" {
                match custom::fetch_custom_balance(&state.http, account).await {
                    Ok(b) => status.balance = Some(b),
                    Err(e) => status.balance_error = Some(e),
                }
            } else if mode == "aliyun" {
                match fetch_aliyun_balance(state, &account.id).await {
                    Ok(b) => status.balance = Some(b),
                    Err(e) => status.balance_error = Some(e),
                }
            } else if mode == "console" {
                match crate::connections::query_mimo(state, &account.id, def.id).await {
                    Ok(b) => status.balance = Some(b),
                    Err(e) => status.balance_error = Some(e),
                }
            } else {
                match def.balance {
                    // 官方也没接口，但控制台接口能读（MiMo 余额/用量/套餐余量）
                    BalanceProbe::MimoConsole => {
                        match crate::connections::query_mimo(state, &account.id, def.id).await {
                            Ok(b) => status.balance = Some(b),
                            Err(e) => status.balance_error = Some(e),
                        }
                    }
                    // 官方也没接口，但云厂商账单接口能读（百炼 → 阿里云账户）
                    BalanceProbe::AliyunBss => match fetch_aliyun_balance(state, &account.id).await
                    {
                        Ok(b) => status.balance = Some(b),
                        Err(e) => status.balance_error = Some(e),
                    },
                    // 官方没有余额接口：尝试管理员级用量接口
                    BalanceProbe::Unsupported(_) => {
                        if let (Some(AdminProbe::OpenAiCosts), Some(ak)) =
                            (providers::admin_probe(def), admin_key.as_deref())
                        {
                            if base.trim().is_empty() {
                                status.balance_error =
                                    Some("未填写 Base URL，无法调用用量接口。".into());
                            } else {
                                match providers::fetch_admin_costs(&state.http, def, &base, ak)
                                    .await
                                {
                                    Ok(b) => status.balance = Some(b),
                                    Err(e) => status.balance_error = Some(e),
                                }
                            }
                        } else if providers::admin_probe(def).is_some() {
                            // 有可用的管理员接口，但还没填密钥：给出提示，不算错误
                            status.balance_error = Some(
                                "该平台只能通过管理员用量接口自动获取消费额：请在「编辑」里填写管理员密钥。"
                                    .into(),
                            );
                        }
                    }
                    _ => {
                        if base.trim().is_empty() {
                            status.balance_error = Some(
                                "未填写 Base URL，无法查询余额与模型列表。请在「编辑」里补上。"
                                    .into(),
                            );
                        } else {
                            match api_key.as_deref() {
                                None => {
                                    status.balance_error =
                                        Some("未找到该账户的 API Key，请在「编辑」里填写。".into())
                                }
                                Some(key) => {
                                    match providers::fetch_balance(&state.http, def, &base, key)
                                        .await
                                    {
                                        Ok(b) => status.balance = Some(b),
                                        Err(e) => status.balance_error = Some(e),
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 成本型来源（管理员用量接口）：用「已充值/预算总额 − 累计消费」推算剩余
            if let Some(balance) = status.balance.as_mut() {
                if balance.source == "costs" {
                    let spent = balance
                        .amounts
                        .iter()
                        .find(|a| a.kind == "spent")
                        .map(|a| a.value)
                        .unwrap_or(0.0);
                    match account.quota_total {
                        Some(quota) if quota > 0.0 => {
                            let left = quota - spent;
                            balance.total = Some(left);
                            balance.usable = Some(left > 0.0);
                            balance.amounts.push(BalanceAmount {
                                label: "已充值/预算总额".into(),
                                value: quota,
                                kind: "quota".into(),
                            });
                            balance.note = Some(format!(
                                "按「已充值总额 {:.2} − 近 30 天消费 {:.2}」估算剩余，仅供提醒参考",
                                quota, spent
                            ));
                        }
                        _ => {
                            balance.note = Some(format!(
                                "该平台不提供余额接口，只取到近 30 天消费 {:.2}；填写「已充值/预算总额」后可推算剩余额度",
                                spent
                            ));
                        }
                    }
                }
            }

            // ---------------- 模型列表 ----------------
            if def.models_path.is_empty() {
                // 网页版订阅（ChatGPT）没有 /models 接口：不拉取、也不报错
            } else if base.trim().is_empty() {
                status.models_error = Some("未填写 Base URL，无法拉取模型列表。".into());
            } else {
                match api_key.as_deref() {
                    None => {
                        status.models_error =
                            Some("未找到该账户的 API Key，无法拉取模型列表。".into())
                    }
                    Some(key) => {
                        match providers::fetch_models(&state.http, def, &base, key).await {
                            Ok(models) => status.models = models,
                            Err(e) => status.models_error = Some(e),
                        }
                    }
                }
            }
        }
    }

    // 平台本来就不支持余额接口时，不把说明当作错误报红
    if !matches!(mode.as_str(), "custom") {
        if let Some(def) = providers::find(&account.provider) {
            let unsupported_offline = matches!(def.balance, BalanceProbe::Unsupported(_))
                && providers::admin_probe(def).is_none();
            if unsupported_offline && account.provider != "custom" && status.balance_error.is_some()
            {
                status.balance_error = None;
            }
        }
    }

    status.last_checked = Some(Local::now().to_rfc3339());
    status
}

/// 首次读取即可显示已保存的手动记录；自动订阅成功时不再被备用手动值遮住。
pub fn apply_manual_balance(account: &Account, status: &mut AccountStatus) {
    let explicit_manual = account.balance_mode.as_deref() == Some("manual");
    if explicit_manual {
        status.subscription = None;
        status.balance = None;
        status.balance_error = None;
    } else if status.balance.is_some() || status.subscription.is_some() {
        return;
    }
    if let Some(manual) = account.manual_balance.filter(|value| value.is_finite()) {
        status.balance = Some(Balance {
            currency: account
                .manual_currency
                .clone()
                .filter(|currency| !currency.trim().is_empty())
                .unwrap_or_else(|| "CNY".into()),
            total: Some(manual),
            source: "manual".into(),
            amounts: Vec::new(),
            usable: Some(manual > 0.0),
            note: Some(
                if explicit_manual {
                    "手动记录"
                } else {
                    "备用手动记录，尚未取得自动余额或订阅额度"
                }
                .into(),
            ),
            raw: None,
        });
    }
}
