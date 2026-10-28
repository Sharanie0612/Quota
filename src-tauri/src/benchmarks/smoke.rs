//! Isolated packaged-WebView verification: compare rendered scores to Rust output.
use super::*;
use serde_json::{json, Value};

fn enabled(state: &AppState) -> bool {
    std::env::var("QUOTA_BENCHMARK_SMOKE").ok().as_deref() == Some("1")
        && std::env::var_os("QUOTA_DATA_DIR")
            .is_some_and(|p| std::path::PathBuf::from(p).is_absolute())
        && state.config.lock().is_ok_and(|c| {
            c.accounts.is_empty() && !c.settings.auto_refresh && !c.settings.ladder_auto_update
        })
}
#[tauri::command]
pub fn benchmark_smoke_report(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    report: Value,
) -> Result<(), String> {
    if window.label() != "main" || !enabled(&state) {
        return Err("仅隔离界面验收可用".into());
    }
    let board = calculate(
        &*state
            .benchmarks
            .dataset
            .lock()
            .map_err(|_| "评测数据暂不可用")?,
    );
    let result = (|| -> Result<(), String> {
        for id in [
            "general",
            "coding",
            "reasoning",
            "agents",
            "knowledge",
            "aa",
            "livebench",
        ] {
            let expected = board
                .rankings
                .iter()
                .find(|r| r.id == id)
                .ok_or("缺少榜单")?;
            let rows = report["boards"][id]
                .as_array()
                .ok_or("界面未提供原始榜单")?;
            if rows.len() != expected.entries.len() {
                return Err(format!("{id} 界面型号数不符"));
            }
            for (actual, entry) in rows.iter().zip(&expected.entries) {
                let displayed = actual["score"]
                    .as_str()
                    .and_then(|s| s.parse::<f64>().ok())
                    .ok_or("界面分数格式错误")?;
                if actual["id"].as_str() != Some(&entry.model_id)
                    || actual["rank"].as_u64() != Some(entry.rank as u64)
                    || actual["profileId"].as_str() != Some(&entry.profile_id)
                    || (displayed - entry.score).abs() > 0.00501
                {
                    return Err(format!(
                        "{id} 的 {} 界面分数、名次或配置不符",
                        entry.model_id
                    ));
                }
                if let (Some(lower), Some(upper)) = (entry.lower, entry.upper) {
                    let range: Vec<_> = actual["range"]
                        .as_str()
                        .unwrap_or("")
                        .split('–')
                        .filter_map(|v| v.parse::<f64>().ok())
                        .collect();
                    if range.len() != 2
                        || (range[0] - lower).abs() > 0.00501
                        || (range[1] - upper).abs() > 0.00501
                        || actual["rangeKind"].as_str() != Some(entry.range_kind.as_str())
                    {
                        return Err(format!("{id} {} 的区间显示不符", entry.model_id));
                    }
                }
            }
        }
        Ok(())
    })();
    let payload = json!({"passed":result.is_ok(),"error":result.as_ref().err(),"version":crate::version::display_version(),"algorithm":board.algorithm,"boards":report["boards"],"kind":"packaged-webview-rendered-values"});
    crate::storage::write_atomic(
        &state.store.dir().join("benchmark-ui-check.json"),
        &payload.to_string(),
    )?;
    app.exit(if result.is_ok() { 0 } else { 1 });
    result
}
pub fn smoke_if_requested(app: tauri::AppHandle) {
    if !enabled(&app.state::<AppState>()) {
        return;
    }
    let script = r#"(()=>{if(window.__quotaBenchmarkSmoke)return;window.__quotaBenchmarkSmoke=true;let step=0;const ids=['general','coding','reasoning','agents','knowledge','aa','livebench'],boards={};const timer=setInterval(()=>{
      const id=ids[step],select=document.querySelector('button[data-benchmark-source="'+id+'"]');
      if(!select){document.querySelector('nav[aria-label="主导航"] button[aria-label="AI 模型"]')?.click();return;}
      if(select.getAttribute('aria-pressed')!=='true'){select.click();return;}
      const board=document.querySelector('.tier-board[data-ranking-id="'+id+'"]');if(!board)return;
      const expand=document.querySelector('button[data-expand-ladder]');if(expand){expand.click();return;}
      const rows=[...board.querySelectorAll('.tier-model')].map(el=>({id:el.dataset.modelId,rank:Number(el.dataset.rank),profileId:el.dataset.profileId||'',score:el.querySelector('.tier-model-score strong').textContent.trim(),range:el.querySelector('.tier-range-values')?.textContent.trim()||'',rangeKind:el.querySelector('.tier-model-range')?.dataset.rangeKind||''}));if(!rows.length)return;
      boards[id]=rows;step++;if(step===ids.length){clearInterval(timer);window.dispatchEvent(new CustomEvent('quota-benchmark-smoke-report',{detail:{boards}}));}
    },250);})()"#;
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
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(script);
            }
        }
        let state = app.state::<AppState>();
        let path = state.store.dir().join("benchmark-ui-check.json");
        if !path.exists() {
            let _ = crate::storage::write_atomic(
                &path,
                &json!({"passed":false,"error":"界面未在 45 秒内完成源站数值核对"}).to_string(),
            );
            app.exit(1);
        }
    });
}
