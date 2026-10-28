use super::*;
use serde_json::Value;
use std::collections::BTreeSet;
const AA: &str = "https://artificialanalysis.ai/leaderboards/models";

fn metric(key: &str) -> Option<(&'static str, &'static str, &'static str, f64)> {
    Some(match key {
        "omniscience-accuracy" => (
            "knowledge",
            "omniscience-v1.1",
            "AA-Omniscience v1.1 · accuracy",
            2.,
        ),
        "omniscience-non-hallucination" => (
            "knowledge",
            "omniscience-v1.1",
            "AA-Omniscience v1.1 · non-hallucination",
            1.,
        ),
        "gdp-pdf" => ("knowledge", "gdp-pdf-v1", "GDP.pdf", 1.),
        "frontiercode-2-0" => ("coding", "frontiercode-v2", "FrontierCode 2.0", 1.),
        "terminalbench-4-0" => ("coding", "terminalbench-v4", "Terminal-Bench 4.0", 1.),
        "hle-diamond" => ("reasoning", "hle-diamond", "HLE-Diamond", 1.),
        "critpt-v2-hard" => ("research", "critpt-v2-hard", "CritPt v2 · hard subset", 1.),
        "terminal-bench-science" => (
            "research",
            "terminalbench-science-0.1",
            "Terminal-Bench-Science 0.1",
            1.,
        ),
        "automationbench-aa" => ("agents", "automationbench-aa", "AutomationBench-AA", 1.),
        "aa-briefcase" => ("agents", "aa-briefcase-v1.1", "AA-Briefcase v1.1", 1.),
        "mmmu-pro" => ("visual", "mmmu-pro", "MMMU-Pro", 1.),
        _ => return None,
    })
}
fn walk<'a>(value: &'a Value, models: &mut Vec<&'a Value>) {
    match value {
        Value::Object(object) => {
            if object.contains_key("intelligenceIndex")
                && object.contains_key("scores")
                && object.contains_key("modelCreatorName")
            {
                models.push(value)
            }
            for value in object.values() {
                walk(value, models)
            }
        }
        Value::Array(values) => {
            for value in values {
                walk(value, models)
            }
        }
        _ => {}
    }
}
fn current_index(value: &Value, versions: &mut BTreeSet<String>) {
    match value {
        Value::Object(object) => {
            if object.get("slug").and_then(Value::as_str)
                == Some("artificial-analysis-intelligence-index")
            {
                if let Some(name) = object.get("name").and_then(Value::as_str) {
                    versions.insert(name.into());
                }
            }
            for item in object.values() {
                current_index(item, versions);
            }
        }
        Value::Array(items) => {
            for item in items {
                current_index(item, versions);
            }
        }
        _ => {}
    }
}
pub fn parse_aa(html: &str, checked: &str) -> Result<Dataset, String> {
    if html.len() > 16 * 1024 * 1024 || !html.contains("Artificial Analysis") {
        return Err("AA 来源标识或大小变化".into());
    }
    let mut stream = String::new();
    for chunk in html.split("self.__next_f.push(").skip(1) {
        let Some((json, _)) = chunk.split_once(")</script>") else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<Value>(json) {
            if let Some(text) = value.get(1).and_then(Value::as_str) {
                stream.push_str(text);
            }
        }
    }
    let mut objects = Vec::new();
    let mut frames = Vec::new();
    for line in stream.lines() {
        let Some((id, body)) = line.split_once(':') else {
            continue;
        };
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(body) {
            frames.push(value);
        }
    }
    let mut versions = BTreeSet::new();
    for frame in &frames {
        current_index(frame, &mut versions);
    }
    if versions != BTreeSet::from(["Artificial Analysis Intelligence Index v5.0".into()]) {
        return Err("AA 指数版本变化，保留上次数据并等待适配".into());
    }
    for frame in &frames {
        walk(frame, &mut objects)
    }
    let mut observations = Vec::new();
    let mut profiles = Vec::new();
    let mut seen = BTreeSet::new();
    for model in objects {
        let Some(slug) = model["slug"].as_str() else {
            continue;
        };
        if !seen.insert(slug.to_string()) || model["deprecated"] == true {
            continue;
        }
        let (Some(name), Some(vendor), Some(scores)) = (
            model["name"].as_str(),
            model["modelCreatorName"].as_str(),
            model["scores"].as_object(),
        ) else {
            continue;
        };
        if name.len() > 200 || vendor.len() > 100 {
            continue;
        }
        let (model_name, setting) = split_configuration(name);
        let model_id = identity(model_name);
        if model_id.is_empty() || model_id.len() > 160 {
            continue;
        }
        for (key, value) in scores {
            let Some((domain, family, label, weight)) = metric(key) else {
                continue;
            };
            let Some(raw) = value.as_f64().filter(|v| v.is_finite()) else {
                continue;
            };
            let (value, unit) = if key == "aa-briefcase" {
                if !(0. ..=5000.).contains(&raw) {
                    continue;
                }
                (raw, "Elo")
            } else {
                if !(0. ..=1.).contains(&raw) {
                    continue;
                }
                (raw * 100., "percent")
            };
            observations.push(Observation {
                profile_id: slug.into(),
                model_id: model_id.clone(),
                model_name: model_name.into(),
                vendor: vendor.into(),
                source_id: "artificial-analysis".into(),
                metric: label.into(),
                family: family.into(),
                version: family.into(),
                domain: domain.into(),
                setting: if setting.is_empty() {
                    "平台公开设置".into()
                } else {
                    setting.into()
                },
                value,
                unit: unit.into(),
                weight,
                official: false,
                url: AA.into(),
                checked_at: checked.into(),
            });
        }
        if model["intelligenceIndexIsEstimated"] != true {
            if let Some(index) = model["intelligenceIndex"]
                .as_f64()
                .filter(|v| v.is_finite() && (0. ..=100.).contains(v))
            {
                let number = |key: &str| model[key].as_f64().filter(|v| v.is_finite() && *v >= 0.);
                // Only v5-complete profiles can share the v5 cost/quality plot.
                if ["frontiercode-2-0", "hle-diamond", "critpt-v2-hard"]
                    .iter()
                    .all(|key| scores.get(*key).and_then(Value::as_f64).is_some())
                {
                    profiles.push(Profile {
                        id: slug.into(),
                        model_id: model_id.clone(),
                        name: name.into(),
                        vendor: vendor.into(),
                        setting: if setting.is_empty() {
                            "平台公开设置".into()
                        } else {
                            setting.into()
                        },
                        index,
                        cost: number("intelligenceIndexCostPerTask"),
                        speed: number("medianOutputTokensPerSecond"),
                        latency: number("medianTimeToFirstTokenSeconds"),
                        source_id: "artificial-analysis".into(),
                        version: "Intelligence Index v5".into(),
                    });
                }
            }
        }
    }
    if observations.len() < 50 || profiles.len() < 5 {
        return Err("AA v5 分项结构变化，保留上次数据".into());
    }
    let source = Source {
        weights: BTreeMap::new(),
        id: "artificial-analysis".into(),
        name: "Artificial Analysis".into(),
        url: AA.into(),
        version: "Intelligence Index v5 / additional evaluations".into(),
        checked_at: checked.into(),
        records: observations.len(),
        error: None,
        automatic: true,
    };
    Ok(Dataset {
        schema: 2,
        sources: vec![source],
        observations,
        profiles,
    })
}
pub fn livebench_releases(js: &str) -> Vec<String> {
    // Read compact release IDs from published literal arrays, never execute JS.
    let mut out = BTreeSet::new();
    for tail in js.split("[\"20").skip(1) {
        let Some(end) = tail.find(']') else { continue };
        if end > 4000 {
            continue;
        }
        let array = format!("[\"20{}]", &tail[..end]);
        if let Ok(values) = serde_json::from_str::<Vec<String>>(&array) {
            if values
                .iter()
                .all(|v| v.len() == 8 && v.bytes().all(|c| c.is_ascii_digit()))
            {
                for value in values {
                    if chrono::NaiveDate::parse_from_str(&value, "%Y%m%d")
                        .is_ok_and(|date| date <= chrono::Utc::now().date_naive())
                    {
                        out.insert(value);
                    }
                }
            }
        }
    }
    out.into_iter().collect()
}
fn csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => row.push(std::mem::take(&mut cell)),
            '\n' if !quoted => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            '\r' if !quoted => {}
            _ => cell.push(c),
        }
        if rows.len() > 1000 || row.len() > 50 || cell.len() > 4000 {
            return Err("LiveBench 表格超过上限".into());
        }
    }
    if quoted {
        return Err("LiveBench CSV 引号不完整".into());
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row)
    }
    Ok(rows)
}
pub fn parse_livebench(
    table: &str,
    categories: &str,
    release: &str,
    checked: &str,
) -> Result<Dataset, String> {
    if release.len() != 8 || chrono::NaiveDate::parse_from_str(release, "%Y%m%d").is_err() {
        return Err("LiveBench 版本无效".into());
    }
    let categories: Value =
        serde_json::from_str(categories).map_err(|_| "LiveBench 类别格式变化")?;
    let defs = [
        ("long_agentic", "Long Agentic", "agents"),
        ("reasoning", "Reasoning", "reasoning"),
        ("coding", "Coding", "coding"),
        ("browser", "Browser", "agents"),
        ("data_analysis", "Data Analysis", "knowledge"),
        ("research", "Research", "research"),
        ("design", "Design", "visual"),
    ];
    for (key, label, _) in defs {
        if categories[label]
            .as_array()
            .is_none_or(|v| v != &vec![Value::String(key.into())])
        {
            return Err("LiveBench 2.0 类别定义变化".into());
        }
    }
    let declared = categories.get("_overall_weights").filter(|v| !v.is_null());
    if declared.is_some_and(|v| !v.is_object()) {
        return Err("LiveBench 权重格式变化".into());
    }
    let mut weights = BTreeMap::new();
    for (_, label, _) in defs {
        let weight = declared
            .and_then(|v| v.get(label))
            .map(|v| {
                v.as_f64()
                    .filter(|w| w.is_finite() && *w > 0. && *w <= 100.)
                    .ok_or("LiveBench 权重无效")
            })
            .transpose()?
            .unwrap_or(1.);
        weights.insert(format!("LiveBench {label}"), weight);
    }
    if declared
        .and_then(Value::as_object)
        .is_some_and(|m| m.keys().any(|label| !defs.iter().any(|d| d.1 == label)))
    {
        return Err("LiveBench 权重对应未知类别".into());
    }
    let rows = csv(table)?;
    let header = rows.first().ok_or("LiveBench 表格为空")?;
    if header
        != &vec![
            "model",
            "long_agentic",
            "reasoning",
            "coding",
            "browser",
            "data_analysis",
            "research",
            "design",
        ]
    {
        return Err("LiveBench 2.0 表头变化".into());
    }
    let mut observations = Vec::new();
    let mut seen = BTreeSet::new();
    for row in rows.iter().skip(1) {
        if row.iter().all(String::is_empty) {
            continue;
        }
        if row.len() > header.len() || row.is_empty() {
            return Err("LiveBench 行结构变化".into());
        }
        let name = &row[0];
        let id = identity(name);
        if name.len() > 200 || id.is_empty() || !seen.insert(id.clone()) {
            return Err("LiveBench 型号重复或无效".into());
        }
        for (index, (_, label, domain)) in defs.iter().enumerate() {
            let Some(value) = row
                .get(index + 1)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty() && *s != "n/a")
            else {
                continue;
            };
            let value = value
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite() && (0. ..=100.).contains(v))
                .ok_or("LiveBench 成绩无效")?;
            observations.push(Observation {
                profile_id: format!("livebench:{release}:{id}"),
                model_id: id.clone(),
                model_name: name.clone(),
                vendor: String::new(),
                source_id: "livebench".into(),
                metric: format!("LiveBench {label}"),
                family: format!("livebench-{release}-{}", defs[index].0),
                version: release.into(),
                domain: (*domain).into(),
                setting: "平台公开配置".into(),
                value,
                unit: "percent".into(),
                weight: weights[&format!("LiveBench {label}")],
                official: false,
                url: format!("https://livebench.ai/data/{release}/table.csv"),
                checked_at: checked.into(),
            });
        }
    }
    if observations.len() < 35 {
        return Err("LiveBench 成绩不完整".into());
    }
    Ok(Dataset {
        schema: 2,
        sources: vec![Source {
            weights,
            id: "livebench".into(),
            name: "LiveBench".into(),
            url: "https://livebench.ai/".into(),
            version: format!("LiveBench 2.0 · {release}"),
            checked_at: checked.into(),
            records: observations.len(),
            error: None,
            automatic: true,
        }],
        observations,
        profiles: vec![],
    })
}
