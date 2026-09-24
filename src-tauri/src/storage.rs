//! 本地持久化：账户配置与设置保存在配置目录的 config.json，
//! 模型资料库的本地覆盖保存在 catalog_overrides.json。
//! API Key 不在这里，见 secrets.rs（系统凭据管理器）。

use crate::model::{AppConfig, CatalogEntry};
use std::fs;
use std::path::{Path, PathBuf};

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new() -> Result<Self, String> {
        let base = dirs::config_dir()
            .ok_or_else(|| "无法定位系统配置目录".to_string())?
            .join("AgentPrice");
        fs::create_dir_all(&base).map_err(|e| format!("创建配置目录失败：{e}"))?;
        Ok(Self { dir: base })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    pub fn load_config(&self) -> AppConfig {
        match fs::read_to_string(self.path("config.json")) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                eprintln!("[AgentPrice] config.json 解析失败，使用默认配置：{e}");
                AppConfig::default()
            }),
            Err(_) => AppConfig::default(),
        }
    }

    pub fn save_config(&self, cfg: &AppConfig) -> Result<(), String> {
        let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败：{e}"))?;
        write_atomic(&self.path("config.json"), &text)
    }

    pub fn load_overrides(&self) -> Vec<CatalogEntry> {
        match fs::read_to_string(self.path("catalog_overrides.json")) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    pub fn save_overrides(&self, entries: &[CatalogEntry]) -> Result<(), String> {
        let text =
            serde_json::to_string_pretty(entries).map_err(|e| format!("序列化资料库失败：{e}"))?;
        write_atomic(&self.path("catalog_overrides.json"), &text)
    }

    pub fn load_hidden_models(&self) -> Vec<String> {
        match fs::read_to_string(self.path("hidden_models.json")) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    pub fn save_hidden_models(&self, ids: &[String]) -> Result<(), String> {
        let text =
            serde_json::to_string_pretty(ids).map_err(|e| format!("序列化隐藏列表失败：{e}"))?;
        write_atomic(&self.path("hidden_models.json"), &text)
    }
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("写入 {} 失败：{e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("保存 {} 失败：{e}", path.display()))?;
    Ok(())
}
