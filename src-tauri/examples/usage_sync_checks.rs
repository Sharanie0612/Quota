//! Isolated two-device fixtures. No cloud account, personal data or credentials.
use quota_lib::{activity, usage_fx, usage_sync, vendor_costs::{self, Expense}};
use serde_json::{json, Value};
use std::{fs, path::Path};
const A: &str = "00000000-0000-4000-8000-000000000001";
const B: &str = "00000000-0000-4000-8000-000000000002";
fn setup(dir: &Path, shared: &Path, device: &str) {
    fs::create_dir_all(dir).unwrap();
    let mut o = activity::options(dir); o.device_id=device.into();o.auto_collect=false;o.sync_dir=shared.to_string_lossy().into();
    o.codex_home=dir.join("none").to_string_lossy().into();o.zcode_home=o.codex_home.clone();
    activity::save_options(dir,&o).unwrap();
}
fn bill(from: &str, to: &str, amount: f64) -> Expense {
    Expense { vendor:"custom".into(),from:from.into(),to:to.into(),currency:"USD".into(),subscription:Some(amount),usage:None,plan_id:None }
}
fn data(dir:&Path,name:&str)->Value { serde_json::from_slice(&fs::read(dir.join(name)).unwrap()).unwrap() }
fn sync(a:&Path,b:&Path) { usage_sync::exchange(a).unwrap();usage_sync::exchange(b).unwrap();usage_sync::exchange(a).unwrap(); }
fn main() {
    let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("target/usage-sync-checks").join(uuid::Uuid::new_v4().to_string());
    let a=root.join("a");let b=root.join("b");let shared=root.join("shared");
    setup(&a,&shared,A);setup(&b,&shared,B);
    let first=bill("2026-09-01","2026-09-30",20.0);
    vendor_costs::save_expense(&a,first.clone()).unwrap();
    usage_fx::save_manual(&a,"2026-09",Some(7.1)).unwrap();
    // Existing finance data is migrated without an extra Token ledger.
    let id="00000000-0000-4000-8000-000000000011";
    let mut file=data(&a,"vendor-costs.json");file["samples"]=json!({id:[{"at":1790000000,"currency":"USD","recharge":100.0,"spend":25.0},{"at":1790000100,"currency":"USD","recharge":100.0,"spend":30.0}]});
    fs::write(a.join("vendor-costs.json"),file.to_string()).unwrap();
    sync(&a,&b);
    assert_eq!(data(&a,"vendor-costs.json"),data(&b,"vendor-costs.json"));
    assert_eq!(data(&b,"monthly-usage-fx.json")["2026-09"]["cnyPerUsd"],7.1);
    let packet=shared.join(format!("quota-usage-v1/{A}.json"));
    let text=fs::read_to_string(&packet).unwrap();
    assert!(!text.contains("tokens")&&!text.contains("events")&&!text.contains("codexHome")&&!text.contains("label"));
    assert!(!a.join("activity.sqlite").exists());
    // Associated accounts can use the same immutable observations despite
    // retaining different local display IDs on the two computers.
    let local_id="00000000-0000-4000-8000-000000000012";
    fs::write(b.join("account-sync-state.json"),json!({"records":{},"hidden":[],"associations":[{"source":id,"target":local_id,"provider":"deepseek"}]}).to_string()).unwrap();
    std::env::set_var("QUOTA_DATA_DIR",&b);
    let store=quota_lib::Store::new().unwrap();let mut config=store.load_config();
    config.accounts=vec![serde_json::from_value(json!({"id":local_id,"provider":"deepseek","label":"Synthetic","createdAt":"2026-01-01T00:00:00Z"})).unwrap()];
    let state=quota_lib::AppState::new(store,config,vec![]);
    let report=vendor_costs::report(&state,"2026-01-01","2026-12-31").unwrap();
    assert_eq!(report.accounts[0].observed_spend,Some(5.0));
    let stale=fs::read(&packet).unwrap();
    // A deletion tombstone prevents old snapshots from restoring the bill.
    let mut deletion=first.clone();deletion.subscription=None;
    vendor_costs::save_expense(&b,deletion).unwrap();usage_fx::save_manual(&b,"2026-09",None).unwrap();
    sync(&b,&a);
    fs::write(&packet,&stale).unwrap();usage_sync::exchange(&b).unwrap();usage_sync::exchange(&a).unwrap();
    assert_eq!(data(&a,"vendor-costs.json")["expenses"],json!({}));
    assert_eq!(data(&b,"monthly-usage-fx.json"),json!({}));
    // Independent offline additions survive both directions and repeated sync.
    vendor_costs::save_expense(&a,first.clone()).unwrap();
    let october=bill("2026-10-01","2026-10-31",40.0);
    vendor_costs::save_expense(&b,october.clone()).unwrap();sync(&a,&b);
    let settled=data(&a,"vendor-costs.json");assert_eq!(settled["expenses"].as_object().unwrap().len(),2);
    for _ in 0..3 { sync(&b,&a); }
    assert_eq!(settled,data(&a,"vendor-costs.json"));
    // Same-key concurrent changes converge by logical clock then device UUID.
    let mut edit=first.clone();edit.subscription=Some(21.0);vendor_costs::save_expense(&a,edit).unwrap();
    let mut edit=first.clone();edit.subscription=Some(22.0);vendor_costs::save_expense(&b,edit).unwrap();sync(&a,&b);
    assert_eq!(data(&a,"vendor-costs.json"),data(&b,"vendor-costs.json"));
    // Date changes publish the old-key deletion and new bill together.
    let original:Expense=serde_json::from_value(data(&b,"vendor-costs.json")["expenses"].as_object().unwrap().values().find(|v|v["from"]=="2026-09-01").unwrap().clone()).unwrap();
    let moved=bill("2026-08-01","2026-08-31",23.0);
    vendor_costs::update_expense(&b,moved.clone(),Some(original)).unwrap();sync(&b,&a);
    assert!(data(&a,"vendor-costs.json")["expenses"].as_object().unwrap().values().all(|e|e["from"]!="2026-09-01"));
    // Separate offline overlapping keys are refused, but a valid rate still imports.
    let c=root.join("c");let d=root.join("d");let conflict=root.join("conflict");setup(&c,&conflict,A);setup(&d,&conflict,B);
    vendor_costs::save_expense(&c,bill("2026-10-01","2026-10-31",10.0)).unwrap();
    vendor_costs::save_expense(&d,bill("2026-10-15","2026-11-14",12.0)).unwrap();
    usage_fx::save_manual(&c,"2026-10",Some(7.2)).unwrap();usage_sync::exchange(&c).unwrap();
    assert!(usage_sync::exchange(&d).unwrap_err().contains("重叠"));
    assert_eq!(data(&d,"vendor-costs.json")["expenses"].as_object().unwrap().len(),1);
    assert_eq!(data(&d,"monthly-usage-fx.json")["2026-10"]["cnyPerUsd"],7.2);
    // Resolving the conflicting local record lets the preserved remote bill retry.
    let mut remove=bill("2026-10-15","2026-11-14",12.0);remove.subscription=None;vendor_costs::save_expense(&d,remove).unwrap();sync(&d,&c);
    assert_eq!(data(&c,"vendor-costs.json"),data(&d,"vendor-costs.json"));
    // Damaged packets do not block healthy data and recover without receipts.
    let bad=shared.join("quota-usage-v1/00000000-0000-4000-8000-000000000003.json");
    fs::write(&bad,"{").unwrap();assert!(usage_sync::exchange(&a).is_err());
    fs::remove_file(&bad).unwrap();sync(&a,&b);
    // Unknown fields (including injected secrets), oversized and corrupt local
    // metadata are rejected before replacing any financial record.
    let prior=fs::read(a.join("vendor-costs.json")).unwrap();
    let mut malicious:Value=serde_json::from_slice(&fs::read(&packet).unwrap()).unwrap();malicious["device"]=json!("00000000-0000-4000-8000-000000000003");malicious["cookie"]=json!("SYNTHETIC_SECRET");
    fs::write(&bad,malicious.to_string()).unwrap();assert!(usage_sync::exchange(&a).is_err());assert_eq!(prior,fs::read(a.join("vendor-costs.json")).unwrap());
    fs::remove_file(&bad).unwrap();
    fs::write(&bad,vec![b' ';8*1024*1024+1]).unwrap();assert!(usage_sync::exchange(&a).unwrap_err().contains("8 MB"));fs::remove_file(&bad).unwrap();
    fs::write(a.join("usage-sync.json"),"{").unwrap();assert!(usage_sync::exchange(&a).is_err());assert_eq!(fs::read_to_string(a.join("usage-sync.json")).unwrap(),"{");
    println!("PASS usage sync: two devices, legacy files, no duplicate Token ledger, samples, rates, deletion tombstones, stale snapshots, offline additions, concurrent edits, moved dates, overlap refusal, independent domains, recovery and strict privacy schema");
}
