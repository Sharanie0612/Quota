//! Synthetic SSH transport: run the exact projection script locally, never connect
//! to a real host or access personal logs, credentials or configuration.
use quota_lib::activity::{self, ssh, Cursor};
use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap, fs, io::Write, path::Path, process::{Command,Stdio}};

fn line(kind:&str,payload:Value,ordinal:u64)->String {json!({"timestamp":"2026-10-17T09:00:00.123Z","type":kind,"payload":payload,"ordinal":ordinal}).to_string()+"\n"}
fn token(input:u64)->String {line("event_msg",json!({"type":"token_count","info":{"total_token_usage":{"input_tokens":input,"output_tokens":20,"cached_input_tokens":50,"reasoning_output_tokens":5,"total_tokens":input+20,"future_counter":7}},"private":"PRIVATE_MESSAGE_MUST_NOT_TRANSFER"}),2)}
fn projection(python:&str,logs:&Path,db:&Connection,host:&str)->Vec<u8>{
    projection_mode(python,logs,db,host,"")
}
fn projection_mode(python:&str,logs:&Path,db:&Connection,host:&str,mode:&str)->Vec<u8>{
    let prefix=format!("ssh:{:x}:",Sha256::digest(format!("{host}\n/home/check").as_bytes()));
    let mut offsets=BTreeMap::new();let mut query=db.prepare("SELECT path,body FROM cursors").unwrap();
    for row in query.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).unwrap(){let(path,body)=row.unwrap();if let Some(path)=path.strip_prefix(&prefix){offsets.insert(path.to_string(),serde_json::from_str::<Cursor>(&body).unwrap().offset);}}
    let mut child=Command::new(python).arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts/codex-ssh-metrics.py")).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(json!({"format":"quota-codex-ssh-v1","home":logs,"offsets":offsets,"mode":mode}).to_string().as_bytes()).unwrap();
    let result=child.wait_with_output().unwrap();assert!(result.status.success(),"projection failed");assert!(result.stderr.is_empty());
    let text=std::str::from_utf8(&result.stdout).unwrap();for private in ["PRIVATE_MESSAGE","PRIVATE_ARGUMENT","PRIVATE_INSTRUCTION","PRIVATE_COOKIE"]{assert!(!text.contains(private));}
    result.stdout
}
fn main(){
    let python=std::env::args().nth(1).expect("pass a Python 3.7+ executable for isolated projection checks");
    let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ssh-activity-checks").join(uuid::Uuid::new_v4().to_string());
    let logs=root.join("logs");let data=root.join("data");fs::create_dir_all(logs.join("sessions")).unwrap();fs::create_dir_all(&data).unwrap();
    activity::report(&data,None,None,None).unwrap();let mut db=Connection::open(data.join("activity.sqlite")).unwrap();
    let header=line("session_meta",json!({"id":"ssh-session","session_id":null,"base_instructions":{"text":"PRIVATE_INSTRUCTION"},"cookie":"PRIVATE_COOKIE"}),0)
        +&line("turn_context",json!({"model":"gpt-test","private":"PRIVATE_INSTRUCTION"}),1);
    let tool=line("response_item",json!({"type":"function_call","name":"exec_command","call_id":"ssh-call","arguments":"PRIVATE_ARGUMENT"}),3);
    let file=logs.join("sessions/rollout-check.jsonl");fs::write(&file,header.clone()+&token(100)+&token(100)+&tool).unwrap();
    let read=|db:&Connection,host|projection(&python,&logs,db,host);
    let apply=|db:&mut Connection,host,bytes:&[u8]|{let mut errors=Vec::new();let count=ssh::apply(db,host,"/home/check",bytes,&mut errors).unwrap();(count,errors)};
    let bytes=read(&db,"vm");let response:Value=serde_json::from_slice(&bytes).unwrap();let remote=response["deviceId"].as_str().unwrap();
    let probe=projection_mode(&python,&logs,&db,"vm","identity");let probe_json:Value=serde_json::from_slice(&probe).unwrap();
    assert_eq!(ssh::identity(&probe).unwrap().0,remote);assert_eq!(probe_json["files"],json!([]));assert_eq!(probe_json["errors"],json!([]));
    assert_eq!(projection_mode(&python,&logs.join("absent"),&db,"vm","identity").len()>0,true);
    assert_eq!(apply(&mut db,"vm",&bytes),(2,vec![]));
    let report=||activity::report(&data,None,None,None).unwrap();assert_eq!(report().totals.tokens.total,120);assert_eq!(report().totals.calls,1);
    // The remote full-object digest exactly matches existing local identities,
    // even though unknown fields never travel over SSH.
    let mut c=Cursor::default();for raw in (header.clone()+&token(100)+&tool).lines(){if let Some(event)=activity::parse_codex(&serde_json::from_str(raw).unwrap(),&mut c,remote){assert!(!activity::merge_metric(&db,&event,false).unwrap());}}
    let bytes=read(&db,"vm");assert_eq!(apply(&mut db,"vm",&bytes).0,0);
    let mut append=fs::OpenOptions::new().append(true).open(&file).unwrap();let next=token(200);append.write_all(next.trim_end().as_bytes()).unwrap();
    let bytes=read(&db,"vm");assert_eq!(apply(&mut db,"vm",&bytes).0,0);assert_eq!(report().totals.tokens.total,120);
    append.write_all(b"\n").unwrap();drop(append);let bytes=read(&db,"vm");assert_eq!(apply(&mut db,"vm",&bytes).0,1);assert_eq!(report().totals.tokens.total,220);
    // Reconnecting under another alias, copying and truncating history dedup.
    let bytes=read(&db,"vm-alias");assert_eq!(apply(&mut db,"vm-alias",&bytes).0,0);
    fs::copy(&file,logs.join("sessions/rollout-copy.jsonl")).unwrap();let bytes=read(&db,"vm");assert_eq!(apply(&mut db,"vm",&bytes).0,0);
    fs::write(&file,header.clone()+&token(100)).unwrap();let bytes=read(&db,"vm");assert_eq!(apply(&mut db,"vm",&bytes).0,0);assert_eq!(report().totals.tokens.total,220);
    // Failed file batches roll back their metrics and cursor independently.
    let mut bad:Value=serde_json::from_slice(&read(&db,"vm")).unwrap();bad["files"]=json!([{"path":"sessions/invalid.jsonl","start":0,"offset":100,"reset":false,"events":[{"type":"event_msg","timestamp":"2026-10-17T09:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":1}}}}]}]);
    let before:i64=db.query_row("SELECT COUNT(*) FROM cursors",[],|r|r.get(0)).unwrap();let(_,errors)=apply(&mut db,"vm",&serde_json::to_vec(&bad).unwrap());assert!(!errors.is_empty());assert_eq!(before,db.query_row("SELECT COUNT(*) FROM cursors",[],|r|r.get::<_,i64>(0)).unwrap());
    // Bounded pages retain state and eventually backfill remaining usage.
    let mut paged=header;for i in 0..4001 {paged+=&line("turn_context",json!({"model":"gpt-test"}),i+10);}paged+=&token(300);
    fs::write(logs.join("sessions/rollout-paged.jsonl"),paged).unwrap();let bytes=read(&db,"vm");let(_,errors)=apply(&mut db,"vm",&bytes);assert!(errors.iter().any(|e|e.contains("补采")));
    let bytes=read(&db,"vm");assert_eq!(apply(&mut db,"vm",&bytes).0,1);assert_eq!(report().totals.tokens.total,540);
    assert_eq!(report().daily.iter().map(|g|g.tokens.total).sum::<u64>(),540);
    for host in ["-oProxyCommand=bad","vm;bad","vm\nother","user@host"] {assert!(ssh::validate(host,"").is_err());}
    assert!(ssh::validate("vm-01","/home/user/.codex").is_ok());assert!(ssh::validate("vm","relative/path").is_err());
    // Existing compressed/legacy packets carry remote metrics through the same
    // ledger, with a selectable fallback device name on older peers.
    let peer=root.join("peer");fs::create_dir_all(&peer).unwrap();for(_,packet)in activity::cloud_packets(&data).unwrap(){activity::import_cloud_packet(&peer,packet.as_bytes()).unwrap();}
    let peer_report=activity::report(&peer,None,None,None).unwrap();assert_eq!(peer_report.totals.tokens.total,540);assert!(peer_report.devices.iter().any(|d|d.id==remote));
    // Exclusion is a read policy, never deletion, including explicit device views.
    let mut options=activity::options(&data);
    let saved=serde_json::to_value(&options).unwrap();let mut legacy=saved.clone();legacy.as_object_mut().unwrap().remove("codexSshDevices");legacy["codexSshHost"]=json!("vm");
    let legacy:activity::Options=serde_json::from_value(legacy).unwrap();assert!(legacy.ssh_devices()[0].included);
    options.codex_ssh_host="vm".into();options.codex_ssh_devices=Some(vec![]);assert!(options.ssh_devices().is_empty());
    options.codex_ssh_devices=Some(vec![ssh::Device{host:"must-never-connect".into(),home:String::new(),device_id:remote.into(),name:"synthetic".into(),included:false,aliases:vec!["vm".into()]}]);
    activity::save_options(&data,&options).unwrap();
    let before:i64=db.query_row("SELECT COUNT(*) FROM metrics",[],|r|r.get(0)).unwrap();
    let mut off=options.ssh_devices();let mut errors=vec![];assert_eq!(ssh::collect_devices(&mut db,&mut off,&mut errors),0);assert!(errors.is_empty());
    let mut changed=off[0].clone();changed.device_id=uuid::Uuid::new_v4().to_string();
    assert!(ssh::apply_device(&mut db,&mut changed,&bytes,&mut errors).unwrap_err().contains("设备标识已变化"));
    assert_eq!(report().totals.tokens.total,0);assert_eq!(report().totals.calls,0);assert!(report().daily.is_empty());
    assert_eq!(activity::report(&data,Some(remote.into()),None,None).unwrap().totals.tokens.total,0);
    assert_eq!(activity::usage_summary(&data).unwrap().total,0);
    assert_eq!(before,db.query_row("SELECT COUNT(*) FROM metrics",[],|r|r.get::<_,i64>(0)).unwrap());
    options.codex_ssh_devices.as_mut().unwrap()[0].included=true;activity::save_options(&data,&options).unwrap();
    assert_eq!(report().totals.tokens.total,540);assert_eq!(activity::usage_summary(&data).unwrap().total,540);
    assert_eq!(activity::report(&peer,None,None,None).unwrap().totals.tokens.total,540);
    println!("PASS SSH projections: privacy whitelist, original identity/delta parity, incremental reads, incomplete tails, truncation, copied logs/aliases, cursor rollback, bounded historical pages, remote owner sync and injection validation");
}
