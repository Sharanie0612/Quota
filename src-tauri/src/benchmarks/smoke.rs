//! Opt-in verification against the actual packaged WebView, in an empty isolated profile.
use crate::commands::AppState;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use tauri::{AppHandle, Manager, State, WebviewWindow};

fn enabled(state: &AppState) -> bool {
    std::env::var("QUOTA_BENCHMARK_SMOKE").as_deref() == Ok("1")
        && std::env::var_os("QUOTA_DATA_DIR")
            .is_some_and(|path| std::path::PathBuf::from(path).is_absolute())
        && state.config.lock().is_ok_and(|config| {
            config.accounts.is_empty()
                && !config.settings.auto_refresh
                && !config.settings.ladder_auto_update
        })
}

#[tauri::command]
pub fn benchmark_smoke_report(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    report: Value,
) -> Result<(), String> {
    if window.label() != "main" || !enabled(&state) {
        return Err("仅隔离界面验收可用".into());
    }
    let snapshot = state
        .task_cost
        .report()?
        .snapshot
        .ok_or("缺少隔离评测快照")?;
    let expected: BTreeMap<_, _> = snapshot
        .models
        .iter()
        .map(|model| (model.id.as_str(), model))
        .collect();
    let result =
        (|| -> Result<(), String> {
            let rows = report["all"].as_array().ok_or("缺少单任务成本和指数坐标")?;
            if report["taskAxes"] != true || report["usesClusters"] == true {
                return Err("模型图的坐标口径或标记不符".into());
            }

            let mut releases: BTreeMap<(String, String), Vec<_>> = BTreeMap::new();
            for model in expected.values() {
                releases
                    .entry((
                        model.creator.to_lowercase(),
                        model.model_name.to_lowercase(),
                    ))
                    .or_default()
                    .push(*model);
            }
            let mut dated: Vec<_> = releases
                .values()
                .filter_map(|family| {
                    family
                        .iter()
                        .filter_map(|model| model.release_date)
                        .min()
                        .map(|date| (date, family))
                })
                .collect();
            dated.sort_by_key(|(date, _)| std::cmp::Reverse(*date));
            let expected_count = dated.len().min(30);
            let cutoff = dated
                .get(expected_count.saturating_sub(1))
                .map(|(date, _)| *date);
            if rows.len() != expected_count
                || report["modelCount"].as_u64() != Some(expected_count as u64)
            {
                return Err(format!(
                    "默认型号数不符：{} / {}",
                    rows.len(),
                    expected_count
                ));
            }

            let mut seen = HashSet::new();
            let mut plotted = 0;
            for row in rows {
                let id = row["id"].as_str().ok_or("缺少配置标识")?;
                let model = expected.get(id).ok_or("未知测评配置")?;
                let family = &releases[&(
                    model.creator.to_lowercase(),
                    model.model_name.to_lowercase(),
                )];
                let date = family.iter().filter_map(|model| model.release_date).min();
                if !seen.insert((
                    model.creator.to_lowercase(),
                    model.model_name.to_lowercase(),
                )) || date
                    .zip(cutoff)
                    .is_none_or(|(release, limit)| release < limit)
                    || family.iter().any(|variant| {
                        (variant.cost_per_task.is_some() && model.cost_per_task.is_none())
                            || (variant.cost_per_task.is_some() == model.cost_per_task.is_some()
                                && variant.index > model.index)
                    })
                    || row["score"]
                        .as_f64()
                        .is_none_or(|score| (score - model.index).abs() > 1e-8)
                    || row["cost"].as_f64().zip(model.cost_per_task).is_some_and(
                        |(cost, expected)| (cost - expected).abs() > expected.abs() * 1e-10,
                    )
                    || row["cost"].as_f64().is_some() != model.cost_per_task.is_some()
                {
                    return Err(format!("{id} 的型号、日期、指数或成本与快照不符"));
                }
                if let Some(cost) = model.cost_per_task {
                    plotted += 1;
                    if row["plotScore"]
                        .as_f64()
                        .is_none_or(|score| (score - model.index).abs() > 1e-8)
                        || row["plotCost"]
                            .as_f64()
                            .is_none_or(|value| (value - cost).abs() > cost * 1e-10)
                    {
                        return Err(format!("{id} 的散点坐标数据与快照不符"));
                    }
                    let width = row["width"]
                        .as_f64()
                        .filter(|width| *width >= 500.)
                        .ok_or("绘图区过窄")?;
                    let height = row["height"]
                        .as_f64()
                        .filter(|height| *height >= 300.)
                        .ok_or("绘图区过矮")?;
                    if row["x"]
                        .as_f64()
                        .is_none_or(|x| !(51. ..=width - 23.).contains(&x))
                        || row["y"]
                            .as_f64()
                            .is_none_or(|y| !(39. ..=height - 60.).contains(&y))
                    {
                        return Err("单任务成本与指数坐标越界".into());
                    }
                }
            }
            if report["plotCount"].as_u64() != Some(plotted)
                || (plotted > 0 && report["labelCount"].as_u64().unwrap_or(0) == 0)
            {
                return Err("图中缺少独立型号点或名称".into());
            }
            if report["libraryRemoved"] != true || report["donutLegendsRemoved"] != true {
                return Err("产品页面结构不符".into());
            }
            let speed = crate::activity::speed::report(state.store.dir(), "", "codex", 7, "")?;
            let displayed = report["speed"].as_array().ok_or("缺少输出速度界面值")?;
            for (index, value) in [
                speed.summary.average,
                Some(speed.summary.samples as f64),
                speed.recent.first().map(|row| row.speed),
            ]
            .into_iter()
            .enumerate()
            {
                if let Some(value) = value {
                    if displayed
                        .get(index)
                        .and_then(Value::as_f64)
                        .is_none_or(|shown| (shown - value).abs() > 0.051)
                    {
                        return Err("输出速度界面与本机记录不符".into());
                    }
                }
            }
            Ok(())
        })();
    let payload = json!({
        "passed": result.is_ok(),
        "error": result.as_ref().err(),
        "version": crate::version::display_version(),
        "snapshotOrigin": snapshot.origin,
        "indexVersion": snapshot.index_version,
        "report": report,
    });
    crate::storage::write_atomic(
        &state.store.dir().join("benchmark-ui-check.json"),
        &payload.to_string(),
    )?;
    app.exit(if result.is_ok() { 0 } else { 1 });
    result
}

