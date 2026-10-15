use quota_lib::activity::{self, Options};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};

fn line(v: Value) -> String { v.to_string() + "\n" }
fn header(id: &str, seeded: bool, version: u32) -> String { line(json!({"type":"session","version":version,"id":id,"createdAt":1791000000000i64,"isSeeded":seeded,"delegationDepth":0})) }
fn event(kind: &str, seq: u64, data: Value) -> String { line(json!({"type":kind,"seq":seq,"time":1791000000000i64+seq as i64,"data":data})) }
fn usage(input: u64, cached: u64, write: u64, output: u64) -> Value { json!({"inputTokens":input,"cacheReadTokens":cached,"cacheWriteTokens":write,"outputTokens":output,"reasoningTokens":0,"totalTokens":input+cached+write+output}) }
fn report(dir: &Path) -> activity::Report { activity::report(dir,None,Some("harness".into()),None).unwrap() }
fn put(root: &Path, folder: &str, name: &str, bytes: &[u8]) { let dir=root.join(folder);fs::create_dir_all(&dir).unwrap();fs::write(dir.join(name),bytes).unwrap(); }
fn frame(bytes: &[u8]) -> Vec<u8> { let mut encoder=zstd::stream::write::Encoder::new(Vec::new(),1).unwrap();encoder.include_checksum(true).unwrap();encoder.write_all(bytes).unwrap();encoder.finish().unwrap() }
fn setup(dir: &Path, logs: &Path, shared: &Path, device: &str) {
    fs::create_dir_all(dir).unwrap();
    activity::save_options(dir,&Options { device_id:device.into(),device_name:device.into(),auto_collect:false,collect_interval_seconds:30,sync_accounts:true,codex_home:dir.join("absent").to_string_lossy().into(),zcode_home:dir.join("absent").to_string_lossy().into(),harness_home:logs.to_string_lossy().into(),trae_home:dir.join("absent-trae").to_string_lossy().into(),trae_enabled:false,sync_dir:shared.to_string_lossy().into() }).unwrap();
}
fn main() {
    let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("target/harness-checks").join(uuid::Uuid::new_v4().to_string());
    legacy_checks(&root.join("legacy"));
    let logs=root.join("logs"); let local=root.join("local"); let remote=root.join("remote"); let shared=root.join("shared");
    let device="00000000-0000-4000-8000-000000000001";
    setup(&local,&logs,&shared,device);
    let context=event("request/context",0,json!({"model":"deepseek-v4","provider":"deepseek"}));
    let attempt=event("assistant/attempt",1,json!({"turn":0,"step":0,"stream":[{"type":"chunk","time":1791000000000i64,"chunk":{"type":"usage","usage":usage(1,0,0,1)}},{"type":"chunk","time":1791000000001i64,"chunk":{"type":"usage","usage":usage(100,20,10,50)}}]}));
    let retry=event("llm/retry-started",2,json!({"turn":0,"step":0}));
    let message=event("assistant/message",3,json!({"turn":0,"step":0,"usage":usage(60,10,0,20),"message":{"source":{"provider":"deepseek","model":"deepseek-v4"},"content":"PRIVATE_MESSAGE"},"stream":[{"type":"chunk","time":1791000000003i64,"chunk":{"type":"usage","usage":usage(999,0,0,999)}}]}));
    let tool=event("tool/call",4,json!({"callId":"call-a","name":"read_file","arguments":"PRIVATE_ARGUMENT"}));
    let initial=header("session-a",false,4)+&context+&attempt+&retry+&message+&tool;
    put(&logs,"project/a","session.v4.jsonl",initial.as_bytes());
    activity::collect(&local).unwrap();let r=report(&local);assert_eq!(r.totals.tokens.total,270);assert_eq!(r.totals.tokens.input,200);assert_eq!(r.totals.tokens.cached,30);assert_eq!(r.totals.calls,1);
    assert_eq!(activity::collect(&local).unwrap(),0);
    // Append a replacing sample with LOWER usage. Latest revision wins, including after sync.
    let replacement=event("assistant/message",5,json!({"turn":0,"step":0,"usage":usage(40,0,0,10),"stream":[]}));
    fs::OpenOptions::new().append(true).open(logs.join("project/a/session.v4.jsonl")).unwrap().write_all(replacement.as_bytes()).unwrap();
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,230);
    // An older copied log cannot resurrect the replaced count.
    put(&logs,"old-copy/a","session.v4.jsonl",initial.as_bytes());
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,230);
    // Inherited fork records do not count again; only child-owned work after the boundary.
    let fork=header("session-b",true,4)+&context+&attempt+&retry+&message+&tool+&event("session/end-seed",5,json!({"inherited":true}))+&event("assistant/message",6,json!({"turn":1,"step":0,"usage":usage(5,5,0,2),"stream":[]}));
    put(&logs,"project/b","session.v4.jsonl",fork.as_bytes());
    // Default compression is concatenated independent frames, with a superseded v3 beside v4.
    let compressed_header=header("session-c",false,4)+&context;
    let compressed_body=event("assistant/message",1,json!({"turn":0,"step":0,"usage":usage(10,0,0,2),"stream":[]}));
    let mut compressed=zstd::stream::encode_all(compressed_header.as_bytes(),1).unwrap();compressed.extend(zstd::stream::encode_all(compressed_body.as_bytes(),1).unwrap());
    put(&logs,"project/c","session.v4.jsonl.zstd",&compressed);
    let old=header("session-c",false,3)+&context+&event("assistant/message",1,json!({"turn":0,"step":0,"usage":usage(999,0,0,999),"stream":[]}));
    put(&logs,"project/c","session.v3.jsonl.zstd",&zstd::stream::encode_all(old.as_bytes(),1).unwrap());
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,254);assert_eq!(report(&local).totals.sessions,3);
    // Torn raw tail is ignored until the newline completes the record.
    let tail=event("assistant/message",2,json!({"turn":1,"step":0,"usage":usage(3,0,0,1),"stream":[]}));
    let raw=header("session-d",false,2)+&context+tail.trim_end();put(&logs,"project/d","session.v2.jsonl",raw.as_bytes());
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,254);
    fs::OpenOptions::new().append(true).open(logs.join("project/d/session.v2.jsonl")).unwrap().write_all(b"\n").unwrap();
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,258);
    // Highest unknown generation refuses fallback to an older generation.
    put(&logs,"project/e","session.v4.jsonl",(header("session-e",false,4)+&context+&compressed_body).as_bytes());
    put(&logs,"project/e","session.v5.jsonl",header("session-e",false,5).as_bytes());
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,258);assert!(!report(&local).errors.is_empty());
    // Recover complete decoded rows in a torn final checksummed frame, but reject checksum corruption.
    let mut torn=frame((header("session-f",false,4)+&context).as_bytes());let mut last=frame(compressed_body.as_bytes());last.truncate(last.len()-2);torn.extend(last);
    put(&logs,"project/f","session.v4.jsonl.zstd",&torn);activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,270);
    let mut corrupt=frame((header("session-g",false,4)+&context+&compressed_body).as_bytes());let last=corrupt.len()-1;corrupt[last]^=0x40;put(&logs,"project/g","session.v4.jsonl.zstd",&corrupt);
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,270);
    setup(&remote,&logs,&shared,"00000000-0000-4000-8000-000000000002");activity::collect(&remote).unwrap();activity::collect(&local).unwrap();assert_eq!(report(&remote).totals.tokens.total,270);assert_eq!(report(&local).by_device.len(),1);
    let db=rusqlite::Connection::open(local.join("activity.sqlite")).unwrap();let mut q=db.prepare("SELECT body FROM metrics").unwrap();for body in q.query_map([],|r|r.get::<_,String>(0)).unwrap(){let text=body.unwrap();assert!(!text.contains("PRIVATE_MESSAGE"));assert!(!text.contains("PRIVATE_ARGUMENT"));}
    // Old settings must preserve device identity when the optional new field is absent.
    let mut previous=serde_json::to_value(activity::options(&local)).unwrap();previous.as_object_mut().unwrap().remove("harnessHome");fs::write(local.join("activity-settings.json"),previous.to_string()).unwrap();assert_eq!(activity::options(&local).device_id,device);assert!(activity::options(&local).harness_home.is_empty());
    println!("PASS Harness: official usage buckets, last stream sample, top-level precedence, retries, downward replacement, copied logs, forks, v2-v4, Zstandard concatenation, torn final frame, checksum rejection, generation selection, raw tail, sync, privacy, settings migration");
}

