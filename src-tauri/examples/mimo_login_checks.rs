#[path = "../src/mimo_login.rs"]
mod mimo_login;

fn main() {
    for url in [
        "https://platform.xiaomimimo.com/",
        "https://account.xiaomi.com/pass/serviceLogin?sid=api-platform",
        "https://cn.account.xiaomi.com/pass/sns/login/auth?state=synthetic",
        "https://open.weixin.qq.com/connect/qrconnect?state=synthetic",
        "https://account.xiaomi.com/pass/sns/login/callback?code=synthetic",
        "https://platform.xiaomimimo.com/sts?ticket=synthetic",
    ] {
        assert!(mimo_login::allows_navigation(&url.parse().unwrap()), "blocked: {url}");
    }
    for url in [
        "http://open.weixin.qq.com/connect/qrconnect",
        "https://open.weixin.qq.com.evil.example/",
        "https://evilaccount.xiaomi.com/",
        "https://account.xiaomi.com.evil.example/",
        "https://evil.example/?next=https://open.weixin.qq.com",
        "https://open.weixin.qq.com:8443/",
        "https://user:password@account.xiaomi.com/",
        "javascript:alert(1)",
        "file:///C:/Windows/system.ini",
        "tauri://localhost/",
    ] {
        assert!(!mimo_login::allows_navigation(&url.parse().unwrap()), "allowed: {url}");
    }
    println!("PASS: Xiaomi/WeChat OAuth redirects and login origin isolation (16 cases)");
}