pub fn smoke_if_requested(app: AppHandle) {
    if !enabled(&app.state::<AppState>()) {
        return;
    }
    let script = r#"(() => {
      if (window.__quotaBenchmarkSmoke) return;
      window.__quotaBenchmarkSmoke = true;
      let step = 0, attempts = 0;
      const report = {};
      const go = name => document.querySelector('nav button[aria-label="' + name + '"]')?.click();
      const button = name => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === name);
      const send = () => window.dispatchEvent(new CustomEvent('quota-benchmark-smoke-report', {detail:report}));
      const timer = setInterval(() => {
        if (++attempts > 150) { clearInterval(timer); report.error = 'UI timeout, step ' + step; send(); return; }
        if (step === 0) { if (!document.querySelector('.task-cost-chart')) go('AI 模型'); step++; return; }
        if (step === 1) {
          const plot = document.querySelector('.task-cost-chart .task-scatter[data-measured="true"] > svg');
          if (!plot) return;
          const points = new Map([...plot.querySelectorAll('.task-plot-point')].map(element => [
            element.dataset.id, {
              x: Number(element.dataset.plotX), y: Number(element.dataset.plotY),
              plotScore: Number(element.dataset.score), plotCost: Number(element.dataset.cost),
              width: Number(plot.dataset.plotWidth), height: Number(plot.dataset.plotHeight)
            }
          ]));
          const rows = [...document.querySelectorAll('.task-models-list tbody tr')];
          if (!points.size || !rows.length) return;
          report.all = rows.map(element => ({
            id: element.dataset.profileId, score: Number(element.dataset.score),
            cost: element.dataset.cost === undefined ? null : Number(element.dataset.cost),
            ...points.get(element.dataset.profileId)
          }));
          report.modelCount = Number(document.querySelector('.task-comparison-status [role="status"]').dataset.selected);
          report.plotCount = points.size;
          report.labelCount = plot.querySelectorAll('.task-point-label').length;
          report.usesClusters = Boolean(plot.querySelector('.scatter-badge'));
          report.taskAxes = plot.textContent.includes('Intelligence Index') && plot.textContent.includes('单任务成本（USD · 对数刻度）');
          go('输出速度');
          step++;
          return;
        }
        if (step === 2) {
          const days = button('7天');
          if (!days) return;
          days.click();
          step++;
          return;
        }
        if (step === 3) {
          if (!document.querySelector('.speed-summary') || !document.querySelector('.speed-plot')) return;
          report.speed = ['.speed-average-value', '.speed-sample-value', '.speed-latest-value']
            .map(selector => Number(document.querySelector(selector).textContent.replaceAll(',', '')));
          report.libraryRemoved = !document.querySelector('nav button[aria-label="模型库"]');
          go('Token 活动');
          step++;
          return;
        }
        if (!document.querySelector('.activity-shares')) return;
        report.donutLegendsRemoved = !document.querySelector('.activity-share-legend') && !document.getElementById('activity-details');
        clearInterval(timer);
        send();
      }, 300);
    })()"#;
    tauri::async_runtime::spawn(async move {
        for _ in 0..22 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if app
                .state::<AppState>()
                .store
                .dir()
                .join("benchmark-ui-check.json")
                .exists()
            {
                break;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(script);
            }
        }
    });
}
