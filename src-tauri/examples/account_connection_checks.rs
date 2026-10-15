//! Uses an isolated in-memory keyring; never opens the OS credential store.
#[path="support/memory_keyring.rs"] mod memory_keyring;
use quota_lib::{account_sync, activity, get_secrets, Account, AppState, Store};
use serde_json::json;
use std::{fs, path::Path};
fn account() -> Account { serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"provider":"mimo","label":"Synthetic","createdAt":"2026-10-01T00:00:00Z","balanceMode":"console","baseUrl":"https://synthetic.invalid"})).unwrap() }
fn state(dir: &Path, accounts: Vec<Account>) -> AppState {
    std::env::set_var("QUOTA_DATA_DIR", dir); let store=Store::new().unwrap();let mut cfg=store.load_config();cfg.accounts=accounts;store.save_config(&cfg).unwrap();
    let mut options=activity::options(dir);options.sync_dir=dir.join("shared").to_string_lossy().into();activity::save_options(dir,&options).unwrap();
    AppState::new(store,cfg,vec![])
}
fn put(id:&str, value:serde_json::Value) { keyring::Entry::new("Quota",id).unwrap().set_password(&value.to_string()).unwrap(); }
fn main() {
    let memory=memory_keyring::MemoryKeyring::default();keyring::set_default_credential_builder(Box::new(memory.clone()));
    let root=std::env::temp_dir().join(format!("quota-connection-check-{}",uuid::Uuid::new_v4()));
    let a=account();let mut b=account();b.base_url=None;b.balance_mode=Some("auto".into());
    let blob=json!({"apiKey":"SYNTHETIC-KEY","adminKey":"SYNTHETIC-ADMIN","accessKeyId":"SYNTHETIC-ID","accessKeySecret":"SYNTHETIC-SECRET","consoleCookie":"SYNTHETIC-COOKIE","subscriptionAccount":"SYNTHETIC-ACCOUNT"});
    put(&a.id,blob.clone());let st=state(&root.join("inherit"),vec![a.clone(),b.clone()]);
    account_sync::resolve(&st,&a.id,Some(&b.id)).unwrap();
    assert!(get_secrets(&a.id).unwrap()==get_secrets(&b.id).unwrap());
    assert_eq!(st.config.lock().unwrap().accounts.len(),1);
    assert_eq!(st.config.lock().unwrap().accounts[0].base_url,a.base_url);
    assert_eq!(st.config.lock().unwrap().accounts[0].balance_mode,a.balance_mode);
    account_sync::sync(&st).unwrap();
    for file in fs::read_dir(root.join("inherit/shared/quota-accounts-v1")).unwrap() {
        let data=fs::read_to_string(file.unwrap().path()).unwrap();assert!(!data.contains("SYNTHETIC-"));assert!(!data.contains("synthetic.invalid"));
    }
    println!("PASS credentials inherited and verified before source removal, connection settings preserved, no secrets in sync files");
    keyring::Entry::new("Quota",&b.id).unwrap().delete_credential().unwrap();
    assert!(!get_secrets(&b.id).unwrap().has_connection());
    let mut opts=activity::options(st.store.dir());opts.sync_accounts=false;activity::save_options(st.store.dir(),&opts).unwrap();
    assert_eq!(account_sync::repair_connections(&st).unwrap(),1);
    assert!(get_secrets(&a.id).unwrap()==get_secrets(&b.id).unwrap());
    assert_eq!(account_sync::repair_connections(&st).unwrap(),0);
    println!("PASS 1.0.1401 orphaned credentials recovered even with directory sync disabled; repeated recovery idempotent");
    let c=account();let d=account();put(&c.id,blob.clone());let fail=state(&root.join("fail"),vec![c.clone(),d.clone()]);
    *memory.fail_write.lock().unwrap()=Some(format!("Quota:{}",d.id));
    assert!(account_sync::resolve(&fail,&c.id,Some(&d.id)).is_err());
    assert_eq!(fail.config.lock().unwrap().accounts.len(),2);assert!(get_secrets(&c.id).unwrap().has_connection());
    *memory.fail_write.lock().unwrap()=None;
    println!("PASS failed credential write leaves both accounts and original login intact");
    put(&d.id,json!({"apiKey":"DIFFERENT-KEY"}));
    account_sync::resolve(&fail,&c.id,Some(&d.id)).unwrap();
    let kept=get_secrets(&d.id).unwrap();assert_eq!(kept.api_key.as_deref(),Some("DIFFERENT-KEY"));assert!(kept.console_cookie.is_none());
    println!("PASS an existing different login is not overwritten or mixed with source credentials");
    let e=account();let f=account();let g=account();put(&e.id,blob.clone());put(&f.id,blob.clone());put(&g.id,json!({"apiKey":"OTHER-ACCOUNT"}));
    let auto=state(&root.join("auto"),vec![e.clone(),f.clone(),g.clone()]);
    assert_eq!(account_sync::repair_connections(&auto).unwrap(),1);assert_eq!(auto.config.lock().unwrap().accounts.len(),2);
    assert_eq!(account_sync::repair_connections(&auto).unwrap(),0);
    let unknown=account();let planner=quota_lib::account_sync::automatic_connection_pairs(&[e.clone(),unknown],&[(e.id.clone(),get_secrets(&e.id).unwrap())].into(),&Default::default());assert!(planner.is_empty());
    println!("PASS same-login duplicate auto-repair, different-login and unknown-login separation; no user pairing needed");
    // Never combine a partial AccessKey from one identity with another identity's secret.
    let x=account();let y=account();put(&x.id,json!({"accessKeyId":"A","accessKeySecret":"SECRET-A"}));put(&y.id,json!({"accessKeyId":"B"}));
    let ak=state(&root.join("access-key"),vec![x.clone(),y.clone()]);account_sync::resolve(&ak,&x.id,Some(&y.id)).unwrap();
    assert_eq!(get_secrets(&y.id).unwrap().access_key_id.as_deref(),Some("B"));assert!(get_secrets(&y.id).unwrap().access_key_secret.is_none());
    println!("PASS AccessKey pairs are never spliced between identities");
    fs::remove_dir_all(root).unwrap();
}
