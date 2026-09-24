//! 模型价格比对与「价格可信度」。
//!
//! 价格是本项目里最容易过期、也最容易误导人的数据，所以这里不猜价格，而是把
//! 多个来源摆在一起让人核对：
//!   1. 内置/本地资料库 —— 人工核实过、带来源链接与核实时间；
//!   2. 官方定价页    —— 按平台的定价页 URL 实时抓取，抽出与价格相关的原文片段与候选数值；
//!   3. 第三方参考价  —— OpenRouter 的公开模型列表（不需要密钥），用同一模型的聚合价格为旁证。
//!
//! 可信度由「来源数量 + 是否核实 + 各来源是否一致」推出来，而不是靠单点数据。

use crate::catalog;
use crate::model::{ModelPrice, PriceComparison, PriceSource};
use chrono::Local;

const PRICE_KEYWORDS: [&str; 14] = [
    "输入", "输出", "价格", "计费", "单价", "每百万", "百万", "1m", "input", "output", "price",
    "pricing", "token", "cache",
];

/// 把定价页 HTML 变成便于检索的纯文本行
pub fn html_to_lines(html: &str) -> Vec<String> {
    let mut text = String::with_capacity(html.len());
    let bytes: Vec<char> = html.chars().collect();
    let mut i = 0usize;
    // Some(tag)：正在跳过 <script>…</script> 这类整段内容
    let mut skip_until: Option<String> = None;

    while i < bytes.len() {
        if let Some(tag) = skip_until.clone() {
            if starts_with_ci(&bytes[i..], &format!("</{tag}")) {
                // 跳过整个结束标签，避免把 "/script>" 当正文
                while i < bytes.len() && bytes[i] != '>' {
                    i += 1;
                }
                i += 1;
                skip_until = None;
            } else {
                i += 1;
            }
            continue;
        }
        if bytes[i] == '<' {
            // 整段跳过的标签：脚本、样式这些不是给人看的正文
            let mut skipping = false;
            for t in ["script", "style", "noscript", "svg"] {
                if starts_with_ci(&bytes[i..], &format!("<{t}")) {
                    skip_until = Some(t.to_string());
                    skipping = true;
                    break;
                }
            }
            if skipping {
                i += 1;
                continue;
            }
            // 块级标签换成换行，避免把两个单元格粘成一个数字
            let mut j = i + 1;
            let mut name = String::new();
            while j < bytes.len() && !bytes[j].is_whitespace() && bytes[j] != '>' {
                name.push(bytes[j]);
                j += 1;
            }
            let name = name.trim_start_matches('/').to_lowercase();
            // 表格按「行」换行，单元格之间留空格：这样 "输入 | ¥1.5 | 输出 | ¥6" 会落在同一行，
            // 便于按行抽价格；其余块级标签也换行，避免把两段文字粘成一句。
            if matches!(
                name.as_str(),
                "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "table"
                    | "section" | "article"
            ) {
                text.push('\n');
            } else {
                text.push(' ');
            }
            while i < bytes.len() && bytes[i] != '>' {
                i += 1;
            }
            i += 1;
            continue;
        }
        text.push(bytes[i]);
        i += 1;
    }

    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect()
}

fn starts_with_ci(haystack: &[char], needle: &str) -> bool {
    let n: Vec<char> = needle.chars().collect();
    if haystack.len() < n.len() {
        return false;
    }
    haystack
        .iter()
        .zip(n.iter())
        .all(|(a, b)| a.to_ascii_lowercase() == b.to_ascii_lowercase())
}

