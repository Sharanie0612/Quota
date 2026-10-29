//! Opt-in verification against the actual packaged WebView, in an empty isolated profile.
use super::*;
use serde_json::{json,Value};
fn enabled(state:&AppState)->bool{
    std::env::var("QUOTA_BENCHMARK_SMOKE").ok().as_deref()==Some("1")
        && std::env::var_os("QUOTA_DATA_DIR").is_some_and(|p|std::path::PathBuf::from(p).is_absolute())
        && state.config.lock().is_ok_and(|c|c.accounts.is_empty()&&!c.settings.auto_refresh&&!c.settings.ladder_auto_update)
}
#[tauri::command]
pub fn benchmark_smoke_report(app:tauri::AppHandle,window:tauri::WebviewWindow,state:State<'_,AppState>,report:Value)->Result<(),String>{
    if window.label()!="main"||!enabled(&state){return Err("仅隔离界面验收可用".into())}
    let board=calculate(&*state.benchmarks.dataset.lock().map_err(|_|"测评暂不可用")?);
    let expected:std::collections::BTreeMap<_,_>=board.profiles.iter().filter(|p|p.source_id=="artificial-analysis").map(|p|(p.id.clone(),p)).collect();
    let result=(||->Result<(),String>{
        let all=report["all"].as_array().ok_or("未提供天梯坐标记录")?;
        if all.len()!=expected.len(){return Err(format!("天梯型号数不符：{} / {}",all.len(),expected.len()))}
        let mut seen=std::collections::BTreeSet::new();
        for row in all{
            let id=row["id"].as_str().ok_or("缺少配置标识")?;let profile=expected.get(id).ok_or("未知测评配置")?;
            if !seen.insert(id)||row["score"].as_f64().is_none_or(|score|(score-profile.index).abs()>0.000001){return Err(format!("{id} 分数或配置重复"))}
            if row["plotted"]==true && (row["width"].as_f64().is_none_or(|n|n<500.)||row["height"].as_f64().is_none_or(|n|n<300.)||row["x"].as_f64().is_none_or(|n|!n.is_finite()||n<61.||n>row["width"].as_f64().unwrap_or(0.)-37.)||row["y"].as_f64().is_none_or(|n|!n.is_finite()||n<43.||n>row["height"].as_f64().unwrap_or(0.)-79.)){return Err("价格与能力坐标越界".into())}
        }
        let today=chrono::Local::now().date_naive();let first=today-chrono::Days::new(29);
        let edition=board.sources.iter().find(|s|s.id=="artificial-analysis").and_then(|s|s.edition.as_ref()).ok_or("缺少测评更新时间来源")?;
        let fresh=chrono::NaiveDate::parse_from_str(&edition.published_at,"%Y-%m-%d").is_ok_and(|d|d>=first&&d<=today);
        let wanted:std::collections::BTreeSet<String>=expected.values().filter(|p|fresh&&p.version==edition.version).map(|p|p.id.clone()).collect();
        let recent:std::collections::BTreeSet<String>=report["recent"].as_array().ok_or("缺少近30天筛选记录")?.iter().filter_map(|v|v["id"].as_str().map(str::to_string)).collect();
        if wanted!=recent{return Err("近30天筛选与测评版本更新日不符".into())}
        let primary:std::collections::BTreeSet<String>=report["primary"].as_array().ok_or("缺少当前主力记录")?.iter().filter_map(|v|v["id"].as_str().map(str::to_string)).collect();
        let wanted_primary:std::collections::BTreeSet<String>=edition.primary_profiles.iter().filter(|id|wanted.contains(*id)).cloned().collect();
        if primary!=wanted_primary{return Err("当前主力范围不符".into())}
        if report["radar"].as_u64().unwrap_or(0)==0||report["libraryRemoved"]!=true||report["donutLegendsRemoved"]!=true{return Err("六维图或产品页面结构不符".into())}
        let speed=crate::activity::speed::report(state.store.dir(),"","codex",7,"")?;
        let displayed=report["speed"].as_array().ok_or("缺少输出速度界面值")?;
        for (i,value) in [speed.summary.average,Some(speed.summary.samples as f64),speed.recent.first().map(|row|row.speed)].into_iter().enumerate(){
            if let Some(value)=value{if displayed.get(i).and_then(Value::as_f64).is_none_or(|n|(n-value).abs()>0.051){return Err("输出速度界面与本机记录不符".into())}}
        }
        Ok(())
    })();
    let payload=json!({"passed":result.is_ok(),"error":result.as_ref().err(),"version":crate::version::display_version(),"algorithm":board.algorithm,"report":report,"kind":"packaged-webview-rendered-values"});
    crate::storage::write_atomic(&state.store.dir().join("benchmark-ui-check.json"),&payload.to_string())?;
    app.exit(if result.is_ok(){0}else{1});result
}
pub fn smoke_if_requested(app:tauri::AppHandle){
    if !enabled(&app.state::<AppState>()){return}
    let script=r#"(()=>{if(window.__quotaBenchmarkSmoke)return;window.__quotaBenchmarkSmoke=true;let step=0,wait=0;const report={};
      const button=name=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===name);
      const collect=()=>[...document.querySelectorAll('.scatter-point')].flatMap(e=>(e.dataset.profileIds||'').split('|').filter(Boolean).map(id=>({id,score:Number(e.dataset.score),x:Number(e.dataset.plotX),y:Number(e.dataset.plotY),plotted:true,width:Number(e.ownerSVGElement.dataset.plotWidth),height:Number(e.ownerSVGElement.dataset.plotHeight)}))).concat([...document.querySelectorAll('.ladder-score-row')].map(e=>({id:e.dataset.profileId,score:Number(e.dataset.score),plotted:false})));
      const change=value=>{const select=document.querySelector('select[aria-label="测评范围"]');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));};
      const timer=setInterval(()=>{wait++;if(wait>150){clearInterval(timer);window.dispatchEvent(new CustomEvent('quota-benchmark-smoke-report',{detail:{error:'UI timeout',step}}));return;}
        if(step===0){document.querySelector('nav button[aria-label="AI 模型"]')?.click();if(document.querySelector('.visual-model-page')?.dataset.evaluationScope!=='main30'||!collect().length)return;report.primary=collect();change('all');step=1;return;}
        if(step===1){if(document.querySelector('.visual-model-page')?.dataset.evaluationScope!=='all'||!collect().length)return;report.all=collect();change('all30');step=2;return;}
        if(step===2){if(document.querySelector('.visual-model-page')?.dataset.evaluationScope!=='all30')return;report.recent=collect();button('六维对比')?.click();step=3;return;}
        if(step===3){const radar=document.querySelector('.visual-ability .ability-radar');if(!radar)return;report.radar=radar.querySelectorAll('circle').length;document.querySelector('nav button[aria-label="输出速度"]')?.click();step=4;return;}
        if(step===4){if(!report.speedPeriod){button('7天')?.click();report.speedPeriod=true;return;}if(!document.querySelector('.speed-summary')||!document.querySelector('.speed-chart svg'))return;report.speed=['.speed-average-value','.speed-sample-value','.speed-latest-value'].map(selector=>Number(document.querySelector(selector).textContent.replaceAll(',','')));report.libraryRemoved=!document.querySelector('nav button[aria-label="模型库"]');document.querySelector('nav button[aria-label="Token 活动"]')?.click();step=5;return;}
        if(step===5){if(!document.querySelector('.activity-shares'))return;report.donutLegendsRemoved=!document.querySelector('.activity-share-legend')&&!document.getElementById('activity-details');clearInterval(timer);window.dispatchEvent(new CustomEvent('quota-benchmark-smoke-report',{detail:report}));}
      },300);})()"#;
    tauri::async_runtime::spawn(async move{for _ in 0..22{tokio::time::sleep(std::time::Duration::from_secs(2)).await;if app.state::<AppState>().store.dir().join("benchmark-ui-check.json").exists(){break}if let Some(window)=app.get_webview_window("main"){let _=window.eval(script);}}});
}
