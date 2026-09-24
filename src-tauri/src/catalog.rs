//! 内置模型资料库 + 本地覆盖，负责把 API 拉回来的 model id 匹配成可读的模型卡片。

use crate::model::{CatalogEntry, CatalogFile, ModelCard, RemoteModel};
use std::collections::HashSet;

const EMBEDDED: &str = include_str!("../data/model_catalog.json");

pub fn embedded_file() -> CatalogFile {
    serde_json::from_str(EMBEDDED).unwrap_or_else(|e| {
        eprintln!("[Quota] 内置模型资料库解析失败：{e}");
        CatalogFile::default()
    })
}

/// 归一化 model id：小写、去掉「厂商/」前缀、去掉 :tag 后缀、去掉纯数字的日期/版本段。
/// 例：`deepseek-ai/DeepSeek-V3-20250929:free` -> `deepseek-v3`
pub fn normalize(id: &str) -> String {
    let lower = id.trim().to_lowercase();
    let no_prefix = lower.rsplit('/').next().unwrap_or(&lower).to_string();
    let no_tag = no_prefix.split(':').next().unwrap_or("").to_string();
    let parts: Vec<&str> = no_tag
        .split(['-', '_'])
        .filter(|p| !(p.len() >= 4 && p.chars().all(|c| c.is_ascii_digit())))
        .collect();
    parts.join("-").trim_matches('-').to_string()
}

fn tokens(s: &str) -> HashSet<&str> {
    s.split(['-', '.', '_', ' ']).filter(|t| !t.is_empty()).collect()
}

/// 0~100 的相似度打分
fn score(target: &str, key: &str) -> f64 {
    if target.is_empty() || key.is_empty() {
        return 0.0;
    }
    if target == key {
        return 100.0;
    }
    if target.starts_with(key) || key.starts_with(target) {
        let (short, long) = if key.len() < target.len() {
            (key.len(), target.len())
        } else {
            (target.len(), key.len())
        };
        // 前缀命中：加长度比例，避免 "kimi-k2.6" 抢走 "kimi-k2.7-code-highspeed"
        return 55.0 + 35.0 * (short as f64 / long as f64);
    }
    let a = tokens(target);
    let b = tokens(key);
    let inter = a.intersection(&b).count() as f64;
    if inter == 0.0 {
        return 0.0;
    }
    let union = a.union(&b).count() as f64;
    let jaccard = inter / union;
    if jaccard >= 0.5 {
        30.0 * jaccard + 25.0 * (inter / b.len() as f64)
    } else {
        0.0
    }
}

fn keys_of(entry: &CatalogEntry) -> Vec<String> {
    let mut keys: Vec<String> = entry.r#match.clone();
    if keys.is_empty() && !entry.name.is_empty() {
        keys.push(entry.name.clone());
    }
    keys
}

fn provider_ok(entry: &CatalogEntry, provider: &str) -> bool {
    entry.providers.is_empty() || entry.providers.iter().any(|p| p == provider)
}

/// 收集所有「过时/已下线」（hidden）条目的匹配键（归一化后），用于识别历史 id
pub fn hidden_keys(entries: &[CatalogEntry]) -> HashSet<String> {
    entries
        .iter()
        .filter(|e| e.hidden)
        .flat_map(|e| e.r#match.iter())
        .map(|k| normalize(k))
        .filter(|k| !k.is_empty())
        .collect()
}

/// 该 model id 是否命中隐藏键：归一化后相等，或以 `-` 为词边界互为前缀。
/// 只用边界前缀、不做模糊打分——否则 `gpt-5` 这种键会借前缀/同词打分误伤 `gpt-5.5`、`gpt-5.6` 等在售新版本。
pub fn is_hidden(keys: &HashSet<String>, model_id: &str) -> bool {
    let n = normalize(model_id);
    if n.is_empty() {
        return false;
    }
    keys.iter()
        .any(|k| n == *k || n.starts_with(&format!("{k}-")) || k.starts_with(&format!("{n}-")))
}

/// 在资料库中找最匹配的条目，返回 (条目, 匹配质量)；hidden 条目只参与历史 id 识别，不出卡片
pub fn best_match<'a>(
    entries: &'a [CatalogEntry],
    provider: &str,
    model_id: &str,
) -> Option<(&'a CatalogEntry, String)> {
    let target = normalize(model_id);
    let mut best: Option<(&CatalogEntry, f64)> = None;
    for entry in entries {
        if entry.hidden || !provider_ok(entry, provider) {
            continue;
        }
        for key in keys_of(entry) {
            let s = score(&target, &normalize(&key));
            if s > 0.0 && best.map(|(_, bs)| s > bs).unwrap_or(true) {
                best = Some((entry, s));
            }
        }
    }
    best.and_then(|(entry, s)| {
        let quality = if s >= 95.0 {
            "exact"
        } else if s >= 45.0 {
            "fuzzy"
        } else {
            return None;
        };
        Some((entry, quality.to_string()))
    })
}