/// 从一行文本里抓出「金额」数字。
///
/// 刻意排除两类干扰：版本号片段（`kimi-k2.7`、`glm-4.6`、`gpt-4o`）和带字母单位的数量
/// （`1M tokens`、`128K`、`7B`），否则它们会混进价格候选里。货币符号后面的数字照常保留。
pub fn numbers_in(line: &str) -> Vec<f64> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;

    let currency = |c: char| matches!(c, '¥' | '￥' | '$' | '€');
    // 数字紧跟在标识符字符后面时，说明它是版本号的一部分
    let is_identifier = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.';

    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        if i > 0 && is_identifier(chars[i - 1]) && !currency(chars[i - 1]) {
            i += 1;
            continue;
        }

        let mut buf = String::new();
        while i < chars.len() {
            let d = chars[i];
            if d.is_ascii_digit() {
                buf.push(d);
                i += 1;
            } else if d == ',' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit() {
                i += 1; // 千分位分隔符
            } else if d == '.'
                && i + 1 < chars.len()
                && chars[i + 1].is_ascii_digit()
                && !buf.contains('.')
            {
                buf.push('.');
                i += 1;
            } else {
                break;
            }
        }

        // 数字后面直接跟字母（1M / 128K / 7B / 4o）时不当作金额
        let followed_by_letter = i < chars.len() && chars[i].is_ascii_alphabetic();
        if !followed_by_letter {
            if let Ok(v) = buf.parse::<f64>() {
                out.push(v);
            }
        }
    }
    out
}

fn currency_in(line: &str) -> Option<&'static str> {
    let lower = line.to_lowercase();
    if line.contains('¥') || line.contains('￥') || lower.contains("cny") || lower.contains("rmb")
        || line.contains("人民币") || line.contains("元")
    {
        return Some("CNY");
    }
    if line.contains('$') || lower.contains("usd") || lower.contains("美元") {
        return Some("USD");
    }
    None
}

fn line_is_price_relevant(line: &str) -> bool {
    let lower = line.to_lowercase();
    PRICE_KEYWORDS.iter().any(|k| lower.contains(k))
}

/// 一次定价页抓取的结果
pub struct PageScan {
    pub url: String,
    pub fetched_at: String,
    pub excerpts: Vec<String>,
    pub candidates: Vec<ModelPrice>,
    pub error: Option<String>,
}

/// 抓取官方定价页，抽出与价格相关的片段和候选数值。
/// 候选值只是「页面里出现的数字」，一定要人工对照原文后再采用。
pub async fn scan_pricing_page(
    client: &reqwest::Client,
    url: &str,
    hints: &[String],
) -> PageScan {
    let now = Local::now().to_rfc3339();
    let mut scan = PageScan {
        url: url.to_string(),
        fetched_at: now,
        excerpts: Vec::new(),
        candidates: Vec::new(),
        error: None,
    };

    if url.trim().is_empty() {
        scan.error = Some("该供应商还没有配置官方定价页链接。".into());
        return scan;
    }
    if !url.starts_with("http") {
        scan.error = Some("定价页链接需要以 http/https 开头。".into());
        return scan;
    }

    let resp = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            scan.error = Some(if e.is_timeout() {
                format!("抓取定价页超时：{url}")
            } else {
                format!("抓取定价页失败：{e}")
            });
            return scan;
        }
    };

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        scan.error = Some(format!(
            "定价页返回 HTTP {}（页面可能改版或需要登录）",
            status.as_u16()
        ));
        return scan;
    }

    let lines = if body.trim_start().starts_with('{') || body.trim_start().starts_with('[') {
        // 有些平台把定价表直接做成 JSON
        serde_json::to_string_pretty(&serde_json::from_str::<serde_json::Value>(&body).ok())
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    } else {
        html_to_lines(&body)
    };

    let hint_tokens: Vec<String> = hints
        .iter()
        .map(|h| catalog::normalize(h))
        .filter(|h| !h.is_empty())
        .collect();

    for line in lines.iter() {
        if line.len() > 400 {
            continue;
        }
        let lower = line.to_lowercase();
        let hit_model = hint_tokens.iter().any(|h| {
            let plain = h.replace('-', " ");
            lower.contains(h.as_str()) || lower.contains(&plain)
        });
        if !hit_model && !line_is_price_relevant(line) {
            continue;
        }
        let nums = numbers_in(line);
        if nums.is_empty() {
            continue;
        }
        if scan.excerpts.len() < 40 && (hit_model || line_is_price_relevant(line)) {
            scan.excerpts.push(line.clone());
        }
        if hit_model && nums.len() >= 2 && scan.candidates.len() < 12 {
            let currency = currency_in(line).unwrap_or("USD");
            scan.candidates.push(ModelPrice {
                currency: currency.into(),
                unit: if lower.contains("百万") || lower.contains("1m") || lower.contains("million")
                {
                    "每 1M tokens".into()
                } else {
                    "取自定价页原文".into()
                },
                input: Some(nums[0]),
                output: Some(nums[1]),
                note: Some(format!("定价页原文：{}", truncate(line, 160))),
            });
        }
    }

    if scan.excerpts.is_empty() {
        scan.error = Some(
            "页面抓取成功，但没有识别出价格相关文本（可能是前端渲染的页面或需要登录）。可以点「打开定价页」亲自核对。"
                .into(),
        );
    }
    scan
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max).collect();
        format!("{t}…")
    }
}

