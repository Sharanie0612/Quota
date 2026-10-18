//! Lossless compressed directory packets. JSON export/import remains portable.
use super::{options, Packet};
use crate::commands::AppState;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use tauri::{AppHandle, Manager};

const LIMIT: u64 = 4 * 1024 * 1024;

pub(super) fn is_packet(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".json") || n.ends_with(".json.zst"))
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| "同步文件暂不可用")?;
    if file.metadata().map_err(|_| "读取同步文件失败")?.len() > LIMIT {
        return Err("同步文件过大".into());
    }
    let reader: Box<dyn Read> = if path.extension().is_some_and(|e| e == "zst") {
        Box::new(zstd::stream::read::Decoder::new(file).map_err(|_| "同步压缩文件损坏")?)
    } else {
        Box::new(file)
    };
    let mut bytes = Vec::new();
    reader
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "同步文件尚未下载完成或已损坏")?;
    if bytes.len() as u64 > LIMIT {
        return Err("同步文件解压后过大".into());
    }
    Ok(bytes)
}
pub(super) fn read_packet(path: &Path) -> Result<Packet, String> {
    read_packet_with_hash(path).map(|(packet, _)| packet)
}
pub(super) fn read_packet_with_hash(path: &Path) -> Result<(Packet, String), String> {
    let bytes = read_bytes(path)?;
    let packet: Packet = serde_json::from_slice(&bytes).map_err(|_| "同步文件格式无效")?;
    if !packet.valid() {
        return Err("同步文件格式无效".into());
    }
    let fingerprint = super::hash(std::str::from_utf8(&bytes).map_err(|_| "同步文件编码无效")?);
    Ok((packet, fingerprint))
}

pub(super) fn write_packet(path: &Path, packet: &Packet) -> Result<(), String> {
    let bytes = serde_json::to_vec(packet).map_err(|_| "编码同步统计失败")?;
    write_bytes(path, &bytes)
}
fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > LIMIT {
        return Err("同步文件过大".into());
    }
    let compressed = zstd::stream::encode_all(bytes, 9).map_err(|_| "压缩同步统计失败")?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|_| "创建同步文件失败")?;
        file.write_all(&compressed)
            .and_then(|_| file.sync_all())
            .map_err(|_| "写入同步统计失败")?;
        fs::rename(&tmp, path).map_err(|_| "保存同步统计失败")
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    Ok(result?)
}

