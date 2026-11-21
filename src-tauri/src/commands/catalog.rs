//! 本地模型资料和价格比对接口。

use crate::{
    catalog,
    model::{CatalogEntry, ModelCard, PriceComparison},
    pricing, providers, AppState,
};
use chrono::Local;
use std::collections::{HashMap, HashSet};
use tauri::State;

/// 第三方参考价的缓存时长：6 小时
const REFERENCE_TTL_SECONDS: i64 = 6 * 3600;

#[tauri::command]
pub fn model_cards(state: State<'_, AppState>, provider: Option<String>) -> Vec<ModelCard> {
    let accounts = state.config_snapshot().accounts;
    let overrides = state
        .overrides
        .lock()
        .map(|o| o.clone())
        .unwrap_or_default();
    let statuses = state.statuses.lock().map(|s| s.clone()).unwrap_or_default();

    let filter = provider.unwrap_or_default();
    let catalog = crate::ai_models::catalog_entries(&state);
    let mut cards = Vec::new();
    for account in accounts.iter() {
        if !filter.is_empty() && account.provider != filter {
            continue;
        }
        if let Some(status) = statuses.get(&account.id) {
            cards.extend(catalog::cards_for_account(
                &account.provider,
                &account.id,
                &status.models,
                &catalog,
                &overrides,
            ));
        }
    }
    let mut merged = catalog::merge_cards(cards);
    // 手动隐藏的模型仍然返回，只打上 hidden 标记，由前端决定展示与否（「显示已隐藏」要用）
    let hidden: HashSet<String> = state
        .hidden_models
        .lock()
        .map(|h| h.iter().map(|id| catalog::normalize(id)).collect())
        .unwrap_or_default();
    for card in &mut merged {
        card.hidden = hidden.contains(&catalog::normalize(&card.id));
    }
    merged
}

/// 在模型库里隐藏/恢复某个模型（按 id 记在本机 hidden_models.json）
#[tauri::command]
pub fn set_model_hidden(
    state: State<'_, AppState>,
    model_id: String,
    hidden: bool,
) -> Result<(), String> {
    let mut list = state
        .hidden_models
        .lock()
        .map_err(|_| "隐藏列表锁定失败".to_string())?;
    let norm = catalog::normalize(&model_id);
    let mut next = list.clone();
    // 先去掉同归一化 id 的旧记录，保证同一模型只有一条
    next.retain(|id| catalog::normalize(id) != norm);
    if hidden {
        next.push(model_id);
    }
    state.store.save_hidden_models(&next)?;
    *list = next;
    Ok(())
}

/// 保存用户对某个模型资料的本地修改（按 match 第一项作为键）
#[tauri::command]
pub fn save_catalog_entry(state: State<'_, AppState>, entry: CatalogEntry) -> Result<(), String> {
    let mut overrides = state
        .overrides
        .lock()
        .map_err(|_| "资料库锁定失败".to_string())?;
    catalog::save_entry(&mut overrides, entry, |next| {
        state.store.save_overrides(next)
    })
}

/// 清空本地资料库覆盖，恢复内置资料
#[tauri::command]
pub fn reset_catalog_overrides(state: State<'_, AppState>) -> Result<(), String> {
    let mut overrides = state
        .overrides
        .lock()
        .map_err(|_| "资料库锁定失败".to_string())?;
    state.store.save_overrides(&[])?;
    overrides.clear();
    Ok(())
}

/// 保留当前覆盖，与内置资料分开供用户核对，不能自动合并不同来源的价格。
fn resolve_entry(
    state: &AppState,
    provider: &str,
    model_id: &str,
) -> Result<(CatalogEntry, Option<CatalogEntry>), String> {
    let overrides = state
        .overrides
        .lock()
        .map_err(|_| "资料库暂不可用".to_string())?;
    Ok(catalog::comparison_entries(
        &crate::ai_models::catalog_entries(state),
        &overrides,
        provider,
        model_id,
    ))
}

/// 取第三方参考价（带 6 小时内存缓存）
async fn reference_index(
    state: &AppState,
    force: bool,
) -> Result<HashMap<String, pricing::RefPrice>, String> {
    let now = Local::now().timestamp();
    if !force {
        if let Ok(guard) = state.reference_prices.lock() {
            if let Some((at, map)) = guard.as_ref() {
                if now - at < REFERENCE_TTL_SECONDS {
                    return Ok(map.clone());
                }
            }
        }
    }
    let refs = pricing::fetch_reference(&state.http).await?;
    let map = pricing::index_reference(&refs);
    if let Ok(mut guard) = state.reference_prices.lock() {
        *guard = Some((now, map.clone()));
    }
    Ok(map)
}

/// 模型价格比对：把本地资料库、官方定价页抓取、第三方参考价摆在一起，
/// 并给出一个「可信度」结论。
#[tauri::command]
pub async fn compare_prices(
    state: State<'_, AppState>,
    model_id: String,
    provider: String,
    include_page: bool,
    include_reference: bool,
) -> Result<PriceComparison, String> {
    let (entry, builtin) = resolve_entry(&state, &provider, &model_id)?;

    let mut page = None;
    if include_page {
        let url = providers::find(&provider)
            .map(|d| d.pricing_url.to_string())
            .unwrap_or_default();
        let mut hints = entry.r#match.clone();
        hints.push(model_id.clone());
        if !entry.name.is_empty() {
            hints.push(entry.name.clone());
        }
        page = Some(pricing::scan_pricing_page(&state.http, &url, &hints).await);
    }

    let mut reference = None;
    let mut warnings: Vec<String> = Vec::new();
    if include_reference {
        match reference_index(&state, false).await {
            Ok(map) => {
                reference = map.get(&catalog::normalize(&model_id)).cloned();
                if reference.is_none() {
                    warnings.push(format!(
                        "第三方参考价里没有收录「{model_id}」，该模型只有本地资料与官方定价页两个来源。"
                    ));
                }
            }
            Err(e) => warnings.push(e),
        }
    }

    let mut cmp = pricing::build_comparison(
        &model_id,
        &entry.name,
        &provider,
        entry.price.clone(),
        entry.verified,
        entry.verified_at.clone(),
        entry.source.clone(),
        builtin.as_ref(),
        page,
        reference,
    );
    cmp.warnings.extend(warnings);
    Ok(cmp)
}