/// OpenRouter 公开模型列表里的一条价格记录
#[derive(Clone, Debug)]
pub struct RefPrice {
    pub id: String,
    pub name: String,
    pub input: Option<f64>,
    pub output: Option<f64>,
}

/// 拉取第三方参考价（OpenRouter 的公开模型列表，无需密钥）。
/// 返回的价格已换算成「每 1M tokens / USD」。
pub async fn fetch_reference(client: &reqwest::Client) -> Result<Vec<RefPrice>, String> {
    let resp = client
        .get("https://openrouter.ai/api/v1/models")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "第三方参考价接口超时（国内网络访问可能受限）。".to_string()
            } else {
                format!("拉取第三方参考价失败：{e}")
            }
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("第三方参考价接口返回 HTTP {}", status.as_u16()));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("第三方参考价返回解析失败：{e}"))?;

    let per_token_to_per_million = |v: Option<&serde_json::Value>| -> Option<f64> {
        let raw = match v? {
            serde_json::Value::String(s) => s.trim().parse::<f64>().ok()?,
            serde_json::Value::Number(n) => n.as_f64()?,
            _ => return None,
        };
        if raw <= 0.0 {
            return None;
        }
        Some(raw * 1_000_000.0)
    };

    let mut out = Vec::new();
    if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            let id = item.get("id").and_then(|x| x.as_str()).unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let pricing = item.get("pricing");
            out.push(RefPrice {
                id: id.to_string(),
                name: item
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or(id)
                    .to_string(),
                input: per_token_to_per_million(pricing.and_then(|p| p.get("prompt"))),
                output: per_token_to_per_million(pricing.and_then(|p| p.get("completion"))),
            });
        }
    }
    if out.is_empty() {
        return Err("第三方参考价接口没有返回任何模型。".into());
    }
    Ok(out)
}

/// 把第三方参考价按模型 id 归一化后建索引，便于按卡片匹配
pub fn index_reference(refs: &[RefPrice]) -> std::collections::HashMap<String, RefPrice> {
    let mut map = std::collections::HashMap::new();
    for r in refs {
        let key = catalog::normalize(&r.id);
        if key.is_empty() {
            continue;
        }
        // 同一归一化 id 有多条时保留价格更完整的一条
        map.entry(key)
            .and_modify(|e: &mut RefPrice| {
                if e.input.is_none() && r.input.is_some() {
                    *e = r.clone();
                }
            })
            .or_insert_with(|| r.clone());
    }
    map
}

fn within_tolerance(a: f64, b: f64) -> bool {
    let (hi, lo) = if a > b { (a, b) } else { (b, a) };
    if hi == 0.0 {
        return true;
    }
    (hi - lo) / hi <= 0.15
}

