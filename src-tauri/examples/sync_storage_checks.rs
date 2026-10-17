//! Synthetic packets only, no OS keyring or personal data.
use quota_lib::activity::{self, sync_storage};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;

fn main() {
    if let Some(source) = std::env::args().nth(1) { snapshot(std::path::Path::new(&source)); return; }
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/sync-storage-checks").join(uuid::Uuid::new_v4().to_string());
    let a = root.join("a"); let b = root.join("b"); let shared = root.join("shared");
    let id = "00000000-0000-4000-8000-000000000001";
    let other = "00000000-0000-4000-8000-000000000002";
    for (dir, device) in [(&a, id), (&b, other)] {
        fs::create_dir_all(dir).unwrap(); let mut o = activity::options(dir);
        o.device_id = device.into(); o.sync_dir = shared.to_string_lossy().into();
        o.codex_home.clear(); o.zcode_home = root.join("no-zcode").to_string_lossy().into();
        activity::save_options(dir, &o).unwrap();
    }
    let own = shared.join("quota-activity-v1").join(id); fs::create_dir_all(&own).unwrap();
    for batch in 0..10 {
        let events: Vec<_> = (0..1000).map(|n| {
            let i = batch * 1000 + n;
            json!({"id":format!("{:x}",Sha256::digest(format!("synthetic-{i}").as_bytes())),"device":id,"source":"codex","session":format!("synthetic-session-{}",i/100),"model":"gpt-synthetic","agent":"主 Agent","tool":"","timestamp":1791072000000_i64+i*1000,"kind":"tokens","tokens":{"input":1000,"cached":700,"cacheWrite":0,"output":100,"reasoning":50,"total":1100},"revision":0})
        }).collect();
        fs::write(own.join(format!("{batch:020}.json")), json!({"schema":1,"device":{"id":id,"name":"Synthetic"},"events":events}).to_string()).unwrap();
    }
    activity::collect(&a).unwrap(); let before = activity::report(&a, None, None, None).unwrap();
    assert_eq!(before.totals.tokens.total, 11_000_000);
    let optimized = sync_storage::optimize(&a).unwrap();
    assert_eq!(optimized.converted, 10); assert_eq!(optimized.after.legacy_files, 0);
    assert!(optimized.after.bytes * 4 < optimized.before.bytes);
    println!("PASS lossless compression: {} -> {} bytes ({:.1}% saved)", optimized.before.bytes, optimized.after.bytes, 100.0 * (1.0 - optimized.after.bytes as f64 / optimized.before.bytes as f64));
    activity::collect(&b).unwrap(); activity::collect(&b).unwrap();
    let report = activity::report(&b, None, None, None).unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors); assert!(report.totals.tokens == before.totals.tokens);
    assert_eq!(report.totals.sessions, before.totals.sessions);
    assert_eq!(sync_storage::optimize(&a).unwrap().converted, 0);
    let db = rusqlite::Connection::open(a.join("activity.sqlite")).unwrap();
    let raw: String = db.query_row("SELECT body FROM metrics LIMIT 1", [], |r| r.get(0)).unwrap();
    let mut event: activity::Metric = serde_json::from_str(&raw).unwrap();
    for n in 1..20 { event.tokens.input += n; event.tokens.total += n; activity::merge_metric(&db, &event, true).unwrap(); }
    let pending: i64 = db.query_row("SELECT COUNT(*) FROM outbox", [], |r| r.get(0)).unwrap(); assert_eq!(pending, 1);
    drop(db); activity::collect(&a).unwrap(); activity::collect(&b).unwrap();
    assert!(activity::report(&a,None,None,None).unwrap().totals.tokens == activity::report(&b,None,None,None).unwrap().totals.tokens);
    // A malformed legacy file must survive optimization unchanged.
    let corrupt = own.join("corrupt.json"); fs::write(&corrupt, b"incomplete-json").unwrap();
    assert!(sync_storage::optimize(&a).is_err()); assert_eq!(fs::read(&corrupt).unwrap(), b"incomplete-json"); fs::remove_file(corrupt).unwrap();
    // A compressed bomb is bounded after expansion and cannot import any events.
    let bomb = zstd::stream::encode_all(vec![b' '; 4 * 1024 * 1024 + 1].as_slice(), 1).unwrap();
    fs::write(own.join("bomb.json.zst"), bomb).unwrap(); activity::collect(&b).unwrap();
    assert!(activity::report(&b,None,None,None).unwrap().errors.iter().any(|e| e.contains("解压后过大")));
    // A broken/undownloaded packet must never block healthy files on another device.
    let peer_folder=shared.join("quota-activity-v1").join(other);fs::create_dir_all(&peer_folder).unwrap();
    let late=peer_folder.join("same-name.json");
    let previous=activity::report(&b,None,None,None).unwrap().totals.tokens.total;
    let mut late_event=event.clone();late_event.id=format!("{:x}",Sha256::digest(b"late-peer"));late_event.source="trae".into();late_event.device=other.into();late_event.tokens=activity::Tokens{input:3,output:2,total:5,..Default::default()};
    let packet=|e:&activity::Metric|json!({"schema":1,"device":{"id":other,"name":"Peer"},"events":[e]}).to_string();
    fs::write(&late,packet(&late_event)).unwrap();activity::collect(&b).unwrap();
    assert_eq!(activity::report(&b,None,None,None).unwrap().totals.tokens.total,previous+5);
    // Legacy writers can update a packet under an existing pathname after restore.
    late_event.tokens.input+=10;late_event.tokens.total+=10;fs::write(&late,packet(&late_event)).unwrap();activity::collect(&b).unwrap();
    assert_eq!(activity::report(&b,None,None,None).unwrap().totals.tokens.total,previous+15);
    activity::collect(&b).unwrap();assert_eq!(activity::report(&b,None,None,None).unwrap().totals.tokens.total,previous+15);
    // Repairing the formerly unreadable file retries it rather than storing a receipt.
    let healed=json!({"schema":1,"device":{"id":id,"name":"Owner"},"events":[]}).to_string();
    fs::write(own.join("bomb.json.zst"),zstd::stream::encode_all(healed.as_bytes(),1).unwrap()).unwrap();activity::collect(&b).unwrap();
    assert!(activity::report(&b,None,None,None).unwrap().errors.is_empty());
    assert!(sync_storage::readers(&b).unwrap().iter().all(|r|r.compressed==Some(true)));
    // Simulate an older peer, restore raw history and prove a JSON-only reader
    // can reconstruct every metric without compression support.
    fs::remove_file(peer_folder.join("reader.capability")).unwrap();
    activity::collect(&a).unwrap();
    assert!(sync_storage::inspect(&a).unwrap().legacy_compatibility);
    assert!(sync_storage::optimize(&a).is_err());
    let mut json_only=std::collections::BTreeMap::new();
    for item in fs::read_dir(&own).unwrap(){let path=item.unwrap().path();if path.extension().is_some_and(|s|s=="json"){
        let packet:serde_json::Value=serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        for raw in packet["events"].as_array().unwrap(){let e:activity::Metric=serde_json::from_value(raw.clone()).unwrap();
            let prior=json_only.entry(e.id.clone()).or_insert(e.clone());if e.revision>prior.revision||e.tokens.total>prior.tokens.total{*prior=e;}
        }
    }}
    assert_eq!(json_only.len(),10000);
    assert_eq!(json_only.values().map(|e|e.tokens.total).sum::<u64>(),11_000_000+190);
    activity::collect(&b).unwrap();assert!(!sync_storage::inspect(&a).unwrap().legacy_compatibility);
    sync_storage::optimize(&a).unwrap();activity::collect(&a).unwrap();activity::collect(&b).unwrap();
    assert!(activity::report(&a,None,None,None).unwrap().totals.tokens==activity::report(&b,None,None,None).unwrap().totals.tokens);
    println!("PASS mixed-version JSON-only reader, compressed history restoration, unknown-peer optimization blocked, automatic compressed-only mode after peer upgrade");
    // Bills persist only for their exact device/source/date/model scope.
    use quota_lib::usage_costs::{self, Rate, Scope, Bill};
    let scope = Scope { device: id.into(), source: "codex".into(), from: "2026-10-01".into(), to: "2026-10-13".into() };
    let rate = Rate { currency:"USD".into(), input:Some(2.0), cached_input:None, cache_write:Some(0.0), output:Some(10.0) };
    usage_costs::save_calculation(&a,"gpt-synthetic".into(),Some(rate.clone()),scope.clone(),Some(Bill {amount:6.0,currency:"USD".into()})).unwrap();
    assert_eq!(usage_costs::bills_for(&a,&scope).unwrap()["gpt-synthetic"].amount,6.0);
    let mut different = scope.clone(); different.source = "harness".into(); assert!(usage_costs::bills_for(&a,&different).unwrap().is_empty());
    let prior = fs::read(a.join("usage-prices.json")).unwrap();
    assert!(usage_costs::save_calculation(&a,"gpt-synthetic".into(),Some(Rate{input:Some(-1.0),..rate.clone()}),scope.clone(),None).is_err());
    assert_eq!(fs::read(a.join("usage-prices.json")).unwrap(),prior);
    usage_costs::save_calculation(&a,"gpt-synthetic".into(),None,scope.clone(),None).unwrap();
    assert!(usage_costs::bills_for(&a,&scope).unwrap().is_empty()); assert!(usage_costs::load_settings(&a).unwrap().rates.is_empty());
    println!("PASS compressed peer sync, repeat import dedup, unchanged sessions, revision queue coalescing, idempotent optimization, corrupt-file preservation, bounded decompression");
    println!("PASS local rate/bill persistence, exact scope separation, invalid input preserves file, atomic reset");
    println!("PASS bad packet isolation, later healthy packet import, content-based receipts, same-path update, repaired-file retry, reader capability announcement");
    // Cleanup is restricted to this newly created fixture root.
    let resolved = root.canonicalize().unwrap();
    assert!(resolved.starts_with(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target").canonicalize().unwrap()));
    fs::remove_dir_all(resolved).unwrap();
}

fn snapshot(source: &std::path::Path) {
    // Read a real directory into an isolated fixture; never rewrite source packets.
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/sync-storage-snapshot").join(uuid::Uuid::new_v4().to_string());
    let dir = root.join("viewer"); let shared = root.join("shared"); let destination = shared.join("quota-activity-v1");
    fs::create_dir_all(&dir).unwrap(); fs::create_dir_all(&destination).unwrap();
    let mut copied = 0;
    for device in fs::read_dir(source).unwrap() {
        let device = device.unwrap();
        if !device.file_type().unwrap().is_dir() || device.file_type().unwrap().is_symlink() { continue; }
        let id = device.file_name().to_string_lossy().into_owned(); if uuid::Uuid::parse_str(&id).is_err() { continue; }
        let target = destination.join(&id); fs::create_dir_all(&target).unwrap();
        for file in fs::read_dir(device.path()).unwrap() {
            let file = file.unwrap();
            let name=file.file_name().to_string_lossy().into_owned();
            if !file.file_type().unwrap().is_file() || file.file_type().unwrap().is_symlink() || !(name.ends_with(".json") || name.ends_with(".json.zst")) { continue; }
            assert!(file.metadata().unwrap().len() <= 4 * 1024 * 1024);
            fs::copy(file.path(), target.join(file.file_name())).unwrap(); copied += 1;
        }
    }
    assert!(copied > 0);
    let mut o = activity::options(&dir); o.sync_dir = shared.to_string_lossy().into();
    o.codex_home.clear(); o.zcode_home = root.join("no-zcode").to_string_lossy().into();
    activity::save_options(&dir,&o).unwrap(); activity::collect(&dir).unwrap();
    let before = activity::report(&dir,None,None,None).unwrap(); assert!(before.errors.is_empty(),"{:?}",before.errors);
    let size = sync_storage::inspect(&dir).unwrap();
    // Space optimization represents all devices upgraded; announce capabilities
    // in the isolated copy only. The real source remains unchanged.
    for item in fs::read_dir(&destination).unwrap(){let item=item.unwrap();let id=item.file_name().to_string_lossy().into_owned();
        fs::write(item.path().join("reader.capability"),json!({"schema":1,"device":id,"version":"1.0.1600","compressed":true}).to_string()).unwrap();
    }
    for device in fs::read_dir(&destination).unwrap() {
        o.device_id = device.unwrap().file_name().to_string_lossy().into(); activity::save_options(&dir,&o).unwrap();
        sync_storage::optimize(&dir).unwrap();
    }
    let after_size = sync_storage::inspect(&dir).unwrap();
    let peer = root.join("peer"); fs::create_dir_all(&peer).unwrap();
    o.device_id=uuid::Uuid::new_v4().to_string(); activity::save_options(&peer,&o).unwrap(); activity::collect(&peer).unwrap();
    let after = activity::report(&peer,None,None,None).unwrap(); assert!(after.errors.is_empty(),"{:?}",after.errors);
    assert!(before.totals.tokens == after.totals.tokens); assert_eq!(before.totals.calls,after.totals.calls); assert_eq!(before.totals.sessions,after.totals.sessions);
    assert_eq!(serde_json::to_value(&before.models).unwrap(),serde_json::to_value(&after.models).unwrap());
    assert_eq!(serde_json::to_value(&before.by_device).unwrap(),serde_json::to_value(&after.by_device).unwrap());
    println!("PASS real-data snapshot: {} files, {} -> {} bytes, {:.2}% saved; all token components, model/device subtotals, tools and sessions unchanged; source directory untouched",copied,size.bytes,after_size.bytes,100.0*(1.0-after_size.bytes as f64/size.bytes as f64));
    let resolved=root.canonicalize().unwrap(); assert!(resolved.starts_with(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target").canonicalize().unwrap()));
    fs::remove_dir_all(resolved).unwrap();
}
