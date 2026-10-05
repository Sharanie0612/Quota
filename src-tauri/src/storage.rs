//! 本地持久化：账户配置与设置保存在配置目录的 config.json，
//! 模型资料库的本地覆盖保存在 catalog_overrides.json。
//! API Key 不在这里，见 secrets.rs（系统凭据管理器）。

use crate::model::{AppConfig, CatalogEntry};
use serde::de::DeserializeOwned;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Store {
    dir: PathBuf,
    // A failed read must never become permission to replace the original with defaults.
    // Keep this protection for the lifetime of the process, even if a file is removed.
    read_issues: Mutex<BTreeMap<String, String>>,
}

impl Store {
    pub fn new() -> Result<Self, String> {
        // Explicit isolated directory for startup checks and portable deployments.
        // Never migrate personal configuration into an override directory.
        if let Some(directory) = std::env::var_os("QUOTA_DATA_DIR") {
            let base = PathBuf::from(directory);
            if !base.is_absolute() { return Err("QUOTA_DATA_DIR 必须是绝对路径".into()); }
            fs::create_dir_all(&base).map_err(|e| format!("创建配置目录失败：{e}"))?;
            return Ok(Self { dir: base, read_issues: Mutex::new(BTreeMap::new()) });
        }
        let config_root = dirs::config_dir().ok_or_else(|| "无法定位系统配置目录".to_string())?;
        let base = config_root.join("Quota");
        fs::create_dir_all(&base).map_err(|e| format!("创建配置目录失败：{e}"))?;
        // legacy compatibility: copy each missing file separately, so a partial migration
        // never overwrites data already written by Quota. Keep the old directory intact.
        let legacy = config_root.join("AgentPrice");
        migrate_file::<AppConfig>(&legacy, &base, "config.json")?;
        migrate_file::<Vec<CatalogEntry>>(&legacy, &base, "catalog_overrides.json")?;
        migrate_file::<Vec<String>>(&legacy, &base, "hidden_models.json")?;
        Ok(Self { dir: base, read_issues: Mutex::new(BTreeMap::new()) })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    pub fn load_config(&self) -> AppConfig {
        self.load_or_default("config.json")
    }

    pub fn save_config(&self, cfg: &AppConfig) -> Result<(), String> {
        self.ensure_file_writable::<AppConfig>("config.json")?;
        let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败：{e}"))?;
        write_atomic(&self.path("config.json"), &text)
    }

    /// 调用方持有配置锁；写盘成功后才替换内存，避免失败或并发更新丢失。
    pub fn update_config(&self, current: &mut AppConfig, mutate: impl FnOnce(&mut AppConfig)) -> Result<(), String> {
        let mut next = current.clone();
        mutate(&mut next);
        self.save_config(&next)?;
        *current = next;
        Ok(())
    }

    pub fn load_overrides(&self) -> Vec<CatalogEntry> {
        self.load_or_default("catalog_overrides.json")
    }

    pub fn save_overrides(&self, entries: &[CatalogEntry]) -> Result<(), String> {
        self.ensure_file_writable::<Vec<CatalogEntry>>("catalog_overrides.json")?;
        let text =
            serde_json::to_string_pretty(entries).map_err(|e| format!("序列化资料库失败：{e}"))?;
        write_atomic(&self.path("catalog_overrides.json"), &text)
    }

    pub fn load_hidden_models(&self) -> Vec<String> {
        self.load_or_default("hidden_models.json")
    }

    pub fn save_hidden_models(&self, ids: &[String]) -> Result<(), String> {
        self.ensure_file_writable::<Vec<String>>("hidden_models.json")?;
        let text =
            serde_json::to_string_pretty(ids).map_err(|e| format!("序列化隐藏列表失败：{e}"))?;
        write_atomic(&self.path("hidden_models.json"), &text)
    }

    pub fn read_issues(&self) -> Vec<String> {
        self.read_issues.lock().map(|issues| issues.values().cloned().collect())
            .unwrap_or_else(|_| vec!["本机资料保护状态不可用，已暂停保存".into()])
    }

    pub fn ensure_config_writable(&self) -> Result<(), String> {
        self.ensure_file_writable::<AppConfig>("config.json")
    }

    /// Preflight before reading credentials for export or mutating them during restore.
    pub fn ensure_core_files_writable(&self) -> Result<(), String> {
        self.ensure_config_writable()?;
        self.ensure_file_writable::<Vec<CatalogEntry>>("catalog_overrides.json")?;
        self.ensure_file_writable::<Vec<String>>("hidden_models.json")
    }

    fn read_json<T: DeserializeOwned + Default>(&self, name: &str) -> Result<T, String> {
        match fs::read(self.path(name)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
                // serde errors can contain values from custom headers/bodies. Never echo them.
                format!("{name} 无法解析（第 {} 行、第 {} 列），已保护原文件；请先备份并修复后重启", error.line(), error.column())
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
            Err(_) => Err(format!("{name} 无法读取，已保护原文件；请检查文件权限或占用，修复后重启")),
        }
    }

    fn remember_issue(&self, name: &str, issue: &str) {
        if let Ok(mut issues) = self.read_issues.lock() {
            issues.insert(name.into(), issue.into());
        }
    }

    fn load_or_default<T: DeserializeOwned + Default>(&self, name: &str) -> T {
        match self.read_json(name) {
            Ok(value) => value,
            Err(issue) => {
                self.remember_issue(name, &issue);
                T::default()
            }
        }
    }

    fn ensure_file_writable<T: DeserializeOwned + Default>(&self, name: &str) -> Result<(), String> {
        if let Some(issue) = self.read_issues.lock().map_err(|_| "本机资料保护状态不可用，已暂停保存")?.get(name).cloned() {
            return Err(issue);
        }
        if let Err(issue) = self.read_json::<T>(name) {
            self.remember_issue(name, &issue);
            return Err(issue);
        }
        Ok(())
    }
}

fn migrate_file<T: DeserializeOwned>(
    legacy: &Path,
    current: &Path,
    name: &str,
) -> Result<(), String> {
    let source = legacy.join(name);
    let destination = current.join(name);
    if destination.exists() || !source.exists() {
        return Ok(());
    }
    let content = fs::read(&source).map_err(|e| format!("读取旧配置 {name} 失败：{e}"))?;
    serde_json::from_slice::<T>(&content)
        .map_err(|e| format!("旧配置 {name} 无法解析，已保留原文件：{e}"))?;
    let temporary = current.join(format!("{name}.migrate.tmp"));
    fs::write(&temporary, content).map_err(|e| format!("迁移 {name} 失败：{e}"))?;
    fs::rename(&temporary, &destination).map_err(|e| format!("完成 {name} 迁移失败：{e}"))?;
    Ok(())
}

pub(crate) fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("写入 {} 失败：{e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("保存 {} 失败：{e}", path.display()))?;
    Ok(())
}