/// 计算可信度：来源越多、越一致，可信度越高
fn grade(sources: &[PriceSource]) -> (String, String) {
    let with_price: Vec<&PriceSource> = sources
        .iter()
        .filter(|s| s.input.is_some() || s.output.is_some())
        .collect();
    if with_price.is_empty() {
        return (
            "none".into(),
            "还没有任何来源给出价格，点「检索官方定价页」或手动填写后再采信。".into(),
        );
    }
    let trusted = with_price.iter().filter(|s| s.trusted).count();
    let agree = with_price.len() >= 2
        && with_price.iter().all(|s| {
            match (s.input, with_price[0].input) {
                (Some(x), Some(y)) => within_tolerance(x, y),
                _ => true,
            }
        });

    if with_price.len() >= 2 && agree {
        return (
            "high".into(),
            format!(
                "{} 个独立来源给出的价格一致（相差 <15%），可以放心参考。",
                with_price.len()
            ),
        );
    }
    if trusted >= 1 && with_price.len() >= 2 {
        return (
            "medium".into(),
            "多个来源都有价格，但数值差异较大，请以官方定价页为准。".into(),
        );
    }
    if trusted >= 1 {
        return (
            "medium".into(),
            "只有 1 个来源给出价格（已对照官网核实），建议再抓一次官方定价页交叉验证。".into(),
        );
    }
    (
        "low".into(),
        "价格来自非核实来源（页面抓取或本地手填），请对照官方定价页确认。".into(),
    )
}

