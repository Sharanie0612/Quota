//! Published ECI plus configuration-consistent, difficulty-calibrated scenarios.
//! Reads public data only; never extracts files or executes downloaded code.
use super::*;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read},
};

pub const URL: &str = "https://epoch.ai/data/benchmark_data.zip";
pub const SITE: &str = "https://epoch.ai/eci";

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub sha256: String,
    pub checked_at: String,
    pub models: Vec<Model>,
    pub curves: Vec<Curve>,
    pub records: Vec<Record>,
    pub conflicts_excluded: usize,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub release_date: String,
    pub score: f64,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub benchmark_count: usize,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Curve {
    pub name: String,
    pub difficulty: f64,
    pub slope: f64,
    pub baseline: f64,
    pub ceiling: f64,
    pub superseded_by: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub model_id: String,
    pub configuration: String,
    pub benchmark: String,
    pub raw: f64,
    pub normalized: f64,
    pub evaluator: String,
    pub url: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub version: String,
    pub minimum_benchmarks: usize,
    pub domains: Vec<Domain>,
    pub tier_thresholds: BTreeMap<String, f64>,
}
#[derive(Deserialize)]
pub struct Domain {
    pub id: String,
    pub name: String,
    pub benchmarks: Vec<String>,
}
pub fn policy() -> Policy {
    serde_json::from_str(include_str!("../../data/benchmark-policy.json")).expect("scenario policy")
}

type Row = BTreeMap<String, String>;
fn table(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
    required: &[&str],
) -> Result<Vec<Row>, String> {
    let file = archive
        .by_name(name)
        .map_err(|_| format!("Epoch 缺少 {name}"))?;
    if file.size() > 4 * 1024 * 1024 {
        return Err("Epoch 单表超过读取上限".into());
    }
    let mut text = String::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_string(&mut text)
        .map_err(|_| "Epoch 表格读取或 CRC 校验失败")?;
    let parsed =
        super::adapters::csv_limited(text.trim_start_matches('\u{feff}'), 30000, 128, 64000)?;
    let header = parsed.first().ok_or("Epoch 空表")?;
    if required.iter().any(|key| !header.iter().any(|h| h == key))
        || header.iter().collect::<BTreeSet<_>>().len() != header.len()
    {
        return Err(format!("Epoch {name} 表头变化"));
    }
    parsed
        .iter()
        .skip(1)
        .filter(|row| row.iter().any(|s| !s.is_empty()))
        .map(|row| {
            if row.len() != header.len() {
                return Err(format!("Epoch {name} 列数变化"));
            }
            Ok(header.iter().cloned().zip(row.iter().cloned()).collect())
        })
        .collect()
}
fn number(row: &Row, key: &str) -> Result<f64, String> {
    row.get(key)
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .ok_or_else(|| format!("Epoch {key} 数值无效"))
}

