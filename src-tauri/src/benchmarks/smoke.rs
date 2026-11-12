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
            if rows.len() != expected.len() || report["taskAxes"] != true {
                return Err(format!(
                    "模型配置或坐标口径不符：{} / {}",
                    rows.len(),
                    expected.len()
                ));
            }
            let mut seen = HashSet::new();
            for row in rows {
                let id = row["id"].as_str().ok_or("缺少配置标识")?;
                let model = expected.get(id).ok_or("未知测评配置")?;
                if !seen.insert(id)
                    || row["score"]
                        .as_f64()
                        .is_none_or(|score| (score - model.index).abs() > 1e-8)
                    || row["cost"].as_f64().zip(model.cost_per_task).is_some_and(
                        |(cost, expected)| (cost - expected).abs() > expected.abs() * 1e-10,
                    )
                    || row["cost"].as_f64().is_some() != model.cost_per_task.is_some()
                {
                    return Err(format!("{id} 的指数或单任务成本与快照不符"));
                }
                if model.cost_per_task.is_some() {
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
                        .is_none_or(|x| !(53. ..=width - 29.).contains(&x))
                        || row["y"]
                            .as_f64()
                            .is_none_or(|y| !(37. ..=height - 63.).contains(&y))
                    {
                        return Err("单任务成本与指数坐标越界".into());
                    }
                }
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
          const plot = document.querySelector('.task-cost-chart .scatter-panel > svg');
          if (!plot || plot.dataset.plotWidth === '1000' && plot.dataset.plotHeight === '440') return;
          const priced = [...plot.querySelectorAll('.scatter-point')].flatMap(element =>
            JSON.parse(element.dataset.members).map(point => ({
              ...point, width:Number(plot.dataset.plotWidth), height:Number(plot.dataset.plotHeight)
            }))
          );
          if (!priced.length) return;
          const unpriced = [...document.querySelectorAll('.task-cost-unpriced .ladder-score-row')].map(element => ({
            id:element.dataset.profileId, score:Number(element.dataset.score), cost:null
          }));
          report.all = [...priced, ...unpriced];
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
