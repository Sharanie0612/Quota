use quota_lib::activity::{self,speed};
use serde_json::{json,Value};
use std::{fs,path::Path};
const OWNER:&str="00000000-0000-4000-8000-000000000001";
fn setup(dir:&Path,home:&Path,id:&str){
    fs::create_dir_all(dir).unwrap();let mut o=activity::options(dir);o.device_id=id.into();o.device_name="fixture".into();o.codex_home=home.to_string_lossy().into();o.zcode_home=String::new();o.harness_home=String::new();o.trae_home=String::new();o.sync_dir=String::new();o.codex_ssh_devices=Some(vec![]);activity::save_options(dir,&o).unwrap();
}
fn envelope(t:i64,kind:&str,payload:Value)->String{json!({"timestamp":chrono::DateTime::from_timestamp_millis(t).unwrap().to_rfc3339(),"type":kind,"payload":payload}).to_string()+"\n"}
fn response(t:i64,index:u64,output:u64,reasoning:u64,totals:(u64,u64),tool:bool)->String{
    let mut text=envelope(t,"response_item",json!({"type":"message","role":"assistant","content":"private-do-not-persist"}));
    text+=&envelope(t+5,"event_msg",json!({"type":"item_completed","item":{"type":"Reasoning","raw_content":"private-do-not-persist"},"started_at_ms":t-20000,"completed_at_ms":t-1}));
    let duration=if index==1{2000}else{500};
    text+=&envelope(t+duration,"event_msg",json!({"type":"item_completed","item":{"type":"AgentMessage","content":"private-do-not-persist"},"started_at_ms":t,"completed_at_ms":t+duration}));
    if tool{text+=&envelope(t+duration+1,"response_item",json!({"type":"function_call","call_id":"tool-fixture","name":"fixture-tool","arguments":"private-do-not-persist"}));}
    text+=&envelope(t+duration+2,"token_usage_record",json!({"response_id":format!("fixture-{index}"),"usage":{"output_tokens":output,"reasoning_output_tokens":reasoning}}));
    text+=&envelope(t+duration+3,"event_msg",json!({"type":"token_count","info":{"total_token_usage":{"input_tokens":1000*index,"output_tokens":totals.0,"reasoning_output_tokens":totals.1,"total_tokens":1000*index+totals.0}}}));text
}
fn synthetic(root:&Path){
    let dir=root.join("owner");let home=root.join("logs");fs::create_dir_all(home.join("sessions")).unwrap();setup(&dir,&home,OWNER);
    let t=chrono::Utc::now().timestamp_millis().div_euclid(3_600_000)*3_600_000-3_600_000+60_000;
    let mut log=envelope(t,"session_meta",json!({"session_id":"synthetic"}))+&envelope(t+1,"turn_context",json!({"model":"fixture-model"}));
    log+=&response(t+1000,1,240,40,(240,40),false);log+=&response(t+10000,2,110,10,(350,50),false);log+=&response(t+20000,3,40,0,(390,50),true);
    let path=home.join("sessions/fixture.jsonl");fs::write(&path,&log).unwrap();activity::collect(&dir).unwrap();
    let report=speed::report(&dir,"","codex",0,"").unwrap();assert_eq!(report.summary.samples,2);assert_eq!(report.summary.output_tokens,300);assert!((report.summary.average.unwrap()-120.).abs()<1e-9);assert_eq!(report.summary.median,Some(150.));assert_eq!(report.summary.p95,Some(200.));assert_eq!(report.points.len(),1);
    assert_eq!(speed::report(&dir,"","codex",0,"another-model").unwrap().summary.samples,0);
    let detailed=speed::report_window(&dir,"","codex",0,"",10,0).unwrap();assert_eq!(detailed.points.len(),2);assert_eq!(detailed.summary.average,Some(120.));assert_eq!(detailed.points.iter().map(|p|p.output_tokens).sum::<u64>(),300);
    assert!(speed::report_window(&dir,"","codex",0,"",13,0).is_err());
    assert_eq!(chrono::DateTime::from_timestamp_millis(report.points[0].timestamp).unwrap().with_timezone(&chrono::Local).format("%H:%M").to_string(),"00:00");
    assert_eq!(speed::report(&dir,"","codex",1,"").unwrap().bucket_minutes,5);
    assert_eq!(speed::report(&dir,"","codex",7,"").unwrap().bucket_minutes,60);
    let tokens=activity::report(&dir,None,None,None).unwrap().totals.tokens.total;assert_eq!(tokens,3390);
    assert_eq!(activity::collect(&dir).unwrap(),0);
    let db=rusqlite::Connection::open(dir.join("activity.sqlite")).unwrap();
    let legacy=json!({"offset":log.len(),"session":"synthetic","model":"fixture-model","agent":"主 Agent","previous":{"input":3000,"cached":0,"cacheWrite":0,"output":390,"reasoning":50,"total":3390},"inherited_until":null});
    db.execute("UPDATE cursors SET body=?1 WHERE path=?2",rusqlite::params![legacy.to_string(),path.to_string_lossy()]).unwrap();drop(db);
    activity::collect(&dir).unwrap();assert_eq!(activity::report(&dir,None,None,None).unwrap().totals.tokens.total,tokens);assert_eq!(speed::report(&dir,"","",0,"").unwrap().summary.samples,2);
    let receiver=root.join("receiver");setup(&receiver,Path::new(""),"00000000-0000-4000-8000-000000000002");
    let packets=activity::cloud_packets(&dir).unwrap();for(_,packet)in &packets{activity::import_cloud_packet(&receiver,packet.as_bytes()).unwrap();activity::import_cloud_packet(&receiver,packet.as_bytes()).unwrap();let mut old:Value=serde_json::from_str(packet).unwrap();for event in old["events"].as_array_mut().unwrap(){event.as_object_mut().unwrap().remove("speed");}activity::import_cloud_packet(&receiver,old.to_string().as_bytes()).unwrap();}
    assert_eq!(speed::report(&receiver,"","",0,"").unwrap().summary.samples,2);assert_eq!(activity::report(&receiver,None,None,None).unwrap().totals.tokens.total,tokens);
    let mut settings=activity::options(&receiver);settings.codex_ssh_devices=Some(vec![serde_json::from_value(json!({"host":"fixture","home":"/home/fixture/.codex","deviceId":OWNER,"name":"fixture","included":false,"aliases":["fixture"]})).unwrap()]);activity::save_options(&receiver,&settings).unwrap();assert_eq!(speed::report(&receiver,"","",0,"").unwrap().summary.samples,0);
    let db=rusqlite::Connection::open(dir.join("activity.sqlite")).unwrap();let content:String=db.query_row("SELECT group_concat(body) FROM metrics",[],|row|row.get(0)).unwrap();let cursors:String=db.query_row("SELECT group_concat(body) FROM cursors",[],|row|row.get(0)).unwrap();assert!(!content.contains("private-do-not-persist")&&!cursors.contains("private-do-not-persist"));
    let mut cursor=activity::Cursor::default();for line in [envelope(t,"session_meta",json!({"id":"untimed"})),envelope(t+1,"turn_context",json!({"model":"unknown"})),envelope(t+2,"token_usage_record",json!({"response_id":"untimed","usage":{"output_tokens":40,"reasoning_output_tokens":0}})),envelope(t+3,"event_msg",json!({"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"output_tokens":40,"total_tokens":41}}}))]{if let Some(event)=activity::parse_codex(&serde_json::from_str(&line).unwrap(),&mut cursor,OWNER){assert!(event.speed.is_none());}}
    println!("PASS weighted throughput, reasoning/tool exclusion, missing timing, replay migration, old-client sync, deduplication, excluded devices and private-content rejection");
}
fn fast_cycle(root:&Path){
 let dir=root.join("fast");let home=root.join("fast-logs");fs::create_dir_all(home.join("sessions")).unwrap();setup(&dir,&home,OWNER);
 let t=chrono::Utc::now().timestamp_millis()-8000;let path=home.join("sessions/fast.jsonl");
 let first=envelope(t,"session_meta",json!({"id":"fast-fixture"}))+&envelope(t+1,"turn_context",json!({"model":"fast-model"}))+&response(t,1,240,40,(240,40),false);
 fs::write(&path,&first).unwrap();assert_eq!(activity::collect_output_speed(&dir).unwrap(),1);
 let mut settings=activity::options(&dir);settings.auto_collect=false;activity::save_options(&dir,&settings).unwrap();fs::write(&path,first+&response(t+4000,2,110,10,(350,50),false)).unwrap();
 assert_eq!(activity::collect_output_speed(&dir).unwrap(),0);assert_eq!(speed::report(&dir,"","",0,"").unwrap().summary.samples,1);
 settings.auto_collect=true;activity::save_options(&dir,&settings).unwrap();assert_eq!(activity::collect_output_speed(&dir).unwrap(),1);assert_eq!(activity::collect_output_speed(&dir).unwrap(),0);assert_eq!(activity::collect(&dir).unwrap(),0);
 let report=speed::report_window(&dir,"","",1,"",10,1).unwrap();assert_eq!(report.summary.samples,2);assert_eq!(report.summary.average,Some(120.));assert_eq!(report.collection_interval_seconds,1);assert!(report.collected_at.is_some());assert_eq!(activity::report(&dir,None,None,None).unwrap().totals.tokens.total,2350);
 println!("PASS fast Codex collection, pause/resume, shared ledger deduplication, 10-second buckets and local calendar aggregation");
}
fn incremental(root:&Path){
 use std::io::Write;
 let dir=root.join("incremental");let home=root.join("incremental-logs");fs::create_dir_all(home.join("sessions")).unwrap();setup(&dir,&home,OWNER);
 let t=chrono::Utc::now().timestamp_millis()-30_000;let path=home.join("sessions/fixture.jsonl");
 fs::write(&path,envelope(t,"session_meta",json!({"id":"incremental"}))+&envelope(t+1,"turn_context",json!({"model":"fixture-model"}))+&envelope(t+2,"event_msg",json!({"type":"task_started"}))).unwrap();
 let mut reader=activity::speed_live::LocalReader::default();assert_eq!(reader.tick(&dir).unwrap(),0);assert_eq!(activity::speed_live::status(&dir).active_requests,1);
 let first=response(t+1000,1,240,40,(240,40),false);let split=first.rfind('\n').unwrap();let count_start=first[..split].rfind('\n').unwrap()+1;
 let mut writer=fs::OpenOptions::new().append(true).open(&path).unwrap();writer.write_all(first[..count_start].as_bytes()).unwrap();
 assert_eq!(reader.tick(&dir).unwrap(),0);assert_eq!(speed::report(&dir,"","",0,"").unwrap().summary.samples,0);
 writer.write_all(first[count_start..split].as_bytes()).unwrap();assert_eq!(reader.tick(&dir).unwrap(),0);
 writer.write_all(b"\n").unwrap();assert_eq!(reader.tick(&dir).unwrap(),1);assert_eq!(reader.tick(&dir).unwrap(),0);
 let report=speed::report_minutes(&dir,"","",0,"",10,30).unwrap();assert_eq!(report.summary.average,Some(100.));assert_eq!(report.summary.duration_ms,2000);assert_eq!(report.recent[0].output_tokens,200);assert_eq!(report.recent[0].speed,100.);assert_eq!(report.by_model.len(),1);assert_eq!(report.coverage.output_records,1);assert_eq!(report.coverage.timed_records,1);
 let mut settings=activity::options(&dir);settings.auto_collect=false;activity::save_options(&dir,&settings).unwrap();writer.write_all(response(t+10_000,2,110,10,(350,50),false).as_bytes()).unwrap();assert_eq!(reader.tick(&dir).unwrap(),0);
 settings.auto_collect=true;activity::save_options(&dir,&settings).unwrap();assert_eq!(reader.tick(&dir).unwrap(),1);writer.write_all(envelope(t+20_000,"event_msg",json!({"type":"task_complete"})).as_bytes()).unwrap();reader.tick(&dir).unwrap();assert_eq!(activity::speed_live::status(&dir).active_requests,0);
 assert_eq!(activity::collect(&dir).unwrap(),0);assert_eq!(activity::report(&dir,None,None,None).unwrap().totals.tokens.total,2350);
 let report=speed::report_minutes(&dir,"","",0,"",10,30).unwrap();assert_eq!(report.summary.average,Some(120.));assert_eq!(report.points.iter().map(|p|p.output_tokens).sum::<u64>(),300);assert_eq!(report.summary.samples,2);assert_eq!(report.recent.len(),2);
 let missing=root.join("missing-source");setup(&missing,&root.join("absent"),"00000000-0000-4000-8000-000000000008");let mut unavailable=activity::speed_live::LocalReader::default();unavailable.tick(&missing).unwrap();assert!(!activity::speed_live::status(&missing).errors.is_empty());unavailable.tick(&missing).unwrap();assert!(!activity::speed_live::status(&missing).errors.is_empty());
 println!("PASS incremental tail, pending usage without invented speed, partial JSONL retry, raw-record reconciliation, weighted bins, pause/resume and shared-cursor replay");
}
fn main(){
    let root=std::env::current_dir().unwrap().join("../target/output-speed-checks").join(uuid::Uuid::new_v4().to_string());fs::create_dir_all(&root).unwrap();synthetic(&root);fast_cycle(&root);incremental(&root);
    if let Some(home)=std::env::args().nth(1){let dir=root.join("live-isolated");setup(&dir,Path::new(&home),OWNER);activity::collect(&dir).unwrap();let report=speed::report(&dir,"","codex",7,"").unwrap();println!("LIVE {}",serde_json::to_string(&report.summary).unwrap());fs::write(root.join("live-speed-report.json"),serde_json::to_vec(&report).unwrap()).unwrap();}
}