/// 组装一次价格比对
pub fn build_comparison(
    model_id: &str,
    model_name: &str,
    provider: &str,
    catalog_price: Option<ModelPrice>,
    catalog_verified: bool,
    catalog_verified_at: Option<String>,
    catalog_source: Option<String>,
    page: Option<PageScan>,
    reference: Option<RefPrice>,
) -> PriceComparison {
    let mut sources: Vec<PriceSource> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut excerpts: Vec<String> = Vec::new();

    if let Some(p) = catalog_price.clone() {
        sources.push(PriceSource {
            name: if catalog_verified {
                "本地资料库（已核实）".into()
            } else {
                "本地资料库（未核实）".into()
            },
            kind: "catalog".into(),
            url: catalog_source.clone().unwrap_or_default(),
            currency: p.currency.clone(),
            unit: p.unit.clone(),
            input: p.input,
            output: p.output,
            note: p.note.clone(),
            fetched_at: catalog_verified_at.clone(),
            trusted: catalog_verified,
        });
    }

    if let Some(scan) = page {
        excerpts = scan.excerpts.clone();
        if let Some(err) = scan.error.clone() {
            warnings.push(err);
        }
        if let Some(p) = scan.candidates.first().cloned() {
            sources.push(PriceSource {
                name: "官方定价页（抓取）".into(),
                kind: "official_page".into(),
                url: scan.url.clone(),
                currency: p.currency,
                unit: p.unit,
                input: p.input,
                output: p.output,
                note: p.note,
                fetched_at: Some(scan.fetched_at.clone()),
                trusted: false,
            });
        }
    }

    if let Some(r) = reference {
        sources.push(PriceSource {
            name: format!("第三方参考价 · {}", r.name),
            kind: "reference".into(),
            url: format!("https://openrouter.ai/{}", r.id),
            currency: "USD".into(),
            unit: "每 1M tokens".into(),
            input: r.input,
            output: r.output,
            note: Some("OpenRouter 公开的聚合价格，仅作旁证，不一定等于官方直连价".into()),
            fetched_at: Some(Local::now().to_rfc3339()),
            trusted: false,
        });
    }

    let (confidence, confidence_reason) = grade(&sources);
    let suggested = sources
        .iter()
        .find(|s| s.kind == "official_page" && (s.input.is_some() || s.output.is_some()))
        .or_else(|| sources.iter().find(|s| s.trusted))
        .or_else(|| sources.first())
        .map(|s| ModelPrice {
            currency: s.currency.clone(),
            unit: s.unit.clone(),
            input: s.input,
            output: s.output,
            note: Some(format!("来自「{}」（{}）", s.name, s.url)),
        });

    PriceComparison {
        model_id: model_id.to_string(),
        model_name: model_name.to_string(),
        provider: provider.to_string(),
        sources,
        confidence,
        confidence_reason,
        excerpts,
        suggested,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_to_lines_drops_scripts_and_splits_blocks() {
        let html = "<html><head><style>.a{color:red}</style><script>var x=1;</script></head>\
                    <body><h1>定价</h1><table><tr><td>输入</td><td>$0.5</td></tr>\
                    <tr><td>输出</td><td>$2</td></tr></table></body></html>";
        let lines = html_to_lines(html);
        assert!(lines.iter().any(|l| l.contains("定价")));
        assert!(lines.iter().any(|l| l.contains("输入") && l.contains("$0.5")));
        assert!(lines.iter().any(|l| l.contains("输出") && l.contains("$2")));
        assert!(!lines.iter().any(|l| l.contains("var x")));
        assert!(!lines.iter().any(|l| l.contains("color:red")));
        // 结束标签本身不能变成正文
        assert!(!lines.iter().any(|l| l.contains("/script")));
        assert!(!lines.iter().any(|l| l.contains("/style")));
    }

    /// 端到端：从一份仿小米 MiMo 定价表里抽出候选价格
    #[test]
    fn scan_extracts_candidates_from_a_pricing_table() {
        let html = "<table>\
            <tr><td>mimo-v2.6-pro</td><td>输入（缓存未命中）</td><td>¥3.00</td><td>输出</td><td>¥6.00</td></tr>\
            <tr><td>mimo-v2.6-flash</td><td>输入（缓存未命中）</td><td>¥1.00</td><td>输出</td><td>¥2.00</td></tr>\
            </table>";
        let lines = html_to_lines(html);
        let pro = lines
            .iter()
            .find(|l| l.contains("mimo-v2.6-pro"))
            .expect("应能找到 pro 行");
        assert_eq!(numbers_in(pro).into_iter().take(2).collect::<Vec<_>>(), vec![3.0, 6.0]);
        let flash = lines
            .iter()
            .find(|l| l.contains("mimo-v2.6-flash"))
            .expect("应能找到 flash 行");
        assert_eq!(numbers_in(flash).into_iter().take(2).collect::<Vec<_>>(), vec![1.0, 2.0]);
        assert_eq!(currency_in(pro), Some("CNY"));
    }

    #[test]
    fn numbers_ignore_version_digits_but_keep_currency_amounts() {
        assert_eq!(numbers_in("glm-4.6 输入 ¥1.5 输出 ¥6"), vec![1.5, 6.0]);
        assert_eq!(numbers_in("kimi-k2.7-code 每 1M tokens ¥6.5"), vec![6.5]);
        assert_eq!(numbers_in("gpt-4o $2.50 美元"), vec![2.5]);
        assert_eq!(numbers_in("1,024.50"), vec![1024.5]);
        assert!(numbers_in("deepseek-v4-pro").is_empty());
        // 带字母单位的数量不是金额
        assert!(numbers_in("每 1M tokens").is_empty());
        assert!(numbers_in("上下文 128K").is_empty());
    }

    #[test]
    fn currency_detection() {
        assert_eq!(currency_in("输入 ¥1.5"), Some("CNY"));
        assert_eq!(currency_in("input $0.30"), Some("USD"));
        assert_eq!(currency_in("人民币 1.5 元"), Some("CNY"));
        assert_eq!(currency_in("输入 1.5"), None);
    }

    #[test]
    fn grading_prefers_agreeing_multiple_sources() {
        let a = PriceSource {
            name: "a".into(),
            kind: "catalog".into(),
            trusted: true,
            input: Some(1.0),
            output: Some(2.0),
            ..Default::default()
        };
        let mut b = a.clone();
        b.name = "b".into();
        b.kind = "official_page".into();
        b.trusted = false;
        b.input = Some(1.05);
        b.output = Some(2.02);

        let (c, _) = grade(&[a.clone(), b.clone()]);
        assert_eq!(c, "high");

        let mut far = b.clone();
        far.input = Some(9.0);
        let (c2, _) = grade(&[a.clone(), far]);
        assert_eq!(c2, "medium");

        let (c3, _) = grade(&[a]);
        assert_eq!(c3, "medium");

        let (c4, _) = grade(&[]);
        assert_eq!(c4, "none");
    }
}
