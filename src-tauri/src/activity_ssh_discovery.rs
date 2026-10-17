//! Static SSH alias discovery. Never run ssh -G: Match exec may execute code.
use serde::Serialize;
use std::{collections::BTreeSet, fs, io::Read, path::{Path, PathBuf}};

#[derive(Default, Serialize)]
pub struct Discovery { pub hosts: Vec<String>, pub warnings: Vec<String> }

struct Reader {
    home: PathBuf,
    visited: BTreeSet<PathBuf>,
    hosts: BTreeSet<String>,
    warnings: BTreeSet<String>,
    bytes: usize,
}

// Preserve Windows path separators while supporting quoted Include paths.
fn words(line: &str) -> Option<Vec<String>> {
    let mut result = Vec::new(); let mut word = String::new();
    let mut quote = None; let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek().is_some_and(|n| *n == '"' || *n == '\'' || n.is_whitespace() || *n == '#') {
            word.push(chars.next()?);
        } else if quote == Some(c) { quote = None; }
        else if quote.is_none() && matches!(c, '\'' | '"') { quote = Some(c); }
        else if quote.is_none() && c == '#' { break; }
        else if quote.is_none() && c.is_whitespace() {
            if !word.is_empty() { result.push(std::mem::take(&mut word)); }
        } else { word.push(c); }
    }
    if quote.is_some() { return None; }
    if !word.is_empty() { result.push(word); }
    Some(result)
}

impl Reader {
    fn warn(&mut self, message: &str) { self.warnings.insert(message.into()); }
    fn read(&mut self, path: &Path, base: &Path, depth: usize, optional: bool) {
        // Discovery is local configuration inspection, never a network scan.
        let name = path.to_string_lossy();
        if name.starts_with("\\\\") || name.starts_with("//") {
            self.warn("网络共享中的 SSH 配置未自动读取，可手动填写主机别名"); return;
        }
        if depth > 8 || self.visited.len() >= 128 || self.bytes >= 4 * 1024 * 1024 {
            self.warn("SSH 配置超过识别上限，部分主机请手动填写"); return;
        }
        let canonical = match fs::canonicalize(path) {
            Ok(path) => path,
            Err(error) if optional && error.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => { self.warn("部分 SSH 配置无法读取，已保留其余识别结果"); return; }
        };
        if !self.visited.insert(canonical) { return; }
        let mut bytes = Vec::new();
        let read = fs::File::open(path).and_then(|file| file.take(256 * 1024 + 1).read_to_end(&mut bytes));
        if read.is_err() { self.warn("部分 SSH 配置无法读取，已保留其余识别结果"); return; }
        self.bytes += bytes.len();
        if bytes.len() > 256 * 1024 { self.warn("SSH 配置文件过大，部分主机请手动填写"); return; }
        let Ok(text) = std::str::from_utf8(&bytes) else {
            self.warn("部分 SSH 配置编码无法识别，可手动填写主机别名"); return;
        };
        for line in text.trim_start_matches('\u{feff}').lines() {
            let line = line.trim();
            let split = line.find(|c: char| c.is_whitespace() || c == '=').unwrap_or(line.len());
            let key = &line[..split];
            if !key.eq_ignore_ascii_case("host") && !key.eq_ignore_ascii_case("include") { continue; }
            let values = line[split..].trim_start().strip_prefix('=').unwrap_or(line[split..].trim_start()).trim_start();
            let Some(values) = words(values) else { self.warn("部分 SSH 配置语法无法识别，可手动填写主机别名"); continue; };
            if key.eq_ignore_ascii_case("host") {
                for host in &values {
                    if host.is_empty() || super::validate(host, "").is_err() { continue; }
                    let excluded = values.iter().filter_map(|v| v.strip_prefix('!')).any(|pattern|
                        glob::Pattern::new(&pattern.to_ascii_lowercase()).is_ok_and(|p| p.matches(&host.to_ascii_lowercase())));
                    if excluded { continue; }
                    if self.hosts.len() >= 128 { self.warn("已识别 128 个 SSH 主机，其余主机请手动填写"); break; }
                    if !self.hosts.iter().any(|known| known.eq_ignore_ascii_case(host)) { self.hosts.insert(host.clone()); }
                }
            } else {
                for include in values { self.include(&include, base, depth + 1); }
            }
        }
    }
    fn include(&mut self, include: &str, base: &Path, depth: usize) {
        if include.contains("**") || include.contains('%') || include.contains('$') || include.starts_with('~') && !include.starts_with("~/") && !include.starts_with("~\\") {
            self.warn("部分 SSH Include 使用动态路径或递归通配符，可手动填写未识别的主机"); return;
        }
        let path = if include.starts_with("~/") || include.starts_with("~\\") { self.home.join(&include[2..]) }
            else { let path = Path::new(include); if path.is_absolute() { path.to_path_buf() } else { base.join(path) } };
        let pattern = path.to_string_lossy();
        if pattern.starts_with("\\\\") || pattern.starts_with("//") { self.warn("网络共享中的 SSH 配置未自动读取，可手动填写主机别名"); return; }
        let Ok(matches) = glob::glob(&pattern) else { self.warn("部分 SSH Include 路径无法识别"); return; };
        // glob yields paths lexically; bound both matches and aggregate reads.
        for (index, item) in matches.enumerate() {
            if index >= 128 { self.warn("SSH Include 文件过多，部分主机请手动填写"); break; }
            match item { Ok(path) => self.read(&path, base, depth, false), Err(_) => self.warn("部分 SSH Include 文件无法读取") }
        }
    }
}

/// Public for isolated fixture checks; reads configuration only, never key files.
pub fn discover_from(home: &Path, user_config: &Path, system_config: &Path) -> Discovery {
    let mut reader = Reader { home: home.into(), visited: BTreeSet::new(), hosts: BTreeSet::new(), warnings: BTreeSet::new(), bytes: 0 };
    reader.read(user_config, &home.join(".ssh"), 0, true);
    reader.read(system_config, system_config.parent().unwrap_or(Path::new("/etc/ssh")), 0, true);
    Discovery { hosts: reader.hosts.into_iter().collect(), warnings: reader.warnings.into_iter().collect() }
}

pub fn discover() -> Discovery {
    let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from).or_else(dirs::home_dir) else {
        return Discovery { hosts: vec![], warnings: vec!["无法定位本机 SSH 配置，可手动填写主机别名".into()] };
    };
    #[cfg(windows)]
    let system = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\ProgramData")).join("ssh/ssh_config");
    #[cfg(not(windows))]
    let system = PathBuf::from("/etc/ssh/ssh_config");
    discover_from(&home, &home.join(".ssh/config"), &system)
}

#[tauri::command]
pub async fn discover_codex_ssh_hosts() -> Result<Discovery, String> {
    tauri::async_runtime::spawn_blocking(discover).await.map_err(|_| "SSH 主机识别未完成，请重试".into())
}
