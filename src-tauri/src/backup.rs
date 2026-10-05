//! 加密备份的密封与开启：备份文件 = JSON 头 + AES-256-GCM 密文。
//! 密钥由用户输入的密码经 PBKDF2-HMAC-SHA256 派生，密码不落盘、不进日志。

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

const MAGIC: &str = "QuotaBackup";
const VERSION: u32 = 1;
/// OWASP 2023 建议的 PBKDF2-SHA256 迭代下限
const KDF_ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Serialize, Deserialize)]
struct BackupFile {
    magic: String,
    version: u32,
    iterations: u32,
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn b64() -> impl Engine {
    base64::engine::general_purpose::STANDARD
}

fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// 加密 payload，返回可以直接写入文件的 JSON 字节
pub fn seal(password: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
    if password.is_empty() {
        return Err("备份密码不能为空".into());
    }
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);

    let key = derive_key(password, &salt, KDF_ITERATIONS);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("初始化加密失败：{e}"))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), payload)
        .map_err(|e| format!("加密失败：{e}"))?;

    let engine = b64();
    let file = BackupFile {
        magic: MAGIC.into(),
        version: VERSION,
        iterations: KDF_ITERATIONS,
        salt: engine.encode(salt),
        nonce: engine.encode(nonce),
        ciphertext: engine.encode(ciphertext),
    };
    serde_json::to_vec_pretty(&file).map_err(|e| format!("序列化备份失败：{e}"))
}

/// 解密备份文件，失败（密码错误或文件损坏）统一报错
pub fn open(password: &str, file_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let file: BackupFile = serde_json::from_slice(file_bytes)
        .map_err(|_| "不是有效的 Quota 备份文件".to_string())?;
    if file.magic != MAGIC {
        return Err("不是有效的 Quota 备份文件".into());
    }
    if file.version > VERSION {
        return Err("备份文件由更新版本的 Quota 导出，请先升级本应用".into());
    }
    let engine = b64();
    let salt = engine.decode(&file.salt).map_err(|_| "备份文件已损坏".to_string())?;
    let nonce = engine.decode(&file.nonce).map_err(|_| "备份文件已损坏".to_string())?;
    let ciphertext = engine
        .decode(&file.ciphertext)
        .map_err(|_| "备份文件已损坏".to_string())?;
    if salt.len() != SALT_LEN || nonce.len() != NONCE_LEN || file.iterations != KDF_ITERATIONS {
        return Err("备份文件已损坏".into());
    }

    let key = derive_key(password, &salt, file.iterations);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("初始化解密失败：{e}"))?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "解密失败：密码错误，或备份文件已损坏".to_string())
}