fn legacy_checks(root: &Path) {
    let local=root.join("local");let logs=root.join("logs");let shared=root.join("shared");
    let device="00000000-0000-4000-8000-000000000001";
    setup(&local,&logs,&shared,device);
    activity::report(&local,None,None,None).unwrap();
    // A pre-upgrade record already in the database must be replaced, and
    // replaying an old cloud packet afterwards must not restore its count.
    let old:activity::Metric=serde_json::from_value(json!({"id":"f".repeat(64),"device":device,"source":"harness","session":"legacy-a","model":"deepseek-v4","agent":"主 Agent","tool":"","timestamp":1791000000000i64,"kind":"tokens","tokens":{"input":999,"output":0,"cached":0,"cacheWrite":0,"reasoning":0,"total":999},"revision":12})).unwrap();
    let db=rusqlite::Connection::open(local.join("activity.sqlite")).unwrap();activity::merge_metric(&db,&old,true).unwrap();
    let legacy_header=|id:&str,version:u32,seed:Option<u64>| {let mut h=json!({"type":"session","version":version,"id":id,"createdAt":1791000000000i64,"delegationDepth":0});if let Some(seed)=seed{h["seedLength"]=json!(seed);}line(h)};
    let context=event("request/context",0,json!({"model":"deepseek-v4"}));
    let packed=line(json!({"type":"text-chunks","seq0":1,"time0":1791000000001i64,"data":{"turn":0,"step":0,"index":0,"dt":[1,1],"texts":["PRIVATE","TEXT","DELTA"]}}));
    let chunk=event("assistant/chunk",4,json!({"turn":0,"step":0,"chunk":{"type":"usage","usage":usage(100,20,10,50)}}));
    let message=event("assistant/message",5,json!({"turn":0,"step":0,"usage":usage(60,10,0,20),"message":{"source":{"model":"deepseek-v4"},"content":"PRIVATE"}}));
    let retry=event("llm/retry-started",6,json!({"turn":0,"step":0}));
    let second=event("assistant/chunk",7,json!({"turn":0,"step":0,"chunk":{"type":"usage","usage":usage(10,0,0,2)}}));
    let tool=event("tool/call",8,json!({"callId":"legacy-tool","name":"read_file","arguments":"PRIVATE"}));
    let body=context.clone()+&packed+&chunk+&message+&retry+&second+&tool;
    put(&logs,"v0","session.jsonl",(legacy_header("legacy-a",0,None)+&body).as_bytes());
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,102);assert_eq!(report(&local).totals.calls,1);
    assert!(!activity::merge_metric(&db,&old,false).unwrap());assert_eq!(report(&local).totals.tokens.total,102);
    put(&logs,"v1-copy","session.v1.jsonl.zstd",&frame((legacy_header("legacy-a",1,None)+&body).as_bytes()));
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,102);
    // The official v1->v2 migration replaces many chunk seqs with one stream
    // event. Attempt identity remains unchanged despite remapped retry seqs.
    let migrated=header("legacy-a",false,2)+&context+&event("assistant/message",1,json!({"turn":0,"step":0,"usage":usage(60,10,0,20)}))+&event("llm/retry-started",2,json!({"turn":0,"step":0}))+&event("assistant/attempt",3,json!({"turn":0,"step":0,"stream":[{"type":"chunk","chunk":{"type":"usage","usage":usage(10,0,0,2)}}]}))+&event("tool/call",4,json!({"callId":"legacy-tool","name":"read_file"}));
    put(&logs,"v2-migrated","session.v2.jsonl",migrated.as_bytes());activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,102);
    // Numeric inheritance counts logical events, not physical packed rows.
    let fork=legacy_header("legacy-fork",0,Some(5))+&context+&packed+&chunk+&event("assistant/message",5,json!({"turn":1,"step":0,"usage":usage(5,0,0,2)}));
    put(&logs,"fork","session.jsonl",fork.as_bytes());activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,109);
    let malformed=packed.replace("[1,1]","[1]");put(&logs,"bad","session.v1.jsonl",(legacy_header("bad",1,None)+&context+&malformed+&chunk).as_bytes());
    activity::collect(&local).unwrap();assert_eq!(report(&local).totals.tokens.total,109);assert!(!report(&local).errors.is_empty());
    let exported=activity::cloud_packets(&local).unwrap();assert!(exported.iter().all(|(_,body)|!body.contains("PRIVATE")));
    println!("PASS Harness legacy: v0/v1 raw and Zstandard, packed sequence spans, streamed usage replacement, retries, numeric inheritance, v2 migration deduplication, legacy metric replacement and stale cloud rejection");
}
