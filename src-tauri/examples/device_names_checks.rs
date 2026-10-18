//! Synthetic device descriptors only. No SSH, credentials, personal data or network.
use quota_lib::activity::{self, ssh};
use rusqlite::{params,Connection};
use serde_json::{json,Value};
use std::{fs,path::Path};

fn setup(dir:&Path,id:&str,shared:&Path){
    fs::create_dir_all(dir).unwrap();let mut options=activity::options(dir);
    options.device_id=id.into();options.device_name="Windows Work".into();options.auto_collect=false;
    options.codex_home.clear();options.zcode_home.clear();options.harness_home.clear();options.trae_enabled=false;
    options.sync_dir=shared.to_string_lossy().into();options.codex_ssh_devices=Some(vec![]);
    activity::save_options(dir,&options).unwrap();activity::report(dir,None,None,None).unwrap();
}
fn main(){
    let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("target/device-names-checks").join(uuid::Uuid::new_v4().to_string());
    let a=root.join("a");let b=root.join("b");let old=root.join("old");let shared=root.join("shared");
    let ids=["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003","00000000-0000-4000-8000-000000000004"];
    setup(&a,ids[0],&shared);setup(&b,ids[1],&shared);setup(&old,ids[1],Path::new(""));
    let db=Connection::open(a.join("activity.sqlite")).unwrap();
    for (index,remote) in ids[2..].iter().enumerate(){
        let metric:activity::Metric=serde_json::from_value(json!({"id":format!("{:064x}",index+1),"device":remote,"source":"codex","session":format!("session-{index}"),"model":"gpt-check","agent":"main","tool":"","timestamp":chrono::Local::now().timestamp_millis(),"kind":"tokens","tokens":{"input":100,"output":20,"cached":50,"cacheWrite":0,"reasoning":0,"total":120}})).unwrap();
        activity::merge_metric(&db,&metric,true).unwrap();
    }
    let mut options=activity::options(&a);
    options.codex_ssh_devices=Some(ids[2..].iter().enumerate().map(|(index,id)|ssh::Device{device_id:(*id).into(),name:format!("ubuntu-{}",index+1),host:format!("private-alias-{}",index+1),aliases:vec![format!("alias-secret-{}",index+1)],home:"/private/log/path".into(),included:true}).collect());
    activity::save_options(&a,&options).unwrap();
    let packets=activity::cloud_packets(&a).unwrap();assert_eq!(packets.len(),1);
    let bytes=&packets[0].1;
    for private in ["private-alias","alias-secret","/private/log/path","included"]{assert!(!bytes.contains(private));}
    let packet:Value=serde_json::from_str(bytes).unwrap();assert_eq!(packet["devices"].as_array().unwrap().len(),2);
    let mut legacy=packet.clone();legacy.as_object_mut().unwrap().remove("devices");
    activity::import_cloud_packet(&old,legacy.to_string().as_bytes()).unwrap();
    assert!(activity::report(&old,None,None,None).unwrap().devices.iter().filter(|d|ids[2..].contains(&d.id.as_str())).all(|d|d.name=="远程采集设备"));
    assert_eq!(activity::import_cloud_packet(&old,bytes.as_bytes()).unwrap(),0);
    let named=activity::report(&old,None,None,None).unwrap();assert_eq!(named.totals.tokens.total,240);assert_eq!(named.by_device.len(),2);
    for (index,id) in ids[2..].iter().enumerate(){assert_eq!(named.devices.iter().find(|d|d.id==*id).unwrap().name,format!("SSH · ubuntu-{}",index+1));}
    let mut bad=packet.clone();bad["devices"][0]["name"]=json!("bad\nname");assert!(activity::import_cloud_packet(&old,bad.to_string().as_bytes()).is_err());
    // Store exact names as collected by SSH, then remove connections before exercising sync.
    for (index,id) in ids[2..].iter().enumerate(){db.execute("UPDATE devices SET name=?1 WHERE id=?2",params![format!("SSH · ubuntu-{}",index+1),id]).unwrap();}
    drop(db);options.codex_ssh_devices=Some(vec![]);activity::save_options(&a,&options).unwrap();
    activity::collect(&a).unwrap();activity::collect(&b).unwrap();
    let peer=activity::report(&b,None,None,None).unwrap();assert_eq!(peer.totals.tokens.total,240);assert_eq!(peer.by_device.len(),2);
    assert_eq!(peer.devices.iter().find(|d|d.id==ids[2]).unwrap().name,"SSH · ubuntu-1");
    let db=Connection::open(a.join("activity.sqlite")).unwrap();db.execute("UPDATE devices SET name='SSH · renamed-work' WHERE id=?1",[ids[2]]).unwrap();drop(db);
    // No new metrics: changed names must still reach the peer, with the same counts.
    activity::collect(&a).unwrap();activity::collect(&b).unwrap();let peer=activity::report(&b,None,None,None).unwrap();
    assert_eq!(peer.devices.iter().find(|d|d.id==ids[2]).unwrap().name,"SSH · renamed-work");assert_eq!(peer.totals.tokens.total,240);
    println!("PASS independent named SSH devices, old/new packet repair, directory name refresh, unchanged totals, invalid name rejection and local connection privacy");
}
