//! Source identity and local collection workspace. Connection paths never travel
//! with metrics; old settings remain readable and are updated for legacy readers.
use super::{hash, now, Metric, Options};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::Path};

#[path = "activity_readers.rs"]
pub mod readers;
#[path = "activity_remote.rs"]
pub mod remote;

pub const SOFTWARE: &[&str] = &[
    "codex",
    "claude",
    "gemini",
    "cursor",
    "harness",
    "zcode",
    "kimi",
    "qoder",
    "trae",
    "workbuddy",
    "codebuddy",
];
pub fn known_software(value: &str) -> bool {
    SOFTWARE.contains(&value)
}
pub fn legacy_wire(value: &str) -> bool {
    matches!(value, "codex" | "zcode" | "harness" | "trae")
}
pub fn name(value: &str) -> &str {
    match value {
        "codex" => "Codex",
        "claude" => "Claude Code",
        "gemini" => "Gemini CLI",
        "cursor" => "Cursor",
        "harness" => "DeepSeek Harness",
        "zcode" => "ZCode",
        "kimi" => "Kimi Code",
        "qoder" => "Qoder",
        "trae" => "Trae",
        "workbuddy" => "WorkBuddy",
        "codebuddy" => "CodeBuddy",
        "multica" => "Multica",
        _ => value,
    }
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub software: String,
    #[serde(default)]
    pub launcher: String,
    #[serde(default)]
    pub environment: String,
    #[serde(default)]
    pub environment_kind: String,
    #[serde(default)]
    pub access: String,
    #[serde(default)]
    pub parser: String,
    #[serde(default)]
    pub instance: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default = "cache_known")]
    pub cache_known: bool,
    #[serde(default)]
    pub configuration_revision: u64,
}
fn cache_known() -> bool {
    true
}
impl Origin {
    pub fn valid(&self) -> bool {
        self.version == 1
            && known_software(&self.software)
            && matches!(self.launcher.as_str(), "direct" | "multica" | "unknown")
            && matches!(
                self.environment_kind.as_str(),
                "local" | "ssh" | "wsl" | "mounted" | "unknown"
            )
            && matches!(self.access.as_str(), "builtin" | "api" | "unknown")
            && matches!(self.evidence.as_str(), "native" | "configured" | "legacy")
            && [&self.environment, &self.instance]
                .iter()
                .all(|s| s.is_empty() || uuid::Uuid::parse_str(s).is_ok())
            && self.parser.len() <= 64
            && self
                .parser
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    }
    pub fn rank(&self) -> (u64, bool, u8, bool, String) {
        (
            self.configuration_revision,
            self.launcher == "multica",
            match self.evidence.as_str() {
                "native" => 3,
                "configured" => 2,
                _ => 1,
            },
            self.access != "unknown",
            format!(
                "{}:{}:{}:{}",
                self.software, self.environment, self.parser, self.instance
            ),
        )
    }
}
pub fn software(event: &Metric) -> &str {
    event
        .origin
        .as_ref()
        .map(|o| o.software.as_str())
        .filter(|s| known_software(s))
        .unwrap_or(&event.source)
}
pub fn launcher(event: &Metric) -> &str {
    event
        .origin
        .as_ref()
        .map(|o| o.launcher.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(if event.multica { "multica" } else { "unknown" })
}
pub fn access(event: &Metric) -> &str {
    event
        .origin
        .as_ref()
        .map(|o| o.access.as_str())
        .filter(|s| *s != "unknown")
        .unwrap_or(match event.channel.as_str() {
            "trae" => "builtin",
            "api" => "api",
            _ => "unknown",
        })
}
pub fn environment(event: &Metric) -> &str {
    event
        .origin
        .as_ref()
        .map(|o| o.environment.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&event.device)
}
pub fn decorate(event: &mut Metric, instance: &Instance, environment: &Environment, parser: &str) {
    event.origin = Some(Origin {
        version: 1,
        software: instance.software.clone(),
        launcher: instance.launcher.clone(),
        environment: environment.id.clone(),
        environment_kind: environment.kind.clone(),
        access: instance.access.clone(),
        parser: parser.into(),
        instance: instance.id.clone(),
        evidence: "configured".into(),
        cache_known: true,
        configuration_revision: instance.revision,
    });
    if instance.software == "codex" && instance.launcher == "multica" {
        event.multica = true;
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub home: String,
    /// Preserve the existing SSH identity when Codex used a custom home.
    #[serde(default)]
    pub identity_root: String,
    #[serde(default)]
    pub included: bool,
    #[serde(default)]
    pub legacy: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub software: String,
    pub environment: String,
    pub root: String,
    pub enabled: bool,
    #[serde(default = "direct")]
    pub launcher: String,
    #[serde(default = "unknown")]
    pub access: String,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub legacy: bool,
    #[serde(default)]
    pub revision: u64,
}
fn direct() -> String {
    "direct".into()
}
fn unknown() -> String {
    "unknown".into()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub schema: u32,
    pub environments: Vec<Environment>,
    pub instances: Vec<Instance>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub id: &'static str,
    pub name: &'static str,
    pub format: &'static str,
    pub docs: &'static str,
    pub mode: &'static str,
}
pub fn definitions() -> Vec<Definition> {
    vec![
    Definition{id:"codex",name:"Codex",format:"codex-jsonl",docs:"https://github.com/openai/codex",mode:"native"},
    Definition{id:"claude",name:"Claude Code",format:"claude-jsonl",docs:"https://code.claude.com/docs/en/hooks",mode:"native"},
    Definition{id:"gemini",name:"Gemini CLI",format:"gemini-session",docs:"https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts",mode:"native"},
    Definition{id:"kimi",name:"Kimi Code",format:"kimi-wire",docs:"https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/wire/types.py",mode:"native"},
    Definition{id:"cursor",name:"Cursor",format:"cursor-csv",docs:"https://cursor.com/docs/account/usage",mode:"export"},
    Definition{id:"qoder",name:"Qoder",format:"qoder-jsonl",docs:"https://docs.qoder.com/extensions/hooks",mode:"conditional"},
    Definition{id:"workbuddy",name:"WorkBuddy",format:"codebuddy-jsonl",docs:"https://www.codebuddy.ai/docs/cli/stream-json-turn-usage",mode:"bridge"},
    Definition{id:"codebuddy",name:"CodeBuddy",format:"codebuddy-jsonl",docs:"https://www.codebuddy.ai/docs/cli/codebuddy-dir",mode:"native"},
    Definition{id:"harness",name:"DeepSeek Harness",format:"harness",docs:"https://github.com/deepseek-ai/deepseek-harness",mode:"native"},
    Definition{id:"zcode",name:"ZCode",format:"zcode",docs:"https://zcode.z.ai/cn/docs/usage-stats",mode:"native"},
    Definition{id:"trae",name:"Trae",format:"trae",docs:"https://www.trae.ai",mode:"connect"},
]
}
pub fn stable_id(value: &str) -> String {
    let digest = hash(value);
    format!(
        "{}-{}-4{}-8{}-{}",
        &digest[..8],
        &digest[8..12],
        &digest[13..16],
        &digest[17..20],
        &digest[20..32]
    )
}
pub fn default_root(software: &str, home: &Path) -> String {
    match software {
        "claude" => home.join(".claude/projects"),
        "gemini" => home.join(".gemini/tmp"),
        "kimi" => home.join(".kimi/sessions"),
        "qoder" => home.join(".qoder/projects"),
        "codebuddy" => home.join(".codebuddy/projects"),
        _ => return String::new(),
    }
    .to_string_lossy()
    .into()
}
pub fn defaults(o: &Options) -> Workspace {
    let home = dirs::home_dir().unwrap_or_default();
    let mut environments = vec![Environment {
        id: o.device_id.clone(),
        name: o.device_name.clone(),
        kind: "local".into(),
        target: String::new(),
        home: home.to_string_lossy().into(),
        identity_root: String::new(),
        included: true,
        legacy: true,
    }];
    let mut instances = Vec::new();
    for definition in definitions() {
        let legacy = legacy_wire(definition.id);
        let root = match definition.id {
            "codex" => o.codex_home.clone(),
            "zcode" => o.zcode_home.clone(),
            "harness" => o.harness_home.clone(),
            "trae" => o.trae_home.clone(),
            id => default_root(id, &home),
        };
        let enabled = match definition.id {
            "trae" => o.trae_enabled,
            "harness" => !root.is_empty(),
            "cursor" | "workbuddy" => false,
            _ => !root.is_empty(),
        };
        instances.push(Instance {
            id: stable_id(&format!("{}:{}", o.device_id, definition.id)),
            software: definition.id.into(),
            environment: o.device_id.clone(),
            root,
            enabled,
            launcher: direct(),
            access: unknown(),
            format: definition.format.into(),
            legacy,
            revision: 0,
        });
    }
    for device in o.ssh_devices() {
        if device.device_id.is_empty() {
            continue;
        }
        environments.push(Environment {
            id: device.device_id.clone(),
            name: device.name.clone(),
            kind: "ssh".into(),
            target: device.host.clone(),
            home: String::new(),
            identity_root: device.home.clone(),
            included: device.included,
            legacy: true,
        });
        instances.push(Instance {
            id: stable_id(&format!("{}:codex", device.device_id)),
            software: "codex".into(),
            environment: device.device_id,
            root: device.home,
            enabled: true,
            launcher: direct(),
            access: unknown(),
            format: "codex-jsonl".into(),
            legacy: true,
            revision: 0,
        });
    }
    Workspace {
        schema: 1,
        environments,
        instances,
    }
}
pub fn load(dir: &Path, o: &Options) -> Result<Workspace, String> {
    super::options_checked(dir)?;
    match fs::read(dir.join("activity-sources.json")) {
        Ok(bytes) => {
            let mut value: Workspace =
                serde_json::from_slice(&bytes).map_err(|_| "采集来源配置损坏，原文件已保留")?;
            validate(&value)?;
            // Other settings entry points may update these compatible fields.
            for env in value
                .environments
                .iter_mut()
                .filter(|e| e.kind == "local" && e.legacy)
            {
                let old = env.id.clone();
                env.id = o.device_id.clone();
                env.name = o.device_name.clone();
                for source in value.instances.iter_mut().filter(|s| s.environment == old) {
                    source.environment = o.device_id.clone();
                }
            }
            for remote in o.ssh_devices() {
                if let Some(env) = value
                    .environments
                    .iter_mut()
                    .find(|e| e.legacy && e.id == remote.device_id)
                {
                    env.included = remote.included;
                    env.name = remote.name;
                    env.target = remote.host;
                    env.identity_root = remote.home;
                }
            }
            let compatible = defaults(o);
            for env in compatible
                .environments
                .into_iter()
                .filter(|e| e.kind == "ssh")
            {
                if !value.environments.iter().any(|e| e.id == env.id) {
                    value.instances.extend(
                        compatible
                            .instances
                            .iter()
                            .filter(|s| s.environment == env.id)
                            .cloned(),
                    );
                    value.environments.push(env);
                }
            }
            for source in value
                .instances
                .iter_mut()
                .filter(|s| s.legacy && s.environment == o.device_id)
            {
                let root = match source.software.as_str() {
                    "codex" => Some(&o.codex_home),
                    "zcode" => Some(&o.zcode_home),
                    "harness" => Some(&o.harness_home),
                    "trae" => Some(&o.trae_home),
                    _ => None,
                };
                if let Some(root) = root {
                    if !root.is_empty() {
                        source.root = root.clone();
                    }
                    source.enabled = if source.software == "trae" {
                        o.trae_enabled
                    } else {
                        !root.is_empty()
                    };
                }
            }
            validate(&value)?;
            Ok(value)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(defaults(o)),
        Err(_) => Err("无法读取采集来源配置".into()),
    }
}
pub fn validate(value: &Workspace) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    if value.schema != 1 || value.environments.len() > 64 || value.instances.len() > 256 {
        return Err("采集来源配置超过上限或版本不兼容".into());
    }
    for e in &value.environments {
        if uuid::Uuid::parse_str(&e.id).is_err()
            || !ids.insert(e.id.clone())
            || e.name.trim().is_empty()
            || e.name.len() > 320
            || e.name.chars().any(char::is_control)
            || !matches!(
                e.kind.as_str(),
                "local" | "ssh" | "wsl" | "mounted" | "imported"
            )
        {
            return Err("运行环境配置无效".into());
        }
        if e.kind == "ssh" {
            super::ssh::validate(&e.target, &e.identity_root)?;
            if e.target.is_empty() {
                return Err("请填写 SSH 主机别名".into());
            }
        }
        if e.home.len() > 4096
            || e.identity_root.len() > 4096
            || [&e.home, &e.identity_root]
                .iter()
                .any(|v| v.chars().any(char::is_control))
        {
            return Err("环境目录无效".into());
        }
        if matches!(e.kind.as_str(), "ssh" | "wsl")
            && !e.home.is_empty()
            && !e.home.starts_with('/')
        {
            return Err("环境主目录应使用 Linux 绝对路径".into());
        }
        if e.kind == "wsl"
            && (e.target.is_empty()
                || e.target.len() > 128
                || !e
                    .target
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')))
        {
            return Err("WSL 发行版名称无效".into());
        }
    }
    let mut source_ids = BTreeSet::new();
    for s in &value.instances {
        if uuid::Uuid::parse_str(&s.id).is_err()
            || !source_ids.insert(s.id.clone())
            || !known_software(&s.software)
            || !ids.contains(&s.environment)
            || !matches!(s.launcher.as_str(), "direct" | "multica" | "unknown")
            || !matches!(s.access.as_str(), "builtin" | "api" | "unknown")
            || s.root.len() > 4096
            || s.root.chars().any(char::is_control)
        {
            return Err("采集来源配置无效".into());
        }
        let env = value
            .environments
            .iter()
            .find(|e| e.id == s.environment)
            .expect("validated");
        if s.legacy
            && s.enabled
            && s.software != "trae"
            && s.root.is_empty()
            && matches!(env.kind.as_str(), "local" | "mounted")
        {
            return Err(format!("请先选择 {} 日志位置", name(&s.software)));
        }
        if !s.root.is_empty()
            && matches!(env.kind.as_str(), "local" | "mounted")
            && !Path::new(&s.root).is_absolute()
        {
            return Err("本机或挂载目录应使用绝对路径".into());
        }
        if !s.root.is_empty()
            && matches!(env.kind.as_str(), "ssh" | "wsl")
            && !s.root.starts_with('/')
        {
            return Err("远程日志目录应使用 Linux 绝对路径，或留空自动识别".into());
        }
        if !definitions()
            .iter()
            .any(|d| d.id == s.software && d.format == s.format)
        {
            return Err("该软件的采集格式无效".into());
        }
    }
    Ok(())
}
pub fn save(dir: &Path, value: &Workspace) -> Result<(), String> {
    let mut value = value.clone();
    validate(&value)?;
    let mut o = super::options_checked(dir)?;
    let previous = load(dir, &o)?;
    for old in &previous.environments {
        if !value.environments.iter().any(|e| {
            e.id == old.id
                && (e.kind == old.kind
                    || old.kind == "imported"
                        && matches!(e.kind.as_str(), "ssh" | "wsl" | "mounted"))
                && e.legacy == old.legacy
        }) {
            return Err("请取消纳入统计以停用环境，历史配置需保留".into());
        }
    }
    for old in &previous.instances {
        if !value.instances.iter().any(|s| {
            s.id == old.id
                && s.software == old.software
                && s.environment == old.environment
                && s.legacy == old.legacy
        }) {
            return Err("请关闭来源以停止采集，原始配置需保留".into());
        }
    }
    if value
        .instances
        .iter()
        .any(|s| s.legacy && !previous.instances.iter().any(|old| old.id == s.id))
    {
        return Err("新增来源不能使用旧采集接口".into());
    }
    for source in &mut value.instances {
        let old = previous.instances.iter().find(|s| s.id == source.id);
        source.revision = if old
            .is_some_and(|s| s.launcher != source.launcher || s.access != source.access)
            || old.is_none() && (source.launcher != "direct" || source.access != "unknown")
        {
            (now().max(0) as u64).max(old.map_or(0, |s| s.revision.saturating_add(1)))
        } else {
            old.map_or(0, |s| s.revision)
        };
    }
    let old_options = o.clone();
    if let Some(env) = value.environments.iter().find(|e| e.id == o.device_id) {
        o.device_name = env.name.trim().into();
    }
    for s in value
        .instances
        .iter()
        .filter(|s| s.legacy && s.environment == o.device_id)
    {
        match s.software.as_str() {
            "codex" => {
                o.codex_home = if s.enabled {
                    s.root.clone()
                } else {
                    String::new()
                }
            }
            "zcode" => {
                o.zcode_home = if s.enabled {
                    s.root.clone()
                } else {
                    String::new()
                }
            }
            "harness" => {
                o.harness_home = if s.enabled {
                    s.root.clone()
                } else {
                    String::new()
                }
            }
            "trae" => {
                o.trae_home = s.root.clone();
                o.trae_enabled = s.enabled;
            }
            _ => {}
        }
    }
    let mut devices = o.ssh_devices();
    for env in value
        .environments
        .iter()
        .filter(|e| e.legacy && e.kind == "ssh")
    {
        if let Some(d) = devices.iter_mut().find(|d| d.device_id == env.id) {
            d.included = env.included;
            d.name = env.name.clone();
            if d.host != env.target {
                if !d.aliases.contains(&d.host) {
                    d.aliases.push(d.host.clone());
                }
                d.host = env.target.clone();
            }
        }
    }
    o.codex_ssh_devices = Some(devices);
    super::save_options(dir, &o)?;
    let result = crate::storage::write_atomic(
        &dir.join("activity-sources.json"),
        &serde_json::to_string_pretty(&value).map_err(|_| "编码采集来源失败")?,
    );
    if result.is_err() {
        super::save_options(dir, &old_options)
            .map_err(|_| "来源保存未完成，兼容配置回滚失败；请重试保存")?;
    }
    result
}

pub fn local_included(dir: &Path, o: &Options) -> Result<bool, String> {
    Ok(load(dir, o)?
        .environments
        .iter()
        .find(|e| e.id == o.device_id)
        .is_none_or(|e| e.included))
}
pub fn ssh_source_enabled(dir: &Path, o: &Options, device: &str) -> Result<bool, String> {
    let w = load(dir, o)?;
    Ok(w.instances
        .iter()
        .find(|s| s.legacy && s.environment == device && s.software == "codex")
        .is_none_or(|s| s.enabled))
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub instance: String,
    pub state: String,
    pub files: usize,
    pub records: usize,
    pub at: Option<i64>,
    pub message: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairSummary {
    pub changes: u64,
    pub intercepted: u64,
    pub feedback_blocked: u64,
    pub feedback_pending: u64,
    pub removed_tokens: u64,
    pub added_tokens: u64,
    pub unreviewed_codex: u64,
    pub backup: Option<String>,
}
pub fn repair_summary(dir: &Path, db: &Connection) -> RepairSummary {
    let mut result = RepairSummary::default();
    if let Ok(mut q) = db.prepare("SELECT before_total,after_total,rule FROM activity_repairs") {
        if let Ok(rows) = q.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        }) {
            for row in rows.flatten() {
                if row.2.ends_with(":replay-blocked") {
                    result.intercepted += 1;
                    continue;
                }
                result.changes += 1;
                result.removed_tokens += row.0.saturating_sub(row.1).max(0) as u64;
                result.added_tokens += row.1.saturating_sub(row.0).max(0) as u64;
            }
        }
    }
    result.feedback_blocked=db.query_row("SELECT COUNT(*) FROM activity_feedback_aliases WHERE blocked=1",[],|r|r.get::<_,i64>(0)).unwrap_or(0).max(0) as u64;
    result.feedback_pending=db.query_row("SELECT COUNT(*) FROM activity_feedback_aliases WHERE pending=1",[],|r|r.get::<_,i64>(0)).unwrap_or(0).max(0) as u64;
    result.intercepted+=result.feedback_blocked;
    result.unreviewed_codex=db.query_row("SELECT COUNT(*) FROM metrics WHERE json_extract(body,'$.source')='codex' AND json_extract(body,'$.kind')='tokens' AND COALESCE(json_extract(body,'$.codexUsageVersion'),0)=0",[],|r|r.get::<_,i64>(0)).unwrap_or(0).max(0) as u64;
    result.backup = fs::read(dir.join("activity-migration.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v["backup"].as_str().map(String::from));
    result
}
pub fn prepare_migration(dir: &Path, db: &Connection) -> Result<(), String> {
    let marker = dir.join("activity-migration.json");
    if marker.exists() {
        let v: serde_json::Value =
            serde_json::from_slice(&fs::read(&marker).map_err(|_| "读取历史迁移状态失败")?)
                .map_err(|_| "历史迁移状态损坏，原数据已保留")?;
        if v["schema"] != 1 {
            return Err("历史迁移状态版本不兼容，原数据已保留".into());
        }
        if v["backup"].is_string() {
            return Ok(());
        }
    }
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM metrics", [], |r| r.get(0))
        .map_err(|_| "读取历史统计失败")?;
    let backup = if count > 0 {
        let folder = dir.join("activity-backups");
        fs::create_dir_all(&folder).map_err(|_| "无法创建升级前备份目录，未重算历史")?;
        let target = folder.join(format!(
            "before-sources-{}-{}.sqlite",
            now(),
            uuid::Uuid::new_v4()
        ));
        db.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
            .map_err(|_| "升级前统计备份失败，未重算历史")?;
        Some(target.to_string_lossy().into_owned())
    } else {
        None
    };
    crate::storage::write_atomic(
        &marker,
        &serde_json::json!({"schema":1,"at":now(),"backup":backup}).to_string(),
    )
}
pub fn record_repair(db: &Connection, before: &Metric, after: &Metric) -> Result<(), String> {
    if before.tokens == after.tokens {
        return Ok(());
    }
    let known = after.superseded_zcode()
        || after.source == "codex" && after.codex_usage_version > before.codex_usage_version
        || !legacy_wire(&after.source) && after.tokens.total < before.tokens.total;
    if !known {
        return Ok(());
    }
    db.execute_batch("CREATE TABLE IF NOT EXISTS activity_repairs(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,at INTEGER NOT NULL,source TEXT NOT NULL,rule TEXT NOT NULL,before_total INTEGER NOT NULL,after_total INTEGER NOT NULL);").map_err(|_|"建立统计修复记录失败")?;
    let mut rule = if after.superseded_zcode() {
        if after.origin.as_ref().is_some_and(|o|o.parser=="zcode-quota-feedback") {
            "zcode-quota-feedback"
        } else if after.revision == 1 {
            "zcode-fork"
        } else {
            "zcode-modern-alias"
        }
    } else if after.source == "codex" && after.codex_usage_version > before.codex_usage_version {
        "codex-baseline"
    } else {
        "source-settlement"
    }
    .to_string();
    let baseline: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_temp_master WHERE name='activity_repair_baseline')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if baseline
        && !db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM activity_repair_baseline WHERE id=?1)",
                [&after.id],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|_| "读取修复基线失败")?
    {
        rule.push_str(":replay-blocked");
    }
    db.execute("INSERT INTO activity_repairs(event_id,at,source,rule,before_total,after_total) VALUES(?1,?2,?3,?4,?5,?6)",params![after.id,now(),after.source,rule,before.tokens.total as i64,after.tokens.total as i64]).map_err(|_|"保存统计修复记录失败")?;
    Ok(())
}
pub fn begin_collection(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TEMP TABLE IF NOT EXISTS activity_repair_baseline(id TEXT PRIMARY KEY);DELETE FROM activity_repair_baseline;INSERT INTO activity_repair_baseline SELECT id FROM metrics;").map_err(|_|"建立本次修复基线失败".into())
}
pub fn native_origin(
    software: &str,
    device: &str,
    multica: bool,
    kind: &str,
    access: &str,
) -> Origin {
    Origin {
        version: 1,
        software: software.into(),
        launcher: if multica { "multica" } else { "direct" }.into(),
        environment: device.into(),
        environment_kind: kind.into(),
        access: access.into(),
        parser: format!("{software}-native"),
        instance: stable_id(&format!("{device}:{software}")),
        evidence: "native".into(),
        cache_known: true,
        configuration_revision: 0,
    }
}
pub fn excluded(dir: &Path, o: &Options) -> Result<BTreeSet<String>, String> {
    let mut ids = o.excluded_devices();
    let w = load(dir, o)?;
    ids.extend(
        w.environments
            .into_iter()
            .filter(|e| !e.included)
            .map(|e| e.id),
    );
    Ok(ids)
}
/// A peer's selected VM is not consent for this Quota host. Imported source
/// descriptors expose historical selection, never a copied SSH connection.
pub fn adopt_environments(dir: &Path, db: &Connection) -> Result<(), String> {
    let o = super::options_checked(dir)?;
    if !dir.join("activity-settings.json").exists() {
        super::save_options(dir, &o)?;
    }
    let mut w = load(dir, &o)?;
    let mut changed = false;
    let mut statement=db.prepare("SELECT DISTINCT json_extract(body,'$.device') FROM metrics WHERE json_extract(body,'$.origin.environmentKind') IN ('ssh','wsl','mounted') UNION SELECT id FROM devices WHERE name LIKE 'SSH · %'").map_err(|_|"读取同步的运行环境失败")?;
    let ids = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "读取同步的运行环境失败")?;
    for id in ids {
        let id = id.map_err(|_| "读取同步的运行环境失败")?;
        if w.environments.iter().any(|e| e.id == id) {
            continue;
        }
        let name = db
            .query_row("SELECT name FROM devices WHERE id=?1", [&id], |r| {
                r.get::<_, String>(0)
            })
            .unwrap_or_else(|_| format!("环境 {}", &id[..8]));
        w.environments.push(Environment {
            id,
            name: super::label(&name),
            kind: "imported".into(),
            target: String::new(),
            home: String::new(),
            identity_root: String::new(),
            included: false,
            legacy: false,
        });
        changed = true;
    }
    if changed {
        validate(&w)?;
        crate::storage::write_atomic(
            &dir.join("activity-sources.json"),
            &serde_json::to_string_pretty(&w).map_err(|_| "编码同步环境失败")?,
        )?;
    }
    Ok(())
}
pub fn direct_cost(event: &Metric) -> bool {
    if access(event) == "api" {
        return true;
    }
    let own = match software(event) {
        "codex" => "custom",
        "claude" => "anthropic",
        "gemini" => "google",
        "harness" => "deepseek",
        "zcode" => "zhipu",
        "kimi" => "moonshot",
        _ => return false,
    };
    super::model_vendor(&event.model) == own
}
pub fn collect(dir: &Path, db: &mut Connection, o: &Options, errors: &mut Vec<String>) -> usize {
    let workspace = match load(dir, o) {
        Ok(w) => w,
        Err(e) => {
            errors.push(e);
            return 0;
        }
    };
    let mut count = 0;
    let mut statuses = Vec::new();
    let roots: Vec<_> = if o.multica_enabled {
        super::multica::workspace_roots(&o.multica_workspace_root, errors)
            .into_iter()
            .collect()
    } else {
        vec![]
    };
    for env in &workspace.environments {
        if !env.included {
            continue;
        }
        if let Err(_)=db.execute("INSERT INTO devices(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![env.id,env.name]){errors.push("保存运行环境名称失败".into());continue}
        if matches!(env.kind.as_str(), "ssh" | "wsl") {
            let instances: Vec<_> = workspace
                .instances
                .iter()
                .filter(|s| s.environment == env.id && s.enabled && (!s.legacy || s.revision > 0))
                .cloned()
                .collect();
            if !instances.is_empty() {
                match remote::collect(db, env, &instances) {
                    Ok((n, states)) => {
                        count += n;
                        statuses.extend(states);
                    }
                    Err(e) => {
                        errors.push(format!("{}：{e}", env.name));
                        for s in instances {
                            statuses.push(SourceStatus {
                                instance: s.id,
                                state: "error".into(),
                                message: e.clone(),
                                ..Default::default()
                            });
                        }
                    }
                }
            }
            continue;
        }
        for instance in workspace.instances.iter().filter(|s| {
            s.environment == env.id && (!s.legacy || s.revision > 0) && s.software != "trae"
        }) {
            match readers::collect_with_roots(
                db,
                instance,
                env,
                if env.kind == "local" { &roots } else { &[] },
            ) {
                Ok((n, status)) => {
                    count += n;
                    if matches!(status.state.as_str(), "partial" | "error") {
                        errors.push(format!(
                            "{} · {}：{}",
                            env.name,
                            name(&instance.software),
                            status.message
                        ));
                    }
                    statuses.push(status)
                }
                Err(e) => {
                    errors.push(format!("{} · {}：{e}", env.name, name(&instance.software)));
                    statuses.push(SourceStatus {
                        instance: instance.id.clone(),
                        state: "error".into(),
                        message: e,
                        ..Default::default()
                    });
                }
            }
        }
    }
    if let Some(env) = workspace
        .environments
        .iter()
        .find(|e| e.id == o.device_id && e.included)
    {
        for instance in super::multica::owned_sources(o, errors) {
            match readers::collect(db, &instance, env) {
                Ok((n, status)) => {
                    count += n;
                    statuses.push(status)
                }
                Err(e) => errors.push(format!("Multica · {}：{e}", name(&instance.software))),
            }
        }
    }
    if let Err(e) = crate::storage::write_atomic(
        &dir.join("activity-source-status.json"),
        &serde_json::to_string(&statuses).unwrap_or_else(|_| "[]".into()),
    ) {
        errors.push(e)
    }
    count
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReport {
    pub workspace: Workspace,
    pub definitions: Vec<Definition>,
    pub statuses: Vec<SourceStatus>,
    pub errors: Vec<String>,
    pub repair: RepairSummary,
    pub auto_collect: bool,
    pub collect_interval_seconds: u64,
    pub multica_enabled: bool,
    pub multica_workspace_root: String,
}
pub fn workspace_report(dir: &Path) -> Result<WorkspaceReport, String> {
    let o = super::options_checked(dir)?;
    if !dir.join("activity-settings.json").exists() {
        super::save_options(dir, &o)?;
    }
    let workspace = load(dir, &o)?;
    let db = super::database(dir)?;
    let mut statuses: Vec<SourceStatus> = fs::read(dir.join("activity-source-status.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    for s in workspace.instances.iter().filter(|s| s.legacy) {
        if statuses.iter().any(|state| state.instance == s.id) {
            continue;
        }
        let env = workspace
            .environments
            .iter()
            .find(|e| e.id == s.environment)
            .expect("validated");
        let state = if !s.enabled || !env.included {
            "disabled"
        } else if s.software == "trae" {
            "configured"
        } else if env.kind == "ssh" {
            "configured"
        } else if s.root.is_empty() {
            "needs-path"
        } else if Path::new(&s.root).exists() {
            "configured"
        } else {
            "not-found"
        };
        statuses.push(SourceStatus {
            instance: s.id.clone(),
            state: state.into(),
            ..Default::default()
        });
    }
    Ok(WorkspaceReport {
        workspace,
        definitions: definitions(),
        statuses,
        errors: fs::read(dir.join("activity-status.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v.get("errors").cloned())
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        repair: repair_summary(dir, &db),
        auto_collect: o.auto_collect,
        collect_interval_seconds: o.collect_interval_seconds,
        multica_enabled: o.multica_enabled,
        multica_workspace_root: o.multica_workspace_root,
    })
}
#[tauri::command]
pub async fn get_activity_workspace(app: tauri::AppHandle) -> Result<WorkspaceReport, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<crate::AppState>();
        let _guard = state.activity_lock.lock().map_err(|_| "采集设置正在更新")?;
        workspace_report(state.store.dir())
    })
    .await
    .map_err(|_| "读取采集工作区失败")?
}
#[tauri::command]
pub async fn save_activity_workspace(
    app: tauri::AppHandle,
    input: Workspace,
    settings: Option<CollectionSettings>,
) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<crate::AppState>();
        let _guard = state.activity_lock.lock().map_err(|_| "采集设置正在更新")?;
        save_all(state.store.dir(), &input, settings)?;
        let _ = app.emit("activity-updated", ());
        Ok(())
    })
    .await
    .map_err(|_| "保存采集工作区失败")?
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSettings {
    pub auto_collect: bool,
    pub collect_interval_seconds: u64,
    pub multica_enabled: bool,
    pub multica_workspace_root: String,
}
pub fn save_all(
    dir: &Path,
    input: &Workspace,
    settings: Option<CollectionSettings>,
) -> Result<(), String> {
    let before = super::options(dir);
    let old_workspace = fs::read_to_string(dir.join("activity-sources.json")).ok();
    if let Some(s) = &settings {
        if !(5..=3600).contains(&s.collect_interval_seconds)
            || s.multica_workspace_root.len() > 4096
            || !s.multica_workspace_root.is_empty()
                && !Path::new(&s.multica_workspace_root).is_absolute()
        {
            return Err("采集周期或 Multica 工作区无效".into());
        }
    }
    save(dir, input)?;
    if let Some(s) = settings {
        let mut o = super::options(dir);
        o.auto_collect = s.auto_collect;
        o.collect_interval_seconds = s.collect_interval_seconds;
        o.multica_enabled = s.multica_enabled;
        o.multica_workspace_root = s.multica_workspace_root;
        if let Err(error) = super::save_options(dir, &o) {
            super::save_options(dir, &before)?;
            if let Some(old) = old_workspace {
                crate::storage::write_atomic(&dir.join("activity-sources.json"), &old)?;
            } else {
                fs::remove_file(dir.join("activity-sources.json"))
                    .map_err(|_| "回滚采集来源失败")?;
            }
            return Err(error);
        }
    }
    Ok(())
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    #[serde(default)]
    pub software: String,
    #[serde(default)]
    pub launcher: String,
    #[serde(default)]
    pub environment: String,
    #[serde(default)]
    pub access: String,
    #[serde(default)]
    pub vendor: String,
}
impl Filters {
    pub fn matches(&self, e: &Metric) -> bool {
        (self.software.is_empty() || self.software == software(e))
            && (self.launcher.is_empty() || self.launcher == launcher(e))
            && (self.environment.is_empty() || self.environment == environment(e))
            && (self.access.is_empty() || self.access == access(e))
            && (self.vendor.is_empty() || self.vendor == super::model_vendor(&e.model))
    }
}
