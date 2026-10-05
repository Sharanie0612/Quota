use quota_lib::activity::{self,Options};
use std::{fs,io::Write,path::Path};
use serde_json::json;
use chrono::TimeZone;
fn envelope(kind:&str,payload:serde_json::Value,ordinal:u64)->String{json!({"timestamp":"2026-10-04T00:00:00Z","type":kind,"payload":payload,"ordinal":ordinal}).to_string()+"\n"}
fn setup(dir:&Path,home:&Path,sync:&Path,id:&str){fs::create_dir_all(dir).unwrap();activity::save_options(dir,&Options{device_id:id.into(),device_name:id.into(),auto_collect:true,codex_home:home.to_string_lossy().into(),zcode_home:dir.join("none").to_string_lossy().into(),harness_home:String::new(),sync_dir:sync.to_string_lossy().into()}).unwrap()}
fn check_model_calendar_reports(root:&Path) {
 let dir=root.join("report-filters");fs::create_dir_all(&dir).unwrap();
 activity::report(&dir,None,None,None).unwrap();
 let db=rusqlite::Connection::open(dir.join("activity.sqlite")).unwrap();
 let aid="00000000-0000-4000-8000-000000000001";let bid="00000000-0000-4000-8000-000000000002";
 let today=chrono::Local::now().date_naive();let first=today.checked_sub_days(chrono::Days::new(6)).unwrap();
 let at=|day:chrono::NaiveDate,hour,minute,second|chrono::Local.from_local_datetime(&day.and_hms_opt(hour,minute,second).unwrap()).earliest().unwrap().timestamp_millis();
 let token=|id:u64,model:&str,source:&str,device:&str,timestamp,total:u64,cached|activity::Metric {
  id:format!("{id:064x}"),device:device.into(),source:source.into(),session:if model=="Alpha"{"shared".into()}else{model.into()},model:model.into(),agent:"主 Agent".into(),tool:String::new(),timestamp,kind:"tokens".into(),revision:0,
  tokens:activity::Tokens{input:total.saturating_sub(20),output:total.min(20),cached,reasoning:5,total,..Default::default()}
 };
 let samples=[
  token(1,"Alpha","codex",aid,at(first.pred_opt().unwrap(),23,59,59),9999,0),
  token(2,"Alpha","codex",aid,at(first,0,0,0),120,50),
  token(3,"Alpha","codex",aid,at(first,23,59,59),80,20),
  token(4,"Alpha","codex",aid,at(today,0,0,0),40,10),
  token(5,"Alpha-Code","codex",aid,at(today,0,0,0),300,0),
  token(6,"Alpha","zcode",aid,at(today,0,0,0),500,0),
  token(7,"Alpha","codex",bid,at(today,0,0,0),700,0),
  token(8,"Alpha","codex",aid,at(today.succ_opt().unwrap(),0,0,0),9000,0),
  token(9,"alpha","codex",aid,at(first.checked_add_days(chrono::Days::new(2)).unwrap(),0,0,0),10,0),
 ];
 for event in &samples {assert!(activity::merge_metric(&db,event,false).unwrap());assert!(!activity::merge_metric(&db,event,false).unwrap());}
 for (id,model,tool) in [(10,"Alpha","read"),(11,"Alpha-Code","write")] {
  let mut event=token(id,model,"codex",aid,at(today,0,0,0),0,0);event.kind="tool".into();event.tool=tool.into();event.tokens=Default::default();activity::merge_metric(&db,&event,false).unwrap();
 }
 let filtered=|model:&str,days|activity::report_filtered(&dir,Some(aid.into()),Some("codex".into()),days,Some(model.into())).unwrap();
 let daily=activity::report_range(&dir,Some(aid.into()),Some("codex".into()),Some(7),Some("Alpha".into()),Some(first.to_string()),Some(first.to_string())).unwrap();
 assert_eq!(daily.totals.tokens.total,200);assert_eq!(daily.totals.sessions,1);assert_eq!(daily.totals.calls,0);
 let period=activity::report_range(&dir,Some(aid.into()),Some("codex".into()),Some(7),Some("Alpha".into()),Some(first.to_string()),Some(today.to_string())).unwrap();assert_eq!(period.totals.tokens.total,240);assert_eq!(period.totals.sessions,1);
 assert!(activity::report_range(&dir,None,None,None,None,Some(today.to_string()),Some(first.to_string())).is_err());
 assert!(activity::report_range(&dir,None,None,None,None,Some("2026-02-30".into()),None).is_err());
 let selected=filtered("Alpha",Some(7));
 assert_eq!(selected.totals.tokens.total,240);assert_eq!(selected.totals.tokens.cached,80);assert_eq!(selected.totals.tokens.reasoning,15);
 assert_eq!(selected.totals.calls,1);assert_eq!(selected.totals.sessions,1);assert_eq!(selected.tools.len(),1);assert_eq!(selected.tools[0].key,"read");
 assert_eq!(selected.models.len(),1);assert_eq!(selected.models[0].key,"Alpha");assert_eq!(selected.agents.len(),1);assert_eq!(selected.sources[0].key,"codex");assert_eq!(selected.by_device[0].key,aid);
 assert_eq!(selected.daily.len(),2);assert_eq!(selected.daily[0].key,first.to_string());assert_eq!(selected.daily[0].tokens.total,200);assert_eq!(selected.daily[1].key,today.to_string());assert_eq!(selected.daily[1].tokens.total,40);
 assert_eq!(selected.daily.iter().map(|d|d.tokens.total).sum::<u64>(),selected.totals.tokens.total);
 assert_eq!(selected.available_models.iter().map(|m|(m.key.as_str(),m.tokens.total)).collect::<Vec<_>>(),vec![("Alpha",240),("Alpha-Code",300),("alpha",10)]);
 assert_eq!(filtered("Alpha",Some(1)).totals.tokens.total,40);
 let all=filtered("",Some(7));assert_eq!(all.totals.tokens.total,550);assert_eq!(all.totals.calls,2);assert_eq!(all.totals.sessions,3);
 assert_eq!(serde_json::to_value(&all.models).unwrap(),serde_json::to_value(&all.available_models).unwrap());
 let missing=filtered("Al",Some(7));assert_eq!(missing.totals.tokens.total,0);assert_eq!(missing.totals.calls,0);assert!(missing.models.is_empty());assert!(missing.daily.is_empty());assert_eq!(missing.available_models.len(),3);
 assert_eq!(activity::report_filtered(&dir,Some(aid.into()),Some("zcode".into()),Some(7),Some("Alpha".into())).unwrap().totals.tokens.total,500);
 assert_eq!(activity::report_filtered(&dir,Some(bid.into()),Some("codex".into()),Some(7),Some("Alpha".into())).unwrap().totals.tokens.total,700);
 assert_eq!(filtered("Alpha",None).totals.tokens.total,filtered("Alpha",Some(0)).totals.tokens.total);
 assert_eq!(filtered("Alpha",None).totals.tokens.total,10239);
 assert_eq!(filtered("Alpha",None).daily.iter().map(|d|d.tokens.total).sum::<u64>(),10239);
 assert_eq!(filtered("Alpha",Some(u32::MAX)).totals.tokens.total,10239);
 println!("PASS: exact model filters, model choices retain scope, tool filters, unique sessions across days, local calendar boundaries, daily sums, zero/all-history ranges");
}
fn main(){
 let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/activity-checks").join(uuid::Uuid::new_v4().to_string());fs::create_dir_all(&root).unwrap();
 let home=root.join("logs");fs::create_dir_all(home.join("sessions")).unwrap();let log=home.join("sessions/rollout-check.jsonl");
 let header=envelope("session_meta",json!({"id":"test-session"}),0)+&envelope("turn_context",json!({"model":"test-model"}),1);
 let token=|input,total|envelope("event_msg",json!({"type":"token_count","info":{"total_token_usage":{"input_tokens":input,"cached_input_tokens":50,"output_tokens":20,"reasoning_output_tokens":10,"total_tokens":total}}}),2);
 let tool=envelope("response_item",json!({"type":"function_call","call_id":"call-test","name":"exec_command","arguments":"PRIVATE_DO_NOT_SAVE"}),3);
 fs::write(&log,header.clone()+&token(100,120)+&token(100,120)+&tool).unwrap();
 let a=root.join("a");let b=root.join("b");let sync=root.join("shared");let aid="00000000-0000-4000-8000-000000000001";let bid="00000000-0000-4000-8000-000000000002";
 setup(&a,&home,&sync,aid);setup(&b,&home,&sync,bid);
 activity::collect(&a).unwrap();activity::collect(&a).unwrap();activity::collect(&b).unwrap();activity::collect(&a).unwrap();
 let report=|dir:&Path|activity::report(dir,None,None,None).unwrap();let r=report(&a);assert_eq!(r.totals.tokens.total,120);assert_eq!(r.totals.calls,1);assert_eq!(r.totals.tokens.cached,50);assert_eq!(r.by_device.len(),1);assert_eq!(report(&b).totals.tokens.total,120);
 let mut file=fs::OpenOptions::new().append(true).open(&log).unwrap();let next=token(200,220);file.write_all(next.trim_end().as_bytes()).unwrap();activity::collect(&a).unwrap();assert_eq!(report(&a).totals.tokens.total,120);file.write_all(b"\n").unwrap();activity::collect(&a).unwrap();assert_eq!(report(&a).totals.tokens.total,220);
 // Truncation rereads the file, while event identities prevent counting it twice.
 fs::write(&log,header.clone()+&token(100,120)).unwrap();activity::collect(&a).unwrap();assert_eq!(report(&a).totals.tokens.total,220);
 let fork=home.join("sessions/rollout-fork.jsonl");fs::write(fork,envelope("session_meta",json!({"id":"fork","parent_thread_id":"test-session","subagent_history_start_ordinal":4}),0)+&envelope("turn_context",json!({"model":"test-model"}),1)+&token(100,120)+&tool).unwrap();activity::collect(&a).unwrap();assert_eq!(report(&a).totals.tokens.total,220);assert_eq!(report(&a).totals.calls,1);
 activity::collect(&b).unwrap();activity::collect(&a).unwrap();assert_eq!(report(&b).totals.tokens.total,220);assert_eq!(activity::report(&a,Some(bid.into()),None,None).unwrap().totals.tokens.total,0);
 for dir in [&a,&b]{let db=rusqlite::Connection::open(dir.join("activity.sqlite")).unwrap();let count:i64=db.query_row("SELECT COUNT(*) FROM metrics WHERE body LIKE '%PRIVATE_DO_NOT_SAVE%'",[],|r|r.get(0)).unwrap();assert_eq!(count,0);}
 // Read-only ZCode usage adapter: duplicate migrated databases share request IDs.
 let z=root.join("zcode");fs::create_dir_all(z.join("v2")).unwrap();fs::create_dir_all(z.join("cli/db")).unwrap();
 let dbpath=z.join("v2/tasks-index.sqlite");let db=rusqlite::Connection::open(&dbpath).unwrap();db.execute_batch("CREATE TABLE model_usage(id TEXT,logical_request_id TEXT,attempt_index INTEGER,session_id TEXT,turn_id TEXT,model_id TEXT,agent TEXT,started_at INTEGER,completed_at INTEGER,input_tokens INTEGER,cache_read_input_tokens INTEGER,cache_creation_input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,computed_total_tokens INTEGER,provider_total_tokens INTEGER,assistant_message_id TEXT);CREATE TABLE tool_usage(id TEXT,tool_call_id TEXT,session_id TEXT,turn_id TEXT,tool_name TEXT,started_at INTEGER,completed_at INTEGER);INSERT INTO model_usage VALUES('m','req',0,'z-session','turn','GLM-test','build',1791072000000,1791072000000,100,80,0,20,5,120,120,'message');INSERT INTO tool_usage VALUES('t','z-call','z-session','turn','read',1791072000000,1791072000000);").unwrap();db.execute_batch(r#"CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);CREATE TABLE part(id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);INSERT INTO message VALUES('legacy','z-session',1791072000000,1791072000000,'{"role":"assistant","modelID":"GLM-old","agent":"build","tokens":{"input":85,"output":15,"reasoning":2,"cache":{"read":50,"write":0}}}');INSERT INTO message VALUES('message','z-session',1791072000000,1791072060000,'{"role":"assistant","modelID":"GLM-test","tokens":{"input":100,"output":20}}');INSERT INTO part VALUES('p-old','z-session',1791072000000,1791072000000,'{"type":"tool","tool":"legacy-read","callID":"old-call"}');INSERT INTO part VALUES('p-modern','z-session',1791072000000,1791072000000,'{"type":"tool","tool":"read","callID":"z-call"}');"#).unwrap();drop(db);fs::copy(dbpath,z.join("cli/db/db.sqlite")).unwrap();
 let mut o=activity::options(&a);o.zcode_home=z.to_string_lossy().into();activity::save_options(&a,&o).unwrap();activity::collect(&a).unwrap();let r=report(&a);assert!(r.errors.is_empty(),"{:?}",r.errors);assert_eq!(r.totals.tokens.total,440);assert_eq!(r.totals.calls,3);assert_eq!(activity::report(&a,None,Some("zcode".into()),None).unwrap().totals.tokens.total,220);
 let update=rusqlite::Connection::open(z.join("v2/tasks-index.sqlite")).unwrap();update.execute("UPDATE message SET time_updated=1791072120000,data=json_set(data,'$.tokens.input',95) WHERE id='legacy'",[]).unwrap();drop(update);activity::collect(&a).unwrap();activity::collect(&a).unwrap();assert_eq!(report(&a).totals.tokens.total,450);assert_eq!(report(&a).totals.calls,3);
 println!("PASS: legacy updates, repeated counters, append, partial tail, truncation, inherited fork, cross-device dedup, filters, private-field exclusion, duplicate ZCode databases");
 check_model_calendar_reports(&root);
 if std::env::args().any(|a|a=="--live"){let dir=root.join("live");fs::create_dir_all(&dir).unwrap();let mut o=activity::options(&dir);o.sync_dir.clear();activity::save_options(&dir,&o).unwrap();activity::collect(&dir).unwrap();let r=report(&dir);println!("Live read-only sources: {} token records/models, {} tools, {} sessions, errors={:?}",r.models.len(),r.tools.len(),r.totals.sessions,r.errors);activity::collect(&dir).unwrap();let after=report(&dir);assert!(after.errors.is_empty());assert!(after.totals.tokens.total>=r.totals.tokens.total);println!("PASS: live repeat scan, {} new Token while sources remain active",after.totals.tokens.total-r.totals.tokens.total);}
}
