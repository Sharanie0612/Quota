//! 应用启动时构造的共享状态，供命令和后台任务使用。

use crate::{
    catalog,
    history::HistoryStore,
    model::{AccountStatus, AppConfig, CatalogEntry},
    pricing, proxy,
    storage::Store,
};
use std::{collections::HashMap, sync::Mutex, time::Duration};

pub struct AppState {
    pub task_cost: crate::task_cost::Feed,
    pub appearance: Mutex<Option<crate::appearance::Preferences>>,
    pub ai_models: Mutex<crate::ai_models::Snapshot>,
    pub ai_models_refreshing: tokio::sync::Mutex<()>,
    pub billing_lock: Mutex<()>,
    pub mimo_login_lock: tokio::sync::Mutex<()>,
    pub mimo_login_generation: std::sync::atomic::AtomicU64,
    pub account_sync_lock: Mutex<()>,
    pub mimo_refresh_lock: tokio::sync::Mutex<()>,
    pub mimo_recovery_attempts: Mutex<HashMap<String, std::time::Instant>>,
    pub activity_lock: Mutex<()>,
    pub ladder: Mutex<crate::ladder::Snapshot>,
    pub ladder_refreshing: Mutex<bool>,
    pub pending_connections: Mutex<HashMap<String, String>>,
    pub store: Store,
    pub http: reqwest::Client,
    pub config: Mutex<AppConfig>,
    pub statuses: Mutex<HashMap<String, AccountStatus>>,
    /// 余额历史（画趋势、估算可用天数、识别充值）
    pub history: Mutex<HistoryStore>,
    /// 内置模型资料库
    pub catalog: Vec<CatalogEntry>,
    /// 本地编辑过的资料库条目
    pub overrides: Mutex<Vec<CatalogEntry>>,
    /// 用户在模型库里手动隐藏的模型 id（本机 hidden_models.json）
    pub hidden_models: Mutex<Vec<String>>,
    /// 低余额通知时间戳，避免重复打扰
    pub low_notified: Mutex<HashMap<String, i64>>,
    /// 第三方参考价缓存：(抓取时间戳, 归一化 id → 价格)
    pub reference_prices: Mutex<Option<(i64, HashMap<String, pricing::RefPrice>)>>,
}

impl AppState {
    pub fn new(store: Store, config: AppConfig, overrides: Vec<CatalogEntry>) -> Self {
        let activity_options = crate::activity::options(store.dir());
        let _ = crate::activity::save_options(store.dir(), &activity_options);
        let hidden_models = store.load_hidden_models();
        let history = HistoryStore::load(store.dir());
        let ai_models = crate::ai_models::load(store.dir());
        let benchmarks = crate::benchmarks::load(store.dir());
        let appearance = crate::appearance::load(store.dir());
        let mut ladder = crate::ladder::load(store.dir());
        crate::ai_models::apply_to_ladder(&mut ladder, &ai_models);
        // 跟随系统代理：reqwest 默认只认环境变量，不读 Windows 系统代理，
        // 否则 Clash 开了系统代理、应用仍然直连，chatgpt.com 这类站点就连不上。
        let http = {
            let mut builder = reqwest::Client::builder()
                .timeout(Duration::from_secs(25))
                .user_agent(concat!("Quota/", env!("CARGO_PKG_VERSION")));
            if let Some(url) = proxy::system_proxy_url() {
                match reqwest::Proxy::all(&url) {
                    Ok(p) => {
                        eprintln!("[Quota] 跟随系统代理：{url}");
                        builder = builder.proxy(p);
                    }
                    Err(e) => eprintln!("[Quota] 系统代理地址无效 {url}：{e}"),
                }
            }
            builder.build().unwrap_or_default()
        };
        Self {
            task_cost: crate::task_cost::Feed::new(store.dir(), &benchmarks),
            appearance: Mutex::new(appearance),
            ai_models: Mutex::new(ai_models),
            ai_models_refreshing: tokio::sync::Mutex::new(()),
            billing_lock: Mutex::new(()),
            mimo_login_lock: tokio::sync::Mutex::new(()),
            mimo_login_generation: std::sync::atomic::AtomicU64::new(0),
            account_sync_lock: Mutex::new(()),
            mimo_refresh_lock: tokio::sync::Mutex::new(()),
            mimo_recovery_attempts: Mutex::new(HashMap::new()),
            activity_lock: Mutex::new(()),
            ladder: Mutex::new(ladder),
            ladder_refreshing: Mutex::new(false),
            pending_connections: Mutex::new(HashMap::new()),
            store,
            http,
            config: Mutex::new(config),
            statuses: Mutex::new(HashMap::new()),
            history: Mutex::new(history),
            catalog: catalog::embedded_file().entries,
            overrides: Mutex::new(overrides),
            hidden_models: Mutex::new(hidden_models),
            low_notified: Mutex::new(HashMap::new()),
            reference_prices: Mutex::new(None),
        }
    }

    pub(crate) fn config_snapshot(&self) -> AppConfig {
        self.config
            .lock()
            .map(|config| config.clone())
            .unwrap_or_default()
    }
}
