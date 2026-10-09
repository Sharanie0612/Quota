//! Read only the authorized Trae Agent process; never inject or write memory.
use super::verify_key;
use std::{
    collections::BTreeSet,
    ffi::c_void,
    mem::size_of,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::{Debug::ReadProcessMemory, ToolHelp::*},
        Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, PAGE_GUARD, PAGE_NOACCESS},
        Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    },
};
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn wide(v: &[u16]) -> String {
    String::from_utf16_lossy(&v[..v.iter().position(|c| *c == 0).unwrap_or(v.len())])
}
fn agent_loaded(pid: u32) -> bool {
    unsafe {
        let raw = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
        if raw == INVALID_HANDLE_VALUE {
            return false;
        }
        let h = Handle(raw);
        let mut m: MODULEENTRY32W = std::mem::zeroed();
        m.dwSize = size_of::<MODULEENTRY32W>() as u32;
        let mut more = Module32FirstW(h.0, &mut m) != 0;
        while more {
            if wide(&m.szModule).eq_ignore_ascii_case("ai_agent.dll") {
                return true;
            }
            more = Module32NextW(h.0, &mut m) != 0;
        }
        false
    }
}
fn decode_hex(raw: &[u8]) -> Option<[u8; 32]> {
    if raw.len() != 64 {
        return None;
    }
    let mut result = [0; 32];
    let n = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    for (i, pair) in raw.chunks_exact(2).enumerate() {
        result[i] = n(pair[0])? * 16 + n(pair[1])?;
    }
    Some(result)
}
fn scan(h: HANDLE, page: &[u8], deadline: Instant) -> Option<[u8; 32]> {
    let mut address = 0usize;
    let mut seen = BTreeSet::new();
    let mut total = 0usize;
    unsafe {
        while Instant::now() < deadline && total < 512 * 1024 * 1024 {
            let mut region: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
            if VirtualQueryEx(
                h,
                address as *const c_void,
                &mut region,
                size_of::<MEMORY_BASIC_INFORMATION>(),
            ) == 0
            {
                break;
            }
            let base = region.BaseAddress as usize;
            let end = base.checked_add(region.RegionSize)?;
            if end <= address {
                break;
            }
            address = end;
            if region.State != MEM_COMMIT
                || region.Protect & (PAGE_GUARD | PAGE_NOACCESS) != 0
                || region.Protect & 0xff == 0
            {
                continue;
            }
            let mut pos = base;
            while pos < end && Instant::now() < deadline && total < 512 * 1024 * 1024 {
                let size = (end - pos).min(1024 * 1024);
                let mut bytes = vec![0u8; size];
                let mut read = 0;
                ReadProcessMemory(
                    h,
                    pos as *const c_void,
                    bytes.as_mut_ptr().cast(),
                    size,
                    &mut read,
                );
                total += size;
                bytes.truncate(read);
                let mut start = 0;
                while start < bytes.len() {
                    if !bytes[start].is_ascii_hexdigit() {
                        start += 1;
                        continue;
                    }
                    let mut stop = start;
                    while stop < bytes.len() && bytes[stop].is_ascii_hexdigit() {
                        stop += 1;
                    }
                    if stop - start == 64 || stop - start == 96 {
                        if let Some(key) = decode_hex(&bytes[start..start + 64]) {
                            if seen.len() < 4096 && seen.insert(key) && verify_key(&key, page) {
                                bytes.fill(0);
                                return Some(key);
                            }
                        }
                    }
                    start = stop;
                }
                bytes.fill(0);
                if size <= 192 {
                    break;
                }
                pos += size - 192;
            }
        }
    }
    None
}
pub(super) fn find_key(page: &[u8]) -> Result<[u8; 32], String> {
    unsafe {
        let raw = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if raw == INVALID_HANDLE_VALUE {
            return Err("Trae 进程暂时无法读取".into());
        }
        let h = Handle(raw);
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(h.0, &mut e) != 0;
        let mut found = false;
        let deadline = Instant::now() + Duration::from_secs(12);
        while more && Instant::now() < deadline {
            let name = wide(&e.szExeFile).to_ascii_lowercase();
            if matches!(
                name.as_str(),
                "trae cn.exe" | "trae.exe" | "trae solo cn.exe" | "trae solo.exe"
            ) && agent_loaded(e.th32ProcessID)
            {
                found = true;
                let raw = OpenProcess(
                    PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                    0,
                    e.th32ProcessID,
                );
                if !raw.is_null() {
                    let process = Handle(raw);
                    if let Some(key) = scan(process.0, page, deadline) {
                        return Ok(key);
                    }
                }
            }
            more = Process32NextW(h.0, &mut e) != 0;
        }
        Err(if found {
            "Trae 本地用量尚未连接，请在 Trae 打开一个已有会话后重试"
        } else {
            "首次连接需打开 Trae 或 Trae SOLO；连接后可离线读取历史用量"
        }
        .into())
    }
}
