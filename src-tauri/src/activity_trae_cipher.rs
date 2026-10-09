//! SQLCipher 4 decoding in RAM, authenticated page by page. No plaintext file output.
use aes_gcm::aes::{
    cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit},
    Aes256,
};
use hmac::{Hmac, Mac};
use rusqlite::Connection;
use sha2::Sha512;
use std::{
    fs,
    path::{Path, PathBuf},
};
#[cfg(windows)]
#[path = "activity_trae_windows.rs"]
mod windows;
const PAGE: usize = 4096;
const RESERVE: usize = 80;
const LIMIT: usize = 256 * 1024 * 1024;
fn mac_key(key: &[u8; 32], salt: &[u8]) -> [u8; 32] {
    let salt: Vec<u8> = salt.iter().map(|b| b ^ 0x3a).collect();
    let mut result = [0; 32];
    pbkdf2::pbkdf2_hmac::<Sha512>(key, &salt, 2, &mut result);
    result
}
fn valid_page(mac_key: &[u8; 32], page: &[u8], number: u32) -> bool {
    if page.len() != PAGE {
        return false;
    }
    let offset = if number == 1 { 16 } else { 0 };
    let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(mac_key).expect("fixed HMAC key");
    mac.update(&page[offset..PAGE - RESERVE + 16]);
    mac.update(&number.to_le_bytes());
    mac.verify_slice(&page[PAGE - 64..]).is_ok()
}
pub fn verify_key(key: &[u8; 32], page: &[u8]) -> bool {
    page.len() == PAGE && valid_page(&mac_key(key, &page[..16]), page, 1)
}
fn decrypt_page(
    key: &[u8; 32],
    mac: &[u8; 32],
    page: &[u8],
    number: u32,
) -> Result<Vec<u8>, String> {
    if !valid_page(mac, page, number) {
        return Err("Trae 用量数据库校验失败，等待下次采集重试".into());
    }
    let start = if number == 1 { 16 } else { 0 };
    let mut result = vec![0; PAGE];
    if number == 1 {
        result[..16].copy_from_slice(b"SQLite format 3\0");
    }
    let cipher = Aes256::new(GenericArray::from_slice(key));
    let mut previous = [0; 16];
    previous.copy_from_slice(&page[PAGE - RESERVE..PAGE - RESERVE + 16]);
    for (index, encrypted) in page[start..PAGE - RESERVE].chunks_exact(16).enumerate() {
        let mut block = GenericArray::clone_from_slice(encrypted);
        cipher.decrypt_block(&mut block);
        for i in 0..16 {
            result[start + index * 16 + i] = block[i] ^ previous[i];
        }
        previous.copy_from_slice(encrypted);
    }
    Ok(result)
}
fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let f = fs::File::open(path).map_err(|_| "Trae 本地用量暂时无法读取")?;
    if f.metadata().map_err(|_| "Trae 本地用量暂时无法读取")?.len() > LIMIT as u64 {
        return Err("Trae 用量数据库超过 256 MB，暂未采集".into());
    }
    use std::io::Read;
    let mut bytes = Vec::new();
    f.take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Trae 本地用量暂时无法读取")?;
    if bytes.len() > LIMIT {
        return Err("Trae 用量数据库超过 256 MB，暂未采集".into());
    }
    Ok(bytes)
}
fn checksum(bytes: &[u8], mut state: (u32, u32), little: bool) -> (u32, u32) {
    for pair in bytes.chunks_exact(8) {
        let word = |s: &[u8]| {
            if little {
                u32::from_le_bytes(s.try_into().unwrap())
            } else {
                u32::from_be_bytes(s.try_into().unwrap())
            }
        };
        state.0 = state.0.wrapping_add(word(&pair[..4])).wrapping_add(state.1);
        state.1 = state.1.wrapping_add(word(&pair[4..])).wrapping_add(state.0);
    }
    state
}
fn be(bytes: &[u8]) -> u32 {
    u32::from_be_bytes(bytes.try_into().unwrap())
}
// Only complete checksum-valid committed WAL transactions, including database truncation.
pub fn database_image(bytes: &[u8], wal: &[u8], key: Option<&[u8; 32]>) -> Result<Vec<u8>, String> {
    if bytes.len() < PAGE || bytes.len() % PAGE != 0 || bytes.len() > LIMIT {
        return Err("Trae 用量数据库格式暂不支持".into());
    }
    let mut pages = bytes.to_vec();
    if !wal.is_empty() {
        if wal.len() < 32
            || !matches!(be(&wal[..4]), 0x377f0682 | 0x377f0683)
            || be(&wal[8..12]) != PAGE as u32
        {
            return Err("Trae 用量日志尚未完整，等待下次采集".into());
        }
        let little = be(&wal[..4]) == 0x377f0682;
        let mut state = checksum(&wal[..24], (0, 0), little);
        if state != (be(&wal[24..28]), be(&wal[28..32])) {
            return Err("Trae 用量日志校验失败".into());
        }
        let mut pending = std::collections::BTreeMap::new();
        for frame in wal[32..].chunks_exact(PAGE + 24) {
            if frame[8..16] != wal[16..24] {
                break;
            }
            state = checksum(&frame[..8], state, little);
            state = checksum(&frame[24..], state, little);
            if state != (be(&frame[16..20]), be(&frame[20..24])) {
                break;
            }
            let number = be(&frame[..4]) as usize;
            let size = be(&frame[4..8]) as usize;
            if number == 0 || number > LIMIT / PAGE || size > LIMIT / PAGE {
                return Err("Trae 用量日志页面无效".into());
            }
            pending.insert(number, &frame[24..]);
            if size != 0 {
                pages.resize(size * PAGE, 0);
                for (&n, &data) in &pending {
                    if n <= size {
                        pages[(n - 1) * PAGE..n * PAGE].copy_from_slice(data);
                    }
                }
                pending.clear();
            }
        }
    }
    if let Some(key) = key {
        let mac = mac_key(key, &bytes[..16]);
        for (i, page) in pages.chunks_exact_mut(PAGE).enumerate() {
            if page.iter().all(|b| *b == 0) {
                continue;
            }
            let mut plain = decrypt_page(key, &mac, page, i as u32 + 1)?;
            page.copy_from_slice(&plain);
            plain.fill(0);
        }
    }
    if !pages.starts_with(b"SQLite format 3\0") {
        return Err("Trae 用量数据库格式暂不支持".into());
    }
    pages[18] = 1;
    pages[19] = 1;
    Ok(pages)
}
fn local_key(path: &Path, page: &[u8]) -> Result<[u8; 32], String> {
    let salt: String = page[..16].iter().map(|b| format!("{b:02x}")).collect();
    let id = format!("trae-db:{}:{salt}", super::hash(&path.to_string_lossy()));
    let entry = keyring::Entry::new("Quota", &id).map_err(|_| "无法访问系统凭据管理器")?;
    match entry.get_secret() {
        Ok(mut raw) if raw.len() == 32 => {
            let mut key = [0; 32];
            key.copy_from_slice(&raw);
            raw.fill(0);
            if verify_key(&key, page) {
                return Ok(key);
            }
        }
        Err(keyring::Error::NoEntry) => (),
        Err(_) => return Err("Trae 本地连接凭据暂时无法读取".into()),
        _ => (),
    }
    #[cfg(windows)]
    {
        let key = windows::find_key(page)?;
        entry
            .set_secret(&key)
            .map_err(|_| "Trae 连接凭据无法保存到系统凭据管理器")?;
        Ok(key)
    }
    #[cfg(not(windows))]
    {
        Err("当前平台暂不支持连接加密 Trae 数据库".into())
    }
}
pub fn open_source(path: &Path) -> Result<Connection, String> {
    let mut bytes = read_limited(path)?;
    if bytes.len() < PAGE {
        return Err("Trae 用量数据库尚未就绪".into());
    }
    let mut key = if bytes.starts_with(b"SQLite format 3\0") {
        None
    } else {
        Some(local_key(path, &bytes[..PAGE])?)
    };
    let walpath = PathBuf::from(format!("{}-wal", path.to_string_lossy()));
    let wal = if walpath.exists() {
        read_limited(&walpath)?
    } else {
        Vec::new()
    };
    let check = read_limited(path)?;
    let wal_check = if walpath.exists() {
        read_limited(&walpath)?
    } else {
        Vec::new()
    };
    if bytes != check || wal != wal_check {
        return Err("Trae 正在写入用量，等待下次采集".into());
    }
    let image_result = database_image(&bytes, &wal, key.as_ref());
    if let Some(key) = key.as_mut() {
        key.fill(0);
    }
    bytes.fill(0);
    let mut image = image_result?;
    let mut db = Connection::open_in_memory().map_err(|_| "无法读取 Trae 用量")?;
    let result = db.deserialize_read_exact(
        rusqlite::MAIN_DB,
        std::io::Cursor::new(&image),
        image.len(),
        true,
    );
    image.fill(0);
    result.map_err(|_| "Trae 用量数据库格式暂不支持")?;
    Ok(db)
}
