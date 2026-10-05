//! Navigation policy shared by the Xiaomi login view and its popup requests.

pub fn allows_navigation(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            host == "platform.xiaomimimo.com"
                || host == "account.xiaomi.com"
                || host.ends_with(".account.xiaomi.com")
                // Xiaomi's third-party WeChat sign-in leaves the Xiaomi origin.
                || host == "open.weixin.qq.com"
        })
}