pub fn parse(bytes: &[u8], checked: &str) -> Result<Snapshot, String> {
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Epoch 下载超过上限".into());
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Epoch 公开数据包格式变化")?;
    if archive.len() > 256
        || archive
            .decompressed_size()
            .is_none_or(|size| size > 128 * 1024 * 1024)
    {
        return Err("Epoch 数据包展开超过上限".into());
    }
    let published = table(
        &mut archive,
        "epoch_capabilities_index/eci_scores.csv",
        &[
            "Model",
            "Display name",
            "eci",
            "eci_ci_low",
            "eci_ci_high",
            "date",
            "Organization",
        ],
    )?;
    let metadata = table(
        &mut archive,
        "benchmark_metadata.csv",
        &[
            "benchmark",
            "in_eci",
            "source_file",
            "score_column",
            "scale",
            "random_baseline",
            "score_ceiling",
            "superseded_by",
        ],
    )?;
    let parameters = table(
        &mut archive,
        "epoch_capabilities_index/edi_scores.csv",
        &["benchmark_name", "edi", "estimated_slope_scaled"],
    )?;
    let versions = table(
        &mut archive,
        "model_metadata.csv",
        &["model_version", "model_group"],
    )?;
    let processed = table(
        &mut archive,
        "epoch_capabilities_index/processed_data_for_eci.csv",
        &["Model", "benchmark", "performance"],
    )?;
    let mut counts: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for row in processed {
        counts
            .entry(row["Model"].clone())
            .or_default()
            .insert(row["benchmark"].clone());
    }
    let mut models = Vec::new();
    let mut ids = BTreeMap::new();
    for row in published {
        let name = row["Model"].clone();
        let id = super::key(&name);
        if id.is_empty() || ids.insert(name.clone(), id.clone()).is_some() {
            return Err("Epoch 重复型号".into());
        }
        let lower = if row["eci_ci_low"].is_empty() {
            None
        } else {
            Some(number(&row, "eci_ci_low")?)
        };
        let upper = if row["eci_ci_high"].is_empty() {
            None
        } else {
            Some(number(&row, "eci_ci_high")?)
        };
        models.push(Model {
            id,
            name,
            vendor: row["Organization"].clone(),
            release_date: row["date"].clone(),
            score: number(&row, "eci")?,
            lower,
            upper,
            benchmark_count: counts.get(&row["Model"]).map_or(0, BTreeSet::len),
        });
    }
    if models.iter().map(|m| &m.id).collect::<BTreeSet<_>>().len() != models.len() {
        return Err("Epoch 型号标识冲突，等待明确适配".into());
    }
    let mut groups = BTreeMap::new();
    for row in versions {
        let version = row["model_version"].clone();
        if version.is_empty() {
            continue;
        }
        if let Some(old) = groups.insert(version, row["model_group"].clone()) {
            if old != row["model_group"] {
                return Err("Epoch 配置归属冲突".into());
            }
        }
    }
    let configs: BTreeMap<_, _> = metadata
        .iter()
        .filter(|r| r["in_eci"] == "True")
        .map(|r| (r["benchmark"].clone(), r))
        .collect();
    let mut curves = Vec::new();
    let mut records: BTreeMap<(String, String, String), Record> = BTreeMap::new();
    let mut conflicts = BTreeSet::new();
    for row in parameters {
        let name = &row["benchmark_name"];
        let cfg = configs.get(name).ok_or("Epoch 难度参数缺少元数据")?;
        let curve = Curve {
            name: name.clone(),
            difficulty: number(&row, "edi")?,
            slope: number(&row, "estimated_slope_scaled")?,
            baseline: number(cfg, "random_baseline")?,
            ceiling: number(cfg, "score_ceiling")?,
            superseded_by: cfg["superseded_by"].clone(),
        };
        let scale = number(cfg, "scale")?;
        if scale <= 0. || curve.ceiling <= curve.baseline {
            return Err("Epoch 单位或基线变化".into());
        }
        let filename = &cfg["source_file"];
        if !filename.ends_with(".csv") || filename.contains('/') || filename.contains('\\') {
            return Err("Epoch 来源文件名变化".into());
        }
        let score_column = &cfg["score_column"];
        let rows = table(&mut archive, filename, &["Model version", score_column])?;
        for record in rows {
            let configuration = &record["Model version"];
            let Some(model_id) = groups.get(configuration).and_then(|group| ids.get(group)) else {
                continue;
            };
            let Some(raw) = record[score_column]
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite())
            else {
                continue;
            };
            let raw = raw * scale;
            let value = Record {
                model_id: model_id.clone(),
                configuration: configuration.clone(),
                benchmark: name.clone(),
                raw,
                normalized: ((raw - curve.baseline) / (curve.ceiling - curve.baseline))
                    .clamp(0., 1.),
                evaluator: record
                    .get("Source")
                    .filter(|s| !s.is_empty())
                    .cloned()
                    .unwrap_or_else(|| {
                        if filename.ends_with("_external.csv") {
                            "外部公开报告（Epoch 收录）".into()
                        } else {
                            "Epoch AI 实测".into()
                        }
                    }),
                url: record
                    .get("Source link")
                    .or_else(|| record.get("Source"))
                    .filter(|s| s.starts_with("https://") && s.len() < 2000)
                    .cloned()
                    .unwrap_or_else(|| "https://epoch.ai/benchmarks".into()),
            };
            let identifier = (model_id.clone(), configuration.clone(), name.clone());
            if records
                .get(&identifier)
                .is_some_and(|old| (old.raw - raw).abs() > 1e-10)
            {
                conflicts.insert(identifier.clone());
            }
            records.insert(identifier, value);
        }
        curves.push(curve);
    }
    for identifier in &conflicts {
        records.remove(identifier);
    }
    let replacements: BTreeMap<_, _> = curves
        .iter()
        .map(|c| (c.name.clone(), c.superseded_by.clone()))
        .collect();
    let superseded: Vec<_> = records
        .keys()
        .filter(|(id, config, name)| {
            replacements.get(name).is_some_and(|new| {
                !new.is_empty() && records.contains_key(&(id.clone(), config.clone(), new.clone()))
            })
        })
        .cloned()
        .collect();
    for identifier in superseded {
        records.remove(&identifier);
    }
    let snapshot = Snapshot {
        sha256: format!("{:x}", Sha256::digest(bytes)),
        checked_at: checked.into(),
        models,
        curves,
        records: records.into_values().collect(),
        conflicts_excluded: conflicts.len(),
    };
    if !snapshot.valid() {
        return Err("Epoch 数据完整性校验失败，保留上次记录".into());
    }
    Ok(snapshot)
}
impl Snapshot {
    pub fn valid(&self) -> bool {
        let models: BTreeSet<_> = self.models.iter().map(|m| m.id.as_str()).collect();
        let curves: BTreeSet<_> = self.curves.iter().map(|c| c.name.as_str()).collect();
        self.sha256.len() == 64
            && self.sha256.bytes().all(|c| c.is_ascii_hexdigit())
            && chrono::DateTime::parse_from_rfc3339(&self.checked_at).is_ok()
            && (50..=2000).contains(&self.models.len())
            && models.len() == self.models.len()
            && (20..=200).contains(&self.curves.len())
            && curves.len() == self.curves.len()
            && (100..=30000).contains(&self.records.len())
            && self
                .records
                .iter()
                .map(|r| (&r.model_id, &r.configuration, &r.benchmark))
                .collect::<BTreeSet<_>>()
                .len()
                == self.records.len()
            && self.models.iter().all(|m| {
                !m.id.is_empty()
                    && m.id.len() <= 200
                    && m.name.len() <= 200
                    && m.score.is_finite()
                    && (0. ..=250.).contains(&m.score)
                    && m.benchmark_count >= 4
                    && match (m.lower, m.upper) {
                        (Some(lo), Some(hi)) => {
                            lo.is_finite() && hi.is_finite() && lo <= m.score && hi >= m.score
                        }
                        (None, None) => true,
                        _ => false,
                    }
            })
            && self.curves.iter().all(|c| {
                c.difficulty.is_finite()
                    && c.slope.is_finite()
                    && c.slope > 0.
                    && c.slope < 10.
                    && c.baseline.is_finite()
                    && c.ceiling.is_finite()
                    && c.ceiling > c.baseline
            })
            && self.records.iter().all(|r| {
                models.contains(r.model_id.as_str())
                    && curves.contains(r.benchmark.as_str())
                    && !r.configuration.is_empty()
                    && r.configuration.len() < 200
                    && r.raw.is_finite()
                    && r.normalized.is_finite()
                    && (0. ..=1.).contains(&r.normalized)
                    && r.url.starts_with("https://")
            })
    }
}

