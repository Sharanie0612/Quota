use super::{database, known_device_names, now, options, Metric, OptionsDevice};
use crate::{activity::speed_live, commands::AppState};
use serde::Serialize;
use serde_json::Value;
use std::{collections::{BTreeMap,BTreeSet}, path::Path};
use tauri::Manager;

#[derive(Default, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Point {
    /// Start of the calendar bin. Samples are grouped by response completion;
    /// they are never spread into invented per-token observations.
    pub timestamp:i64, pub model:String, pub output_tokens:u64,
    pub duration_ms:u64, pub samples:usize,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Summary {
    pub average:Option<f64>, pub median:Option<f64>, pub p95:Option<f64>,
    pub samples:usize, pub output_tokens:u64, pub duration_ms:u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct CompletedOutput {
    pub id:String, pub model:String, pub device:String,
    pub started_at:i64, pub completed_at:i64, pub output_tokens:u64,
    pub duration_ms:u64, pub speed:f64,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ModelSummary { pub model:String, pub summary:Summary, pub latest_at:i64 }
#[derive(Default, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Coverage { pub output_records:usize, pub timed_records:usize }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Report {
    pub devices:Vec<OptionsDevice>, pub models:Vec<String>, pub points:Vec<Point>,
    pub summary:Summary, pub updated_at:i64, pub bucket_minutes:u32,
    pub bucket_seconds:u32, pub collection_interval_seconds:u64,
    pub collection_enabled:bool, pub collected_at:Option<i64>, pub errors:Vec<String>,
    pub range_start:i64, pub range_end:i64, pub recent:Vec<CompletedOutput>, pub calls:Vec<CompletedOutput>,
    pub by_model:Vec<ModelSummary>, pub coverage:Coverage,
    pub live:speed_live::Status, pub local_monitoring:bool,
}
fn summarize(rows:&[CompletedOutput])->Summary {
    let mut result=Summary::default();let mut rates=Vec::new();
    for row in rows {
        result.samples+=1;result.output_tokens=result.output_tokens.saturating_add(row.output_tokens);
        result.duration_ms=result.duration_ms.saturating_add(row.duration_ms);rates.push(row.speed);
    }
    rates.sort_by(f64::total_cmp);
    if !rates.is_empty() {
        result.average=Some(result.output_tokens as f64*1000./result.duration_ms as f64);
        let middle=rates.len()/2;
        result.median=Some(if rates.len()%2==0{(rates[middle-1]+rates[middle])/2.}else{rates[middle]});
        result.p95=Some(rates[((rates.len() as f64*0.95).ceil() as usize).saturating_sub(1)]);
    }
    result
}
pub fn report(dir:&Path,device:&str,source:&str,days:u32,model:&str)->Result<Report,String>{
    report_window(dir,device,source,days,model,0,0)
}
pub fn report_window(dir:&Path,device:&str,source:&str,days:u32,model:&str,resolution:u32,lookback_hours:u32)->Result<Report,String>{
    if lookback_hours>24{return Err("输出速度时间范围无效".into())}
    report_minutes(dir,device,source,days,model,resolution,lookback_hours*60)
}
pub fn report_minutes(dir:&Path,device:&str,source:&str,days:u32,model:&str,resolution:u32,minutes:u32)->Result<Report,String>{
    if ![0,10,60,300,3600,21600,86400].contains(&resolution)||minutes>1440||days>36600{return Err("输出速度时间范围无效".into())}
    let db=database(dir)?;let settings=options(dir);let excluded=settings.excluded_devices();
    let end=now();let today=chrono::Local::now().date_naive();
    let first=if minutes==0&&days>0 { today.checked_sub_days(chrono::Days::new((days-1).into())) }else{None};
    let requested_start=if minutes>0{end-i64::from(minutes)*60_000}else{
        first.and_then(|date|date.and_hms_opt(0,0,0)?.and_local_timezone(chrono::Local).earliest().map(|date|date.timestamp_millis())).unwrap_or(0)
    };
    // Preserve the legacy API's defaults. The new page sends its visible grain.
    let bucket_seconds=if resolution>0{resolution}else if minutes>0{60}else if days==1{300}else if days==0{86400}else if days>=30{21600}else{3600};
    let bucket_ms=i64::from(bucket_seconds)*1000;
    let mut statement=db.prepare("SELECT body FROM metrics WHERE json_extract(body,'$.speed') IS NOT NULL AND json_extract(body,'$.speed.completedAt')>=?1 AND json_extract(body,'$.speed.completedAt')<=?2").map_err(|_|"读取输出速度失败")?;
    let rows=statement.query_map(rusqlite::params![requested_start,end],|row|row.get::<_,String>(0)).map_err(|_|"读取输出速度失败")?;
    let mut models=BTreeSet::new();let mut measured=Vec::new();
    for row in rows {
        let event:Metric=serde_json::from_str(&row.map_err(|_|"读取输出速度失败")?).map_err(|_|"输出速度记录损坏")?;
        let Some(sample)=&event.speed else{continue};
        if !sample.valid(&event)||excluded.contains(&event.device)||(!device.is_empty()&&device!=event.device)||(!source.is_empty()&&source!=event.source){continue}
        models.insert(event.model.clone());
        measured.push(CompletedOutput {id:event.id,model:event.model,device:event.device,started_at:sample.started_at,completed_at:sample.completed_at,output_tokens:sample.output_tokens,duration_ms:sample.duration_ms,speed:sample.output_tokens as f64*1000./sample.duration_ms as f64});
    }
    let mut groups=BTreeMap::<String,Vec<CompletedOutput>>::new();
    for row in &measured {groups.entry(row.model.clone()).or_default().push(row.clone());}
    let mut by_model:Vec<ModelSummary>=groups.into_iter().map(|(model,rows)|ModelSummary{model,summary:summarize(&rows),latest_at:rows.iter().map(|row|row.completed_at).max().unwrap_or(0)}).collect();
    by_model.sort_by(|a,b|b.latest_at.cmp(&a.latest_at).then_with(||a.model.cmp(&b.model)));
    measured.retain(|row|model.is_empty()||model==row.model);
    let summary=summarize(&measured);
    let mut buckets=BTreeMap::<(i64,String),Point>::new();
    for row in &measured {
        let Some(time)=chrono::DateTime::from_timestamp_millis(row.completed_at) else{continue};
        let local_ms=time.with_timezone(&chrono::Local).naive_local().and_utc().timestamp_millis();
        let bin=chrono::DateTime::from_timestamp_millis(local_ms.div_euclid(bucket_ms)*bucket_ms)
            .and_then(|date|date.naive_utc().and_local_timezone(chrono::Local).earliest()).map(|date|date.timestamp_millis()).unwrap_or(row.completed_at.div_euclid(bucket_ms)*bucket_ms);
        let point=buckets.entry((bin,row.model.clone())).or_insert_with(||Point{timestamp:bin,model:row.model.clone(),..Default::default()});
        point.output_tokens=point.output_tokens.saturating_add(row.output_tokens);point.duration_ms=point.duration_ms.saturating_add(row.duration_ms);point.samples+=1;
    }
    let mut coverage=Coverage{timed_records:summary.samples,..Default::default()};
    let mut statement=db.prepare("SELECT json_extract(body,'$.device'),json_extract(body,'$.model') FROM metrics WHERE json_extract(body,'$.source')='codex' AND json_extract(body,'$.kind')='tokens' AND json_extract(body,'$.timestamp')>=?1 AND json_extract(body,'$.timestamp')<=?2 AND COALESCE(json_extract(body,'$.tokens.output'),0)>COALESCE(json_extract(body,'$.tokens.reasoning'),0)").map_err(|_|"读取计时覆盖率失败")?;
    for row in statement.query_map(rusqlite::params![requested_start,end],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|_|"读取计时覆盖率失败")? {
        let (owner,name)=row.map_err(|_|"读取计时覆盖率失败")?;
        if !excluded.contains(&owner)&&(device.is_empty()||device==owner)&&(model.is_empty()||model==name)&&(source.is_empty()||source=="codex"){coverage.output_records+=1;}
    }
    measured.sort_by(|a,b|b.completed_at.cmp(&a.completed_at).then_with(||a.id.cmp(&b.id)));
    let calls=measured.clone();measured.truncate(24);
    let range_start=if requested_start>0{requested_start}else{buckets.keys().next().map(|(time,_)|*time).unwrap_or(end-3_600_000)};
    let local_monitoring=device.is_empty()||device==settings.device_id;
    let live=if local_monitoring{speed_live::status(dir)}else{Default::default()};
    let status:Value=std::fs::read(dir.join("output-speed-status.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    let errors=if local_monitoring{live.errors.clone()}else{status.get("errors").and_then(|v|serde_json::from_value(v.clone()).ok()).unwrap_or_default()};
    let collected_at=if local_monitoring{live.checked_at.or_else(||status["collectedAt"].as_i64())}else{status["collectedAt"].as_i64()};
    Ok(Report {devices:known_device_names(&db,&settings)?.into_iter().filter(|d|!excluded.contains(&d.id)).collect(),models:models.into_iter().collect(),points:buckets.into_values().collect(),summary,updated_at:end,bucket_minutes:bucket_seconds/60,bucket_seconds,collection_interval_seconds:if local_monitoring{1}else{super::COLLECTION_INTERVAL_SECONDS},collection_enabled:settings.auto_collect,collected_at,errors,range_start,range_end:end,recent:measured,calls,by_model,coverage,live,local_monitoring})
}
#[tauri::command]
pub async fn get_output_speed(app:tauri::AppHandle,device:Option<String>,source:Option<String>,days:Option<u32>,model:Option<String>,bucket_seconds:Option<u32>,lookback_hours:Option<u32>,lookback_minutes:Option<u32>)->Result<Report,String>{
    tauri::async_runtime::spawn_blocking(move||report_minutes(app.state::<AppState>().store.dir(),&device.unwrap_or_default(),&source.unwrap_or_default(),days.unwrap_or(7),&model.unwrap_or_default(),bucket_seconds.unwrap_or(0),lookback_minutes.unwrap_or_else(||lookback_hours.unwrap_or(0).saturating_mul(60)))).await.map_err(|_|"读取输出速度失败")?
}
