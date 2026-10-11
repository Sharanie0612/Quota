//! No live login, network, or OS credentials; tests use synthetic cookies and an in-memory keyring.
#[path = "support/memory_keyring.rs"]
mod memory_keyring;
use quota_lib::{get_mimo_session, get_secrets, mimo_session, save_mimo_session};
use tauri::webview::cookie::Cookie;
fn cookie(raw: &str) -> Cookie<'static> {
    Cookie::parse(raw.to_string()).unwrap().into_owned()
}
fn main() {
    let memory = memory_keyring::MemoryKeyring::default();
    keyring::set_default_credential_builder(Box::new(memory.clone()));
    let payload = mimo_session::encode(vec![
        cookie("sid=SYNTHETIC; Domain=account.xiaomi.com; Path=/; Secure; HttpOnly; SameSite=Lax"),
        cookie("api=SYNTHETIC; Domain=platform.xiaomimimo.com; Path=/; Secure"),
        cookie("wechat=OMIT; Domain=open.weixin.qq.com; Path=/"),
    ])
    .unwrap();
    let cookies = mimo_session::decode(&payload).unwrap();
    assert_eq!(cookies.len(), 2);
    assert!(cookies[0].http_only().unwrap());
    assert!(!payload.contains("OMIT"));
    assert!(mimo_session::decode(
        "{\"schema\":1,\"cookies\":[\"x=secret; Domain=evil.example; Path=/\"]}"
    )
    .is_err());
    assert!(mimo_session::decode("{\"schema\":1,\"cookies\":[],\"token\":\"secret\"}").is_err());
    let expired = mimo_session::encode(vec![cookie(
        "old=X; Domain=platform.xiaomimimo.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    )])
    .unwrap();
    assert!(mimo_session::decode(&expired).unwrap().is_empty());
    println!("PASS official cookie scope, HttpOnly/SameSite attributes, expiry and strict session whitelist");
    let mut header = "api=OLD; keep=ONE".to_string();
    let updated =
        mimo_session::merge_header(&mut header, "api=NEW; Path=/; Secure; HttpOnly").unwrap();
    assert!(header.contains("api=NEW"));
    let saved = mimo_session::update(Some(&payload), &[updated]).unwrap();
    assert!(saved.contains("api=NEW"));
    assert!(saved.contains("sid=SYNTHETIC"));
    let before = header.clone();
    assert!(
        mimo_session::merge_header(&mut header, "api=EVIL; Domain=evil.example; Path=/").is_none()
    );
    assert_eq!(header, before);
    let removed = mimo_session::merge_header(&mut header, "api=; Max-Age=0; Path=/").unwrap();
    assert!(!header.contains("api="));
    let cleared = mimo_session::update(Some(&saved), &[removed]).unwrap();
    assert!(!cleared.contains("api=NEW"));
    println!("PASS rotated Set-Cookie updates query and saved session, logout removes cookie, foreign domains ignored");
    let id = uuid::Uuid::new_v4().to_string();
    let large = payload.repeat(100);
    save_mimo_session(&id, &large).unwrap();
    assert_eq!(get_mimo_session(&id).unwrap().unwrap(), large);
    let reference = get_secrets(&id).unwrap().mimo_session;
    save_mimo_session(&id, &payload).unwrap();
    assert_eq!(get_secrets(&id).unwrap().mimo_session, reference);
    assert_eq!(get_mimo_session(&id).unwrap().unwrap(), payload);
    *memory.fail_write.lock().unwrap() = Some("Quota:mimo-session:*".into());
    assert!(save_mimo_session(&id, &large).is_err());
    assert_eq!(get_mimo_session(&id).unwrap().unwrap(), payload);
    *memory.fail_write.lock().unwrap() = None;
    assert!(save_mimo_session(&id, &"X".repeat(65537)).is_err());
    assert!(get_secrets(&id).unwrap().console_cookie.is_none());
    println!("PASS large sessions chunked into OS credential entries, generation replacement, failed writes retain prior session and bounded size");
}