fn loss(c: f64, records: &[&Record], curves: &BTreeMap<&str, &Curve>) -> f64 {
    records
        .iter()
        .map(|r| {
            let curve = curves[r.benchmark.as_str()];
            let p = 1. / (1. + (-curve.slope * (c - curve.difficulty)).exp());
            (p - r.normalized).powi(2)
        })
        .sum::<f64>()
        / records.len() as f64
}
/// Global coarse scan and refinement of *every* local minimum. Squared
/// sigmoid errors are not assumed convex. Boundary optima are unidentifiable.
pub fn fit(records: &[&Record], curves: &BTreeMap<&str, &Curve>) -> Option<(f64, f64)> {
    if records.is_empty() {
        return None;
    }
    let grid: Vec<_> = (0..=250).map(|c| loss(c as f64, records, curves)).collect();
    let mut best = if grid[0] < grid[250] {
        (0., grid[0])
    } else {
        (250., grid[250])
    };
    for i in 1..250 {
        if grid[i] > grid[i - 1] || grid[i] > grid[i + 1] {
            continue;
        }
        let (mut lo, mut hi) = (i as f64 - 1., i as f64 + 1.);
        for _ in 0..50 {
            let a = hi - (hi - lo) * 0.6180339887498949;
            let b = lo + (hi - lo) * 0.6180339887498949;
            if loss(a, records, curves) <= loss(b, records, curves) {
                hi = b;
            } else {
                lo = a;
            }
        }
        let c = (lo + hi) / 2.;
        let value = loss(c, records, curves);
        if value < best.1 {
            best = (c, value);
        }
    }
    (best.0 > 0.001 && best.0 < 249.999).then_some((best.0, best.1.sqrt()))
}
fn effort(config: &str) -> u8 {
    match config.rsplit('_').next().unwrap_or("") {
        "max" => 7,
        "xhigh" => 6,
        "high" => 5,
        "medium" => 4,
        "reasoning" => 3,
        "low" => 2,
        "none" => 1,
        _ => 0,
    }
}
fn component(r: &Record, curve: &Curve) -> Component {
    Component {
        metric: r.benchmark.clone(),
        value: r.raw * 100.,
        unit: "percent".into(),
        weight: None,
        normalized: Some(r.normalized * 100.),
        configuration: r.configuration.clone(),
        evaluator: r.evaluator.clone(),
        url: r.url.clone(),
        difficulty: Some(curve.difficulty),
        slope: Some(curve.slope),
    }
}
pub fn results(snapshot: &Snapshot) -> BTreeMap<String, Vec<SourceResult>> {
    let policy = policy();
    let used: BTreeSet<_> = policy
        .domains
        .iter()
        .flat_map(|d| d.benchmarks.iter().map(String::as_str))
        .collect();
    let curves: BTreeMap<_, _> = snapshot
        .curves
        .iter()
        .map(|c| (c.name.as_str(), c))
        .collect();
    let mut output = BTreeMap::new();
    for model in &snapshot.models {
        let mut configs: BTreeMap<&str, Vec<&Record>> = BTreeMap::new();
        for r in snapshot
            .records
            .iter()
            .filter(|r| r.model_id == model.id && used.contains(r.benchmark.as_str()))
        {
            configs.entry(&r.configuration).or_default().push(r);
        }
        // Choose by coverage, then declared effort, then ID — never scores.
        let chosen = configs.iter().min_by(|a, b| {
            b.1.len()
                .cmp(&a.1.len())
                .then_with(|| effort(b.0).cmp(&effort(a.0)))
                .then(a.0.cmp(b.0))
        });
        let mut results = vec![SourceResult {
            source_id: "epoch-ai".into(),
            version: format!("ECI · {}", &snapshot.sha256[..12]),
            profile_id: format!("epoch:{}:{}:general", &snapshot.sha256[..12], model.id),
            setting: "Epoch 发布综合 · 来源聚合配置".into(),
            score: model.score,
            coverage: 100.,
            components: chosen.map_or_else(Vec::new, |(_, rows)| {
                rows.iter()
                    .map(|r| component(r, curves[r.benchmark.as_str()]))
                    .collect()
            }),
            url: SITE.into(),
            lower: model.lower,
            upper: model.upper,
            range_kind: if model.lower.is_some() {
                "confidence90"
            } else {
                ""
            }
            .into(),
            benchmark_count: model.benchmark_count,
            kind: "general".into(),
            ..Default::default()
        }];
        if let Some((config, records)) = chosen {
            for domain in &policy.domains {
                let rows: Vec<_> = records
                    .iter()
                    .copied()
                    .filter(|r| domain.benchmarks.contains(&r.benchmark))
                    .collect();
                if rows.len() < policy.minimum_benchmarks {
                    continue;
                }
                let Some((score, error)) = fit(&rows, &curves) else {
                    continue;
                };
                let mut sensitivities = vec![score];
                if rows.len() >= 3 {
                    for i in 0..rows.len() {
                        let reduced: Vec<_> = rows
                            .iter()
                            .enumerate()
                            .filter(|(j, _)| *j != i)
                            .map(|(_, r)| *r)
                            .collect();
                        if let Some((c, _)) = fit(&reduced, &curves) {
                            sensitivities.push(c);
                        }
                    }
                }
                let bounded = rows.len() >= 3 && sensitivities.len() == rows.len() + 1;
                results.push(SourceResult {
                    source_id: "epoch-ai".into(),
                    version: format!("{} · {}", policy.version, &snapshot.sha256[..12]),
                    profile_id: format!(
                        "epoch:{}:{}:{}",
                        &snapshot.sha256[..12],
                        domain.id,
                        config
                    ),
                    setting: (*config).into(),
                    score,
                    coverage: rows.len() as f64 / domain.benchmarks.len() as f64 * 100.,
                    components: rows
                        .iter()
                        .map(|r| component(r, curves[r.benchmark.as_str()]))
                        .collect(),
                    url: SITE.into(),
                    lower: bounded
                        .then(|| sensitivities.iter().copied().fold(f64::INFINITY, f64::min)),
                    upper: bounded.then(|| {
                        sensitivities
                            .iter()
                            .copied()
                            .fold(f64::NEG_INFINITY, f64::max)
                    }),
                    range_kind: if bounded { "sensitivity" } else { "" }.into(),
                    benchmark_count: rows.len(),
                    calibration_error: Some(error),
                    kind: domain.id.clone(),
                });
            }
        }
        output.insert(model.id.clone(), results);
    }
    output
}
