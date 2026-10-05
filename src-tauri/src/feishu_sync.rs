//! CLI owns OAuth credentials. Quota only exchanges metric packets in a dedicated Drive folder.
use std::{fs, path::{Path,PathBuf}, process::{Command,Stdio}, time::{Duration,Instant}};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use tauri::{AppHandle,Manager};
use crate::commands::AppState;

#[derive(Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Status { pub enabled:bool, pub folder_token:String, pub last_synced:Option<String>, pub error:Option<String> }
pub fn status(dir:&Path)->Status {fs::read(dir.join("feishu-sync.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default()}
pub fn enabled(dir:&Path)->bool{status(dir).enabled}
fn save(dir:&Path,s:&Status)->Result<(),String>{crate::storage::write_atomic(&dir.join("feishu-sync.json"),&serde_json::to_string(s).map_err(|_|"保存飞书设置失败")?)}
fn cli(args:&[&str],cwd:&Path)->Result<Value,String>{
    let exe=std::env::var_os("APPDATA").map(PathBuf::from).ok_or("无法找到飞书 CLI")?.join("npm/node_modules/@larksuite/cli/bin/lark-cli.exe");
    if !exe.is_file(){return Err("请先安装飞书官方 CLI：npm install -g @larksuite/cli，并执行 lark-cli auth login --domain drive".into())}
    let mut cmd=Command::new(exe);cmd.args(args).args(["--as","user","--json"]).current_dir(cwd).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);}
    let mut child=cmd.spawn().map_err(|_|"无法启动飞书 CLI")?;
    let stdout=child.stdout.take().ok_or("无法读取飞书结果")?;
    // Drain the pipe concurrently to avoid deadlocking on a large directory listing.
    let reader=std::thread::spawn(move||{use std::io::Read;let mut data=Vec::new();stdout.take(8*1024*1024+1).read_to_end(&mut data).map(|_|data)});
    let start=Instant::now();
    let exit=loop{if let Some(exit)=child.try_wait().map_err(|_|"飞书同步中断")?{break exit}if start.elapsed()>Duration::from_secs(120){let _=child.kill();let _=child.wait();let _=reader.join();return Err("飞书同步超时，统计保留在本机，可重试".into())}std::thread::sleep(Duration::from_millis(100));};
    let bytes=reader.join().map_err(|_|"读取飞书结果失败")?.map_err(|_|"读取飞书结果失败")?;
    if bytes.len()>8*1024*1024{return Err("飞书目录数据过大".into())}
    let v:Value=serde_json::from_slice(&bytes).map_err(|_|"飞书暂不可用，请执行 lark-cli auth login --domain drive 后重试")?;
    if !exit.success() || v.get("ok")==Some(&Value::Bool(false)) || v.get("code").and_then(Value::as_i64).is_some_and(|n|n!=0) {return Err("飞书授权或网络不可用，请执行 lark-cli auth login --domain drive 后重试".into())}
    Ok(v.get("data").cloned().unwrap_or(v))
}
fn list(dir:&Path,folder:&str)->Result<Vec<Value>,String>{
    let mut files=Vec::new();let mut page=String::new();
    loop{let mut args=vec!["drive","files","list","--folder-token",folder,"--page-size","200"];if !page.is_empty(){args.extend(["--page-token",&page]);}
        let v=cli(&args,dir)?;files.extend(v["files"].as_array().cloned().ok_or("飞书目录格式已变化")?);
        if !v["has_more"].as_bool().unwrap_or(false){break}let next=v["next_page_token"].as_str().ok_or("飞书分页失败")?;if next.is_empty()||next==page||files.len()>100000{return Err("飞书目录分页异常".into())}page=next.into();}
    Ok(files)
}
fn token(v:&Value)->Result<&str,String>{v["token"].as_str().filter(|s|!s.is_empty()&&s.bytes().all(|c|c.is_ascii_alphanumeric())).ok_or("飞书文件标识无效".into())}
pub fn sync(dir:&Path)->Result<String,String>{
    let mut s=status(dir);if !s.enabled{return Ok("飞书同步已关闭".into())}
    let result:Result<String,String>=(||{
        if s.folder_token.is_empty(){
            let folders:Vec<_>=list(dir,"")?.into_iter().filter(|v|v["type"]=="folder"&&v["name"]=="Quota 同步").collect();
            if folders.len()>1{return Err("飞书根目录存在多个 Quota 同步文件夹，请先保留一个明确的同步目录".into())}
            s.folder_token=if let Some(v)=folders.first(){token(v)?.into()}else{let v=cli(&["drive","+create-folder","--name","Quota 同步"],dir)?;token(&v)?.into()};save(dir,&s)?;
        }
        let files=list(dir,&s.folder_token)?;
        let cache=dir.join("feishu-packets");fs::create_dir_all(&cache).map_err(|_|"创建同步缓存失败")?;
        let mut imported=0;
        for f in &files{
            let name=f["name"].as_str().unwrap_or("");
            if f["type"]!="file"||!packet_name(name){continue}
            let file=cache.join(name);
            if !file.exists(){cli(&["drive","+download","--file-token",token(f)?,"--output",file.to_str().ok_or("缓存路径无效")?],dir)?;}
            if fs::metadata(&file).map_err(|_|"同步文件不可访问")?.len()>4*1024*1024 {let _=fs::remove_file(&file);return Err("同步文件过大".into())}
            let bytes=fs::read(&file).map_err(|_|"读取云端统计失败")?;
            // Cloud packet filenames bind the exact bytes, detecting overwrites or incomplete downloads.
            use sha2::{Digest,Sha256};let digest=format!("{:x}",Sha256::digest(&bytes));
            if !name.ends_with(&format!("-{digest}.json")){let _=fs::remove_file(&file);return Err("云端统计校验失败，请重试".into())}
            imported+=crate::activity::import_cloud_packet(dir,&bytes)?;
        }
        let mut uploaded=0;
        for (name,body) in crate::activity::cloud_packets(dir)?{
            if files.iter().any(|f|f["name"]==name&&f["type"]=="file"){continue}
            let file=cache.join(&name);crate::storage::write_atomic(&file,&body)?;
            cli(&["drive","+upload","--folder-token",&s.folder_token,"--file",file.to_str().ok_or("缓存路径无效")?,"--name",&name],dir)?;uploaded+=1;
        }
        Ok(format!("飞书同步完成：上传 {uploaded} 个统计包，合并 {imported} 条记录"))
    })();
    match &result{Ok(_)=>{s.last_synced=Some(chrono::Utc::now().to_rfc3339());s.error=None},Err(e)=>s.error=Some(e.clone())}save(dir,&s)?;result
}
fn packet_name(name:&str)->bool{let Some(body)=name.strip_prefix("quota-").and_then(|v|v.strip_suffix(".json"))else{return false};let Some((id,hash))=body.rsplit_once('-')else{return false};uuid::Uuid::parse_str(id).is_ok()&&hash.len()==64&&hash.bytes().all(|c|c.is_ascii_hexdigit())}
#[tauri::command]
pub fn get_feishu_sync(state:tauri::State<'_,AppState>)->Status{status(state.store.dir())}
#[tauri::command]
pub async fn sync_feishu(app:AppHandle,enable:bool)->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||{let state=app.state::<AppState>();let _guard=state.activity_lock.lock().map_err(|_|"统计同步忙碌")?;let mut s=status(state.store.dir());s.enabled=enable;save(state.store.dir(),&s)?;if enable{crate::activity::collect(state.store.dir())?;let s=status(state.store.dir());if let Some(e)=s.error{return Err(e)}Ok("飞书同步完成，可在 Token 活动查看合并统计".into())}else{Ok("飞书同步已关闭".into())}}).await.map_err(|_|"飞书同步任务中断".to_string())?
}
