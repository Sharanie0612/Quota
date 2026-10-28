//! Optional SSH Codex reader. Transfer projections only, parse with the local
//! adapter, and commit metrics/cursors together in the existing activity ledger.
use super::{cursor, hash, label, merge_metric, parse_codex, save_cursor, Cursor};
use base64::Engine;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::{BTreeMap, BTreeSet}, io::{Read, Write}, process::{Command, Stdio}, time::{Duration, Instant}};

pub const PROJECTION_SCRIPT: &str = include_str!("../scripts/codex-ssh-metrics.py");
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(25);
#[path = "activity_ssh_discovery.rs"]
pub mod discovery;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Device {
    pub host:String, pub home:String, pub device_id:String, pub name:String,
    pub included:bool,
    #[serde(default)] pub aliases:Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Target { pub host:String, pub home:String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Identity { pub host:String, pub home:String, pub device_id:String, pub name:String, pub error:Option<String> }

pub fn validate_devices(devices:&[Device])->Result<(),String>{
    if devices.len()>32 {return Err("最多保存 32 台 SSH 设备".into())}
    let mut ids=BTreeSet::new();
    for device in devices {
        validate(&device.host,&device.home)?;
        if device.host.is_empty() || device.name.len()>640 || device.name.chars().any(char::is_control)
            || device.aliases.len()>128 || device.aliases.iter().any(|a|a.is_empty()||validate(a,"").is_err())
            || !device.device_id.is_empty() && (uuid::Uuid::parse_str(&device.device_id).is_err() || !ids.insert(device.device_id.clone())) {
            return Err("SSH 设备列表格式无效，请重新识别设备".into())
        }
    }
    Ok(())
}

pub fn excluded(devices:&[Device])->BTreeSet<String>{
    devices.iter().filter(|d|!d.included&&!d.device_id.is_empty()).map(|d|d.device_id.clone()).collect()
}

pub fn identity(bytes:&[u8])->Result<(String,String),String>{
    if bytes.len()>MAX_OUTPUT {return Err("SSH 设备响应过大".into())}
    let response:Response=serde_json::from_slice(bytes).map_err(|_|"SSH 未返回有效设备信息，请检查 Python 环境及登录脚本输出")?;
    if response.format!="quota-codex-ssh-v1" || uuid::Uuid::parse_str(&response.device_id).is_err() || response.device_name.len()>640 || response.device_name.chars().any(char::is_control) {
        return Err("SSH 设备标识无效".into())
    }
    Ok((response.device_id,label(&response.device_name)))
}

#[tauri::command]
pub async fn identify_codex_ssh_devices(targets:Vec<Target>)->Result<Vec<Identity>,String>{
    if targets.len()>32 {return Err("每次最多识别 32 个 SSH 连接".into())}
    for target in &targets {validate(&target.host,&target.home)?;if target.host.is_empty(){return Err("请填写 SSH 主机别名".into())}}
    tauri::async_runtime::spawn_blocking(move||{
        let mut result=Vec::new();
        // Four bounded identity-only connections at a time; never scan logs here.
        for batch in targets.chunks(4) {
            std::thread::scope(|scope|{
                let jobs:Vec<_>=batch.iter().map(|target|scope.spawn(move||{
                    let request=serde_json::json!({"format":"quota-codex-ssh-v1","home":target.home,"mode":"identity"}).to_string().into_bytes();
                    let found=run(&target.host,request,Duration::from_secs(10)).and_then(|bytes|identity(&bytes));
                    let (device_id,name,error)=match found {Ok((id,name))=>(id,name,None),Err(e)=>(String::new(),String::new(),Some(e))};
                    Identity{host:target.host.clone(),home:target.home.clone(),device_id,name,error}
                })).collect();
                for job in jobs {result.push(job.join().map_err(|_|"SSH 设备识别中断")?);} Ok::<(),String>(())
            })?;
        }
        Ok(result)
    }).await.map_err(|_|"SSH 设备识别未完成，请重试")?
}

pub fn validate(host: &str, home: &str) -> Result<(), String> {
    if !host.is_empty() && (host.len()>128 || !host.as_bytes()[0].is_ascii_alphanumeric()
        || !host.bytes().all(|c|c.is_ascii_alphanumeric() || matches!(c,b'.'|b'-'|b'_'))) {
        return Err("SSH 主机请填写已有的主机别名，只能包含字母、数字、点、短横线和下划线".into());
    }
    if !home.is_empty() && (!home.starts_with('/') || home.len()>2048 || home.chars().any(char::is_control)) {
        return Err("远程 Codex 目录应为空或 Ubuntu 上的绝对路径".into());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Response { format:String, device_id:String, device_name:String, files:Vec<Batch>, errors:Vec<String>, partial:bool }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Batch { path:String, start:u64, offset:u64, reset:bool, events:Vec<Value> }

fn prefix(host:&str,home:&str)->String {format!("ssh:{}:", hash(&format!("{host}\n{home}")))}
fn request(db:&Connection,host:&str,home:&str)->Result<Vec<u8>,String>{
    let prefix=prefix(host,home);let mut offsets=BTreeMap::new();
    let mut statement=db.prepare("SELECT path,body FROM cursors WHERE substr(path,1,?1)=?2").map_err(|_|"读取 SSH 采集进度失败")?;
    let rows=statement.query_map(params![prefix.len() as i64,prefix],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|_|"读取 SSH 采集进度失败")?;
    for row in rows {
        let (path,body)=row.map_err(|_|"读取 SSH 采集进度失败")?;
        let c:Cursor=serde_json::from_str(&body).map_err(|_|"SSH 采集进度损坏")?;
        if offsets.len()>=10000 {return Err("SSH 会话数量超过本轮采集上限".into())}
        offsets.insert(path[prefix.len()..].to_string(),if c.speed.version<1{0}else{c.offset});
    }
    let bytes=serde_json::to_vec(&serde_json::json!({"format":"quota-codex-ssh-v1","home":home,"offsets":offsets})).map_err(|_|"编码 SSH 采集进度失败")?;
    if bytes.len()>4*1024*1024 {return Err("SSH 采集进度过大".into())} Ok(bytes)
}

fn run(host:&str,input:Vec<u8>,timeout:Duration)->Result<Vec<u8>,String>{
    let encoded=base64::engine::general_purpose::STANDARD.encode(PROJECTION_SCRIPT);
    // All remote code is fixed. Paths/offsets travel as JSON over stdin, never as
    // shell arguments. Existing OpenSSH keys and known_hosts remain in place.
    let python=format!("python3 -c 'import base64;exec(base64.b64decode(\"{encoded}\"))'");
    let remote=format!("\"${{SHELL:-/bin/sh}}\" -lc '{}'",python.replace('\'',"'\\''"));
    let mut command=Command::new("ssh");
    command.args(["-T","-o","BatchMode=yes","-o","ConnectTimeout=8","-o","ConnectionAttempts=1",
        "-o","ServerAliveInterval=5","-o","ServerAliveCountMax=1","-o","StrictHostKeyChecking=yes",
        "-o","ClearAllForwardings=yes","-o","ForwardAgent=no","-o","ForwardX11=no","-o","RemoteCommand=none",host,&remote])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let mut child=command.spawn().map_err(|_|"未找到 OpenSSH 客户端，请先确认本机可使用 ssh 命令")?;
    let mut stdin=child.stdin.take().ok_or("SSH 输入不可用")?;
    let stdout=child.stdout.take().ok_or("SSH 输出不可用")?;
    let (writer_tx,writer_rx)=std::sync::mpsc::channel();
    std::thread::spawn(move||{let _=writer_tx.send(stdin.write_all(&input));});
    let (reader_tx,reader_rx)=std::sync::mpsc::channel();
    std::thread::spawn(move||{let mut bytes=Vec::new();let result=stdout.take(MAX_OUTPUT as u64+1).read_to_end(&mut bytes).map(|_|bytes);let _=reader_tx.send(result);});
    let started=Instant::now();
    let status=loop {
        match child.try_wait() {
            Ok(Some(status))=>break Ok(status),
            Ok(None) if started.elapsed()<timeout=>std::thread::sleep(Duration::from_millis(50)),
            _=>{let _=child.kill();let _=child.wait();break Err("SSH 采集超时或中断，本机用量已保留，下次会重试");}
        }
    };
    let status=status?;
    // Do not join a pipe reader indefinitely if a configured ProxyCommand keeps
    // an inherited pipe open after ssh itself has already exited.
    let output=reader_rx.recv_timeout(timeout.saturating_sub(started.elapsed())).map_err(|_|"SSH 响应读取超时，未推进采集进度")?.map_err(|_|"SSH 输出失败")?;
    let written=writer_rx.recv_timeout(timeout.saturating_sub(started.elapsed())).map_err(|_|"SSH 请求发送超时")?;
    if !status.success() || written.is_err() {return Err("SSH 采集失败：请确认已有主机别名可免交互连接，已信任主机密钥，且 Ubuntu 已安装 Python 3.7 或更新版本".into())}
    if output.len()>MAX_OUTPUT {return Err("SSH 用量响应超过大小上限，未推进采集进度".into())}
    Ok(output)
}

/// Also used by the synthetic transport harness; no SSH/network required.
pub fn apply(db:&mut Connection,host:&str,home:&str,bytes:&[u8],errors:&mut Vec<String>)->Result<usize,String>{
    validate(host,home)?;
    if bytes.len()>MAX_OUTPUT {return Err("SSH 用量响应过大".into())}
    let response:Response=serde_json::from_slice(bytes).map_err(|_|"SSH 未返回有效用量数据；请检查远程 Python 环境及登录脚本输出")?;
    if response.format!="quota-codex-ssh-v1" || uuid::Uuid::parse_str(&response.device_id).is_err()
        || response.device_name.len()>640 || response.files.len()>4000 || response.errors.len()>16
        || response.files.iter().map(|file|file.events.len()).sum::<usize>()>4000 {
        return Err("SSH 用量数据格式或大小无效".into());
    }
    let prefix=prefix(host,home);let mut paths=BTreeSet::new();let mut count=0;
    for file in response.files {
        if file.path.len()>4096 || !file.path.starts_with("sessions/") && !file.path.starts_with("archived_sessions/")
            || file.path.contains('\\') || file.path.split('/').any(|part|part.is_empty()||part=="."||part==".."||part.chars().any(char::is_control))
            || !paths.insert(file.path.clone()) || file.offset<file.start {
            return Err("SSH 会话进度格式无效".into());
        }
        let key=format!("{prefix}{}",file.path);let mut c=cursor(db,&key)?;
        if c.speed.version<1 {c=Cursor::default();}
        if file.reset {if file.start!=0{return Err("SSH 重读进度无效".into())}c=Cursor::default();}
        else if c.offset!=file.start {return Err("SSH 采集进度发生变化，请重试".into())}
        c.speed.version=1;
        let result=(||->Result<usize,String>{
            let tx=db.transaction().map_err(|_|"统计资料库忙碌")?;let mut changed=0;
            tx.execute("INSERT INTO devices(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
                params![response.device_id,format!("SSH · {}",label(&response.device_name))]).map_err(|_|"保存远程设备失败")?;
            for value in file.events {
                if let Some(mut event)=parse_codex(&value,&mut c,&response.device_id) {
                    // The remote digest uses the full original counter object;
                    // unknown future fields never have to leave the host.
                    let id=value.get("metricId").and_then(Value::as_str).ok_or("SSH 指标缺少去重标识")?;
                    event.id=id.to_string();if merge_metric(&tx,&event,true)?{changed+=1}
                } else if value.get("type").and_then(Value::as_str)==Some("event_msg") && c.session.is_empty() {
                    return Err("SSH 会话缺少标识，已保留原进度".into());
                }
            }
            c.offset=file.offset;save_cursor(&tx,&key,&c)?;tx.commit().map_err(|_|"保存 SSH 用量失败")?;Ok(changed)
        })();
        match result {Ok(n)=>count+=n,Err(error)=>errors.push(error)}
    }
    if !response.errors.is_empty() {errors.push("部分远程 Codex 日志不存在、无法读取或格式不支持，其余用量已采集；请核对远程目录".into());}
    if response.partial {errors.push("远程历史仍在补采，将在下一次采集时继续；已读取的用量正常显示".into());}
    Ok(count)
}

pub fn collect(db:&mut Connection,host:&str,home:&str,errors:&mut Vec<String>)->Result<usize,String>{
    if host.is_empty(){return Ok(0)}
    validate(host,home)?;
    let bytes=run(host,request(db,host,home)?,TIMEOUT)?;apply(db,host,home,&bytes,errors)
}

pub fn apply_device(db:&mut Connection,device:&mut Device,bytes:&[u8],errors:&mut Vec<String>)->Result<usize,String>{
    let (id,name)=identity(bytes)?;
    if !device.device_id.is_empty() && device.device_id!=id {return Err("设备标识已变化，请重新识别并选择是否纳入统计".into())}
    device.device_id=id;device.name=name;
    apply(db,&device.host,&device.home,bytes,errors)
}

pub fn collect_devices(db:&mut Connection,devices:&mut [Device],errors:&mut Vec<String>)->usize{
    if let Err(error)=validate_devices(devices){errors.push(error);return 0}
    let mut count=0;
    // Prepare SQLite cursors on the owning thread, then bound network concurrency.
    for batch in devices.chunks_mut(4) {
        let jobs:Vec<_>=batch.iter().enumerate().filter(|(_,d)|d.included).map(|(index,d)|{
            let input=validate(&d.host,&d.home).and_then(|_|request(db,&d.host,&d.home));
            (index,d.host.clone(),input)
        }).collect();
        let results=std::thread::scope(|scope|{
            let jobs:Vec<_>=jobs.into_iter().map(|(index,host,input)|scope.spawn(move||(index,input.and_then(|input|run(&host,input,TIMEOUT))))).collect();
            jobs.into_iter().map(|job|job.join().unwrap_or_else(|_|(usize::MAX,Err("SSH 采集中断".into())))).collect::<Vec<_>>()
        });
        for (index,result) in results {
            let Some(device)=batch.get_mut(index) else {errors.push("SSH 采集中断".into());continue};
            let result=result.and_then(|bytes|{
                let mut issues=Vec::new();let result=apply_device(db,device,&bytes,&mut issues);
                errors.extend(issues.into_iter().map(|e|format!("SSH {}：{e}",device.host)));result
            });
            match result {Ok(n)=>count+=n,Err(e)=>errors.push(format!("SSH {}：{e}",device.host))}
        }
    }
    count
}
