//! 余额历史：每次刷新拿到余额就往 balance_history.json 追加一条记录，
//! 用于画趋势线、估算「按当前消耗速度还能用多少天」，并识别疑似充值事件。
//! 只存时间戳与数值，不含任何凭据或请求细节。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::storage::write_atomic;

/// 单账户最多保留的天数与条数，防止历史文件无限增长
const MAX_AGE_DAYS: i64 = 90;
const MAX_POINTS: usize = 2000;
/// 相距不足 5 分钟的记录合并为一条（连续保存手动余额时不会堆积）
const MERGE_WINDOW_SECS: i64 = 300;
/// 拟合消耗速度用的样本窗口
const TREND_WINDOW_DAYS: i64 = 7;
/// 拟合至少需要这么多条样本，且跨度至少 4 小时，否则不猜
const TREND_MIN_POINTS: usize = 3;
const TREND_MIN_SPAN_SECS: i64 = 4 * 3600;
/// 余额比上一条记录上涨超过 max(5, 15%) 时视为疑似充值（宁可漏报不误报）
const RECHARGE_MIN_ABS: f64 = 5.0;
/// 给前端 sparkline 的最多点数（超出就均匀抽样）
const CHART_MAX_POINTS: usize = 120;

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    /// Unix 时间戳（秒）
    pub t: i64,
    /// 余额
    pub v: f64,
}

/// 给前端的单账户趋势数据
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountTrend {
    /// 最近 30 天的采样点（画迷你折线）
    pub points: Vec<HistoryPoint>,
    /// 最近 7 天拟合出的日均消耗（正数 = 在消耗；None = 样本不足）
    pub daily_burn: Option<f64>,
    /// 按当前速度估算的可用天数（当前余额 / 日均消耗）
    pub days_left: Option<f64>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    #[serde(default)]
    accounts: HashMap<String, Vec<HistoryPoint>>,
}

pub struct HistoryStore {
    path: PathBuf,
    data: HistoryFile,
}

impl HistoryStore {
    pub fn export_points(&self) -> HashMap<String, Vec<HistoryPoint>> {
        self.data.accounts.clone()
    }
    pub fn replace_points(&mut self, accounts: HashMap<String, Vec<HistoryPoint>>) -> Result<(), String> {
        let text = serde_json::to_string(&HistoryFile { accounts: accounts.clone() }).map_err(|_| "余额历史格式无效")?;
        write_atomic(&self.path, &text)?;
        self.data.accounts = accounts;
        Ok(())
    }
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("balance_history.json");
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<HistoryFile>(&text).ok())
            .unwrap_or_default();
        Self { path, data }
    }

    /// 追加一条余额记录。返回 Some(涨幅) 表示余额较上一条明显上涨，疑似刚充值。
    pub fn record(&mut self, account_id: &str, total: f64) -> Option<f64> {
        if !total.is_finite() {
            return None;
        }
        let now = chrono::Utc::now().timestamp();
        let mut recharged = None;
        {
            let points = self.data.accounts.entry(account_id.to_string()).or_default();
            let merged = matches!(points.last(), Some(last) if now - last.t <= MERGE_WINDOW_SECS);
            if merged {
                // 5 分钟内的连续记录合并为一条，保留最新值
                if let Some(last) = points.last_mut() {
                    let delta = total - last.v;
                    if delta >= recharge_threshold(last.v) {
                        recharged = Some(delta);
                    }
                    last.v = total;
                    last.t = now;
                }
            } else {
                if let Some(last) = points.last() {
                    let delta = total - last.v;
                    if delta >= recharge_threshold(last.v) {
                        recharged = Some(delta);
                    }
                }
                points.push(HistoryPoint { t: now, v: total });
            }
        }
        self.prune_and_save();
        recharged
    }

    /// 裁剪过期数据并落盘
    fn prune_and_save(&mut self) {
        let cutoff = chrono::Utc::now().timestamp() - MAX_AGE_DAYS * 86400;
        for points in self.data.accounts.values_mut() {
            points.retain(|p| p.t >= cutoff);
            if points.len() > MAX_POINTS {
                let drop = points.len() - MAX_POINTS;
                points.drain(0..drop);
            }
        }
        self.data.accounts.retain(|_, v| !v.is_empty());
        if let Err(e) = self.save() {
            eprintln!("[Quota] 保存余额历史失败：{e}");
        }
    }

    pub fn remove(&mut self, account_id: &str) {
        self.data.accounts.remove(account_id);
        let _ = self.save();
    }

    fn save(&self) -> Result<(), String> {
        let text = serde_json::to_string(&self.data).map_err(|e| format!("序列化历史失败：{e}"))?;
        write_atomic(&self.path, &text)
    }

    /// 单账户趋势：最近 30 天采样 + 最近 7 天线性拟合的日均消耗
    pub fn trend(&self, account_id: &str) -> Option<AccountTrend> {
        let points = self.data.accounts.get(account_id)?;
        if points.is_empty() {
            return None;
        }
        let now = chrono::Utc::now().timestamp();

        // sparkline 采样：最近 30 天，超出上限就均匀抽样
        let window_start = now - 30 * 86400;
        let recent: Vec<HistoryPoint> = points.iter().filter(|p| p.t >= window_start).copied().collect();
        let chart = sample(&recent, CHART_MAX_POINTS);

        // 拟合日均消耗：对窗口内 (t, v) 做最小二乘，斜率单位 元/秒
        let fit_start = now - TREND_WINDOW_DAYS * 86400;
        let fit: Vec<(f64, f64)> = points
            .iter()
            .filter(|p| p.t >= fit_start)
            .map(|p| (p.t as f64, p.v))
            .collect();
        let (daily_burn, days_left) = if fit.len() >= TREND_MIN_POINTS
            && fit.last().unwrap().0 - fit[0].0 >= TREND_MIN_SPAN_SECS as f64
        {
            let n = fit.len() as f64;
            let (mut sx, mut sy, mut sxx, mut sxy) = (0.0, 0.0, 0.0, 0.0);
            for (t, v) in &fit {
                sx += t;
                sy += v;
                sxx += t * t;
                sxy += t * v;
            }
            let denom = n * sxx - sx * sx;
            if denom.abs() > f64::EPSILON {
                let slope = (n * sxy - sx * sy) / denom; // 元/秒
                let burn = -slope * 86400.0; // 元/天
                if burn > 0.005 {
                    let left = fit.last().unwrap().1 / burn;
                    (Some(burn), Some(left.max(0.0)))
                } else {
                    (Some(0.0), None)
                }
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        Some(AccountTrend {
            points: chart,
            daily_burn,
            days_left,
        })
    }

    /// 全部账户的趋势（前端一次拿全）
    pub fn all_trends(&self) -> HashMap<String, AccountTrend> {
        self.data
            .accounts
            .keys()
            .filter_map(|id| self.trend(id).map(|t| (id.clone(), t)))
            .collect()
    }
}

fn recharge_threshold(prev: f64) -> f64 {
    (prev * 0.15).max(RECHARGE_MIN_ABS)
}

/// 均匀抽样到最多 max 个点（保留首尾）
fn sample(points: &[HistoryPoint], max: usize) -> Vec<HistoryPoint> {
    if points.len() <= max {
        return points.to_vec();
    }
    let step = (points.len() - 1) as f64 / (max - 1) as f64;
    (0..max)
        .map(|i| points[(i as f64 * step).round() as usize])
        .collect()
}