/// 该条资料的价格可信度：已核实 high / 有价未核实 medium / 无价格 none
fn price_confidence(price: &Option<crate::model::ModelPrice>, verified: bool) -> String {
    let has_price = price
        .as_ref()
        .map(|p| p.input.is_some() || p.output.is_some())
        .unwrap_or(false);
    if !has_price {
        "none".into()
    } else if verified {
        "high".into()
    } else {
        "medium".into()
    }
}

/// 把一个账户拉到的模型列表转换为模型卡片。
/// 本地覆盖（用户编辑过的条目）优先于内置资料库；
/// 命中 hidden 键的过时/已下线模型直接不出卡片（本地覆盖显式编辑过的除外）。
pub fn cards_for_account(
    provider: &str,
    account_id: &str,
    models: &[RemoteModel],
    catalog: &[CatalogEntry],
    overrides: &[CatalogEntry],
) -> Vec<ModelCard> {
    let hidden: HashSet<String> = hidden_keys(catalog)
        .into_iter()
        .chain(hidden_keys(overrides))
        .collect();
    models
        .iter()
        .filter_map(|m| {
            let over_hit = best_match(overrides, provider, &m.id);
            let cat_hit = best_match(catalog, provider, &m.id);
            // 隐藏只在拿不到「精确」资料兜底时生效：`mimo-v2.5` 这种泛前缀键
            // 不能顺手带走有精确条目的 mimo-v2.5-asr / -tts；
            // 反过来，kimi-latest 这种只与可见条目模糊擦边的历史 id 也不能被放出来。
            let exact_over = over_hit.as_ref().is_some_and(|(_, q)| q == "exact");
            let exact_cat = cat_hit.as_ref().is_some_and(|(_, q)| q == "exact");
            if !exact_over && !exact_cat && is_hidden(&hidden, &m.id) {
                return None;
            }
            Some(match over_hit.or(cat_hit) {
                Some((entry, quality)) => ModelCard {
                    id: m.id.clone(),
                    name: if entry.name.is_empty() {
                        m.id.clone()
                    } else {
                        entry.name.clone()
                    },
                    vendor: entry.vendor.clone(),
                    summary: entry.summary.clone(),
                    context: entry.context.or(m.input_limit),
                    max_output: entry.max_output.or(m.output_limit),
                    price: entry.price.clone(),
                    abilities: entry.abilities.clone(),
                    verified: entry.verified,
                    verified_at: entry.verified_at.clone(),
                    source: entry.source.clone(),
                    edited: entry.edited,
                    price_confidence: price_confidence(&entry.price, entry.verified),
                    match_quality: quality,
                    owned_by: m.owned_by.clone(),
                    created: m.created,
                    account_ids: vec![account_id.to_string()],
                    hidden: false,
                },
                None => ModelCard {
                    id: m.id.clone(),
                    name: m
                        .description
                        .clone()
                        .filter(|d| !d.is_empty())
                        .unwrap_or_else(|| m.id.clone()),
                    vendor: m.owned_by.clone().unwrap_or_default(),
                    summary: String::new(),
                    context: m.input_limit,
                    max_output: m.output_limit,
                    price: None,
                    abilities: Vec::new(),
                    verified: false,
                    verified_at: None,
                    source: None,
                    edited: false,
                    price_confidence: "none".into(),
                    match_quality: "none".into(),
                    owned_by: m.owned_by.clone(),
                    created: m.created,
                    account_ids: vec![account_id.to_string()],
                    hidden: false,
                },
            })
        })
        .collect()
}

/// 合并多个账户的模型卡片（同一个模型出现在多个账户时合并 account_ids）
pub fn merge_cards(mut cards: Vec<ModelCard>) -> Vec<ModelCard> {
    let mut out: Vec<ModelCard> = Vec::new();
    for card in cards.drain(..) {
        if let Some(existing) = out.iter_mut().find(|c| normalize(&c.id) == normalize(&card.id)) {
            for acc in card.account_ids {
                if !existing.account_ids.contains(&acc) {
                    existing.account_ids.push(acc);
                }
            }
            // 有资料的一方覆盖占位信息
            if existing.summary.is_empty() && !card.summary.is_empty() {
                existing.name = card.name.clone();
                existing.vendor = card.vendor.clone();
                existing.summary = card.summary.clone();
                existing.context = existing.context.or(card.context);
                existing.max_output = existing.max_output.or(card.max_output);
                existing.price = card.price.clone();
                existing.abilities = card.abilities.clone();
                existing.verified = card.verified;
                existing.verified_at = card.verified_at.clone();
                existing.source = card.source.clone();
                existing.price_confidence = card.price_confidence.clone();
                existing.match_quality = card.match_quality.clone();
            }
        } else {
            out.push(card);
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}
