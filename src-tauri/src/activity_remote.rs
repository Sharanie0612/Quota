//! Common SSH / WSL transport for CLI usage. Execute fixed projections only.
use super::{Environment, Instance, SourceStatus};
use crate::activity::{self, merge_metric};
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub const SCRIPT: &str = include_str!("../scripts/activity-remote-metrics.py");
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub device_id: String,
    pub name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Response {
    format: String,
    device_id: String,
    device_name: String,
    files: Vec<Batch>,
    errors: Vec<String>,
    partial: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Batch {
    instance: String,
    path: String,
    session: String,
    events: Vec<Value>,
    start: u64,
    offset: u64,
    reset: bool,
    stamp: String,
}
fn run(environment: &Environment, input: Vec<u8>, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut command;
    if environment.kind == "ssh" {
        activity::ssh::validate(&environment.target, "")?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(SCRIPT);
        let python = format!("python3 -c 'import base64;exec(base64.b64decode(\"{encoded}\"))'");
        let remote = format!(
            "\"${{SHELL:-/bin/sh}}\" -lc '{}'",
            python.replace('\'', "'\\''")
        );
        command = Command::new("ssh");
        command.args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            "-o",
            "ConnectionAttempts=1",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ClearAllForwardings=yes",
            "-o",
            "ForwardAgent=no",
            "-o",
            "ForwardX11=no",
            "-o",
            "RemoteCommand=none",
            &environment.target,
            &remote,
        ]);
    } else if environment.kind == "wsl" {
        if environment.target.is_empty()
            || !environment
                .target
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        {
            return Err("WSL 发行版名称无效".into());
        }
        command = Command::new("wsl.exe");
        command.args([
            "--distribution",
            &environment.target,
            "--exec",
            "python3",
            "-c",
            SCRIPT,
        ]);
    } else {
        return Err("该环境不是 SSH 或 WSL".into());
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "未找到 SSH / WSL 客户端")?;
    let mut stdin = child.stdin.take().ok_or("远程输入不可用")?;
    let stdout = child.stdout.take().ok_or("远程输出不可用")?;
    let (writer_tx, writer_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = writer_tx.send(stdin.write_all(&input));
    });
    let (reader_tx, reader_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let r = stdout
            .take(MAX_OUTPUT as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = reader_tx.send(r);
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("环境读取超时，原用量与进度已保留".into());
            }
        }
    };
    let bytes = reader_rx
        .recv_timeout(timeout.saturating_sub(started.elapsed()))
        .map_err(|_| "环境响应超时")?
        .map_err(|_| "读取环境响应失败")?;
    let written = writer_rx
        .recv_timeout(timeout.saturating_sub(started.elapsed()))
        .map_err(|_| "环境请求发送超时")?;
    if !status.success() || written.is_err() {
        return Err("无法读取环境；请确认免交互连接、已信任的 SSH 主机及 Python 3.7+".into());
    }
    if bytes.len() > MAX_OUTPUT {
        return Err("环境响应超过 16 MiB，未采用".into());
    }
    Ok(bytes)
}
pub fn apply(
    db: &mut Connection,
    environment: &Environment,
    instances: &[Instance],
    bytes: &[u8],
) -> Result<(usize, Vec<SourceStatus>), String> {
    if bytes.len() > MAX_OUTPUT {
        return Err("环境响应过大".into());
    }
    let response: Response =
        serde_json::from_slice(bytes).map_err(|_| "环境响应不是有效用量投影")?;
    if response.format != "quota-activity-sources-v1"
        || response.device_id != environment.id
        || response.files.len() > 10000
        || response.errors.len() > 32
        || response.files.iter().map(|f| f.events.len()).sum::<usize>() > 4000
    {
        return Err("环境标识已变化或响应无效，请重新识别".into());
    }
    let mut changed = 0;
    let mut seen = std::collections::BTreeSet::new();
    for batch in response.files {
        if batch.path.len() > 4096
            || batch.path.contains('\\')
            || batch
                .path
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == ".." || p.chars().any(char::is_control))
            || !seen.insert((batch.instance.clone(), batch.path.clone()))
        {
            return Err("环境日志标识无效".into());
        }
        let instance = instances
            .iter()
            .find(|s| s.id == batch.instance)
            .ok_or("环境返回未请求的来源")?;
        let key = format!("remote:{}:{}", instance.id, batch.path);
        let old: Option<String> = db
            .query_row("SELECT body FROM cursors WHERE path=?1", [&key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "读取远程进度失败")?;
        let mut c: super::readers::ReaderCursor = old
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let context = super::readers::context_digest(instance, environment, &[]);
        if batch.reset || c.context_digest != context && batch.start == 0 {
            if batch.start != 0 {
                return Err("远程重读进度无效".into());
            }
            c = Default::default();
        } else if c.offset != batch.start {
            return Err("远程采集进度发生变化，请重试".into());
        }
        if batch.offset < batch.start {
            return Err("远程进度无效".into());
        }
        if c.session.is_empty() {
            c.session = batch.session;
        }
        let tx = db.transaction().map_err(|_| "统计资料库忙碌")?;
        tx.execute("INSERT INTO devices(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![environment.id,environment.name]).map_err(|_|"保存运行环境失败")?;
        for row in batch.events {
            for mut e in super::readers::parse_line(&row, &mut c, instance, environment)? {
                if instance.format == "codex-jsonl" {
                    if let Some(id) = row.get("metricId").and_then(Value::as_str) {
                        e.id = id.into();
                    }
                }
                if e.kind == "tokens" {
                    c.observed += 1;
                }
                if merge_metric(&tx, &e, true)? {
                    changed += 1
                }
            }
        }
        c.offset = batch.offset;
        c.stamp = batch.stamp;
        c.context_digest = context;
        tx.execute("INSERT INTO cursors(path,body) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET body=excluded.body",params![key,serde_json::to_string(&c).map_err(|_|"编码环境进度失败")?]).map_err(|_|"保存环境进度失败")?;
        tx.commit().map_err(|_| "保存环境用量失败")?;
    }
    let states=instances.iter().map(|s|{let prefix=format!("remote:{}:",s.id);let(records,files)=db.query_row("SELECT COALESCE(SUM(COALESCE(json_extract(body,'$.observed'),0)),0),COUNT(*) FROM cursors WHERE substr(path,1,?1)=?2",params![prefix.len() as i64,prefix],|r|Ok((r.get::<_,i64>(0)?.max(0) as usize,r.get::<_,i64>(1)?.max(0) as usize))).unwrap_or((0,0));SourceStatus{instance:s.id.clone(),state:if response.partial{"partial"}else if !response.errors.is_empty(){"partial"}else if records>0{"ready"}else{"no-usage"}.into(),files,records,at:Some(activity::now()),message:if response.partial{"远程历史正在分批补采，下轮继续"}else if !response.errors.is_empty(){"部分来源尚不可读或本轮格式不支持，已有记录保留"}else{""}.into()}}).collect();
    Ok((changed, states))
}
pub fn collect(
    db: &mut Connection,
    environment: &Environment,
    instances: &[Instance],
) -> Result<(usize, Vec<SourceStatus>), String> {
    let mut requests = vec![];
    for source in instances {
        let prefix = format!("remote:{}:", source.id);
        let mut offsets = serde_json::Map::new();
        let mut q = db
            .prepare("SELECT path,body FROM cursors WHERE substr(path,1,?1)=?2")
            .map_err(|_| "读取环境进度失败")?;
        let rows = q
            .query_map(params![prefix.len() as i64, prefix], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|_| "读取环境进度失败")?;
        for row in rows {
            let (path, body) = row.map_err(|_| "读取环境进度失败")?;
            let mut cursor: Value = serde_json::from_str(&body).map_err(|_| "环境进度损坏")?;
            let context = super::readers::context_digest(source, environment, &[]);
            if cursor["context_digest"].as_str() != Some(&context) {
                cursor["offset"] = serde_json::json!(0);
                cursor["stamp"] = serde_json::json!("");
                cursor["reset"] = serde_json::json!(true);
            }
            offsets.insert(path[prefix.len()..].into(), cursor);
        }
        let mut request = serde_json::to_value(source).map_err(|_| "编码来源失败")?;
        request["offsets"] = Value::Object(offsets);
        requests.push(request);
    }
    let input=serde_json::to_vec(&serde_json::json!({"format":"quota-activity-sources-v1","home":environment.home,"identityRoot":environment.identity_root,"instances":requests})).map_err(|_|"编码环境请求失败")?;
    let bytes = run(environment, input, Duration::from_secs(25))?;
    apply(db, environment, instances, &bytes)
}
#[tauri::command]
pub async fn identify_activity_environment(
    kind: String,
    target: String,
    home: String,
) -> Result<Identity, String> {
    if !matches!(kind.as_str(), "ssh" | "wsl") {
        return Err("请选择 SSH 或 WSL 环境".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let environment = Environment {
            id: String::new(),
            name: String::new(),
            kind,
            target,
            home,
            identity_root: String::new(),
            included: false,
            legacy: false,
        };
        let bytes = run(
            &environment,
            serde_json::to_vec(&serde_json::json!({"mode":"identity","home":environment.home}))
                .map_err(|_| "编码环境识别失败")?,
            Duration::from_secs(10),
        )?;
        let response: Response =
            serde_json::from_slice(&bytes).map_err(|_| "环境未返回有效标识")?;
        if response.format != "quota-activity-sources-v1"
            || uuid::Uuid::parse_str(&response.device_id).is_err()
        {
            return Err("环境标识无效".into());
        }
        Ok(Identity {
            device_id: response.device_id,
            name: activity::label(&response.device_name),
        })
    })
    .await
    .map_err(|_| "环境识别失败")?
}