// Old readers only scan .json. Publish exact, immutable siblings while any
// peer has not announced compression support. Never rewrite another device.
pub(super) fn restore_legacy(own: &Path, device: &str) -> Vec<String> {
    let mut errors = Vec::new();
    let files = match fs::read_dir(own) {
        Ok(f) => f,
        Err(_) => return vec!["无法恢复旧版兼容文件".into()],
    };
    for item in files {
        let result = (|| -> Result<(), String> {
            let item = item.map_err(|_| "兼容文件暂不可用")?;
            let path = item.path();
            if !item
                .file_type()
                .is_ok_and(|t| t.is_file() && !t.is_symlink())
                || !path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| s.ends_with(".json.zst"))
            {
                return Ok(());
            }
            let target = path.with_extension("");
            let bytes = read_bytes(&path)?;
            let packet = read_packet(&path)?;
            if packet.device.id != device {
                return Err("兼容文件归属不一致，原包已保留".into());
            }
            if target.exists() {
                if fs::symlink_metadata(&target)
                    .map_err(|_| "读取兼容文件失败")?
                    .file_type()
                    .is_symlink()
                    || read_bytes(&target)? != bytes
                {
                    return Err("旧版兼容文件内容冲突，原文件已保留".into());
                }
            } else {
                let tmp = target.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
                let result = (|| {
                    let mut file = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&tmp)
                        .map_err(|_| "创建兼容文件失败")?;
                    file.write_all(&bytes)
                        .and_then(|_| file.sync_all())
                        .map_err(|_| "写入兼容文件失败")?;
                    fs::rename(&tmp, &target).map_err(|_| "保存兼容文件失败")
                })();
                if result.is_err() {
                    let _ = fs::remove_file(tmp);
                }
                result?;
                if read_bytes(&target)? != bytes {
                    return Err("兼容文件校验失败，压缩原包已保留".into());
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            errors.push(e)
        }
    }
    errors
}

#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub bytes: u64,
    pub files: usize,
    pub legacy_files: usize,
    pub own_legacy_files: usize,
    pub legacy_compatibility: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Capability {
    pub schema: u32,
    pub device: String,
    pub version: String,
    pub compressed: bool,
}
pub(super) fn announce(own: &Path, device: &str) -> Result<(), String> {
    let value = Capability {
        schema: 1,
        device: device.into(),
        version: crate::version::display_version(),
        compressed: true,
    };
    // Extension deliberately differs from packet JSON so older clients ignore it.
    crate::storage::write_atomic(
        &own.join("reader.capability"),
        &serde_json::to_string(&value).map_err(|_| "编码同步能力失败")?,
    )
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reader {
    pub device: String,
    pub version: Option<String>,
    pub compressed: Option<bool>,
}
pub fn readers(dir: &Path) -> Result<Vec<Reader>, String> {
    readers_for(&options(dir))
}
pub(super) fn readers_for(o: &super::Options) -> Result<Vec<Reader>, String> {
    if o.sync_dir.is_empty() {
        return Ok(vec![]);
    }
    let root = Path::new(&o.sync_dir).join("quota-activity-v1");
    let dirs = match fs::read_dir(root) {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err("无法检查同步设备".into()),
    };
    let mut result = Vec::new();
    for item in dirs {
        let item = item.map_err(|_| "无法读取同步设备")?;
        if !item
            .file_type()
            .is_ok_and(|t| t.is_dir() && !t.is_symlink())
        {
            continue;
        }
        let device = item.file_name().to_string_lossy().into_owned();
        if device == o.device_id || uuid::Uuid::parse_str(&device).is_err() {
            continue;
        }
        let cap = fs::read(item.path().join("reader.capability"))
            .ok()
            .filter(|b| b.len() <= 4096)
            .and_then(|b| serde_json::from_slice::<Capability>(&b).ok())
            .filter(|c| c.schema == 1 && c.device == device && c.version.len() <= 32);
        result.push(Reader {
            device,
            version: cap.as_ref().map(|c| c.version.clone()),
            compressed: cap.map(|c| c.compressed),
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_activity_readers(app: AppHandle) -> Result<Vec<Reader>, String> {
    tauri::async_runtime::spawn_blocking(move || readers(app.state::<AppState>().store.dir()))
        .await
        .map_err(|_| "检查同步设备失败")?
}

#[tauri::command]
pub async fn rebuild_activity_sync(app: AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.activity_lock.lock().map_err(|_| "统计暂不可用")?;
        let db = super::database(state.store.dir())?;
        db.execute("DELETE FROM receipts", [])
            .map_err(|_| "重建同步索引失败")?;
        drop(db);
        let count = super::collect(state.store.dir())?;
        let _ = tauri::Emitter::emit(&app, "activity-updated", ());
        Ok(count)
    })
    .await
    .map_err(|_| "重建同步索引失败")?
}

pub fn inspect(dir: &Path) -> Result<StorageInfo, String> {
    let o = options(dir);
    if uuid::Uuid::parse_str(&o.device_id).is_err() {
        return Err("本机设备标识无效".into());
    }
    let mut info = StorageInfo::default();
    info.legacy_compatibility = readers_for(&o)?.iter().any(|r| r.compressed != Some(true));
    if o.sync_dir.is_empty() {
        return Ok(info);
    }
    let root = Path::new(&o.sync_dir).join("quota-activity-v1");
    if !root.exists() {
        return Ok(info);
    }
    for device in fs::read_dir(root).map_err(|_| "无法读取共享目录")? {
        let device = device.map_err(|_| "无法读取共享目录")?;
        if !device
            .file_type()
            .is_ok_and(|t| t.is_dir() && !t.is_symlink())
        {
            continue;
        }
        for file in fs::read_dir(device.path()).map_err(|_| "无法读取设备同步目录")? {
            let file = file.map_err(|_| "无法读取同步文件")?;
            if !file
                .file_type()
                .is_ok_and(|t| t.is_file() && !t.is_symlink())
                || !is_packet(&file.path())
            {
                continue;
            }
            info.bytes += file.metadata().map_err(|_| "无法读取同步文件大小")?.len();
            info.files += 1;
            if file.path().extension().is_some_and(|e| e == "json") {
                info.legacy_files += 1;
                if device.file_name().to_str() == Some(&o.device_id) {
                    info.own_legacy_files += 1;
                }
            }
        }
    }
    Ok(info)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Optimization {
    pub before: StorageInfo,
    pub after: StorageInfo,
    pub converted: usize,
}

// Each device rewrites only its own immutable packets. Verify a full round trip
// before removing JSON; a crash leaving both versions is harmless (event IDs dedup).
pub fn optimize(dir: &Path) -> Result<Optimization, String> {
    let before = inspect(dir)?;
    if before.legacy_compatibility {
        return Err("还有设备未确认压缩读取能力，已保留旧版兼容文件；请将全部设备升级到 1.0.1600 并各同步一次".into());
    }
    let o = options(dir);
    if uuid::Uuid::parse_str(&o.device_id).is_err() {
        return Err("本机设备标识无效".into());
    }
    if o.sync_dir.is_empty() {
        return Err("请先选择共享目录".into());
    }
    let own = Path::new(&o.sync_dir)
        .join("quota-activity-v1")
        .join(&o.device_id);
    let mut converted = 0;
    if own.exists() {
        if fs::symlink_metadata(&own)
            .map_err(|_| "无法读取设备目录")?
            .file_type()
            .is_symlink()
        {
            return Err("设备目录不能是符号链接".into());
        }
        for file in fs::read_dir(&own).map_err(|_| "无法读取设备目录")? {
            let file = file.map_err(|_| "无法读取同步文件")?;
            if !file
                .file_type()
                .is_ok_and(|t| t.is_file() && !t.is_symlink())
                || file.path().extension().is_none_or(|e| e != "json")
            {
                continue;
            }
            let path = file.path();
            let packet = read_packet(&path)?;
            let original = fs::read(&path).map_err(|_| "读取旧同步文件失败")?;
            if packet.device.id != o.device_id {
                return Err("旧文件设备归属不一致，已保留原文件".into());
            }
            let target = path.with_extension("json.zst");
            if !target.exists() {
                write_bytes(&target, &original)?;
            }
            // Compare bytes, including whitespace and fields unknown to this version.
            // An existing compressed sibling must be identical before JSON is removed.
            if read_bytes(&target)? != original {
                return Err("压缩校验失败，已保留原文件".into());
            }
            if fs::read(&path).map_err(|_| "旧同步文件暂不可用")? != original {
                return Err("旧文件已变化，已保留原文件".into());
            }
            // Both paths originate in this verified device directory, without recursion.
            fs::remove_file(&path).map_err(|_| "压缩已保存，旧文件暂时无法移除，可稍后重试")?;
            converted += 1;
        }
    }
    Ok(Optimization {
        before,
        after: inspect(dir)?,
        converted,
    })
}

#[tauri::command]
pub async fn get_activity_storage(app: AppHandle) -> Result<StorageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(app.state::<AppState>().store.dir()))
        .await
        .map_err(|_| "读取空间占用失败")?
}

#[tauri::command]
pub async fn optimize_activity_storage(app: AppHandle) -> Result<Optimization, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.activity_lock.lock().map_err(|_| "统计暂不可用")?;
        optimize(state.store.dir())
    })
    .await
    .map_err(|_| "优化同步空间失败")?
}
