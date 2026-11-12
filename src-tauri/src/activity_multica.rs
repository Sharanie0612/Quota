//! Discover Multica-owned Codex rollouts. The Codex reader handles parsing,
//! event IDs, cursors and sync.
use super::{collect_codex_paths, files, Options, LOCAL_CODEX_LOCK};
use rusqlite::Connection;
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    fs,
    io::{BufReader, ErrorKind, Read},
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
struct Profile {
    workspaces_root: Option<PathBuf>,
}

fn child_dirs(path: &Path, allow_missing: bool, errors: &mut Vec<String>) -> Vec<PathBuf> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if allow_missing && error.kind() == ErrorKind::NotFound => return vec![],
        Err(_) => {
            errors.push("目录无法读取，请检查工作区位置或访问权限".into());
            return vec![];
        }
    };
    let mut dirs = Vec::new();
    for entry in entries {
        match entry.and_then(|entry| Ok((entry.file_type()?, entry))) {
            Ok((kind, entry))
                if kind.is_dir() && !entry.file_name().to_string_lossy().starts_with('.') =>
            {
                dirs.push(entry.path());
            }
            Ok(_) => {}
            Err(_) => errors.push("部分目录项无法读取".into()),
        }
    }
    dirs
}

fn profile_workspace(profile_dir: &Path, errors: &mut Vec<String>) -> Option<PathBuf> {
    let file = match fs::File::open(profile_dir.join("config.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return None,
        Err(_) => {
            errors.push("配置中的工作区位置无法读取，可在采集设置中手动选择".into());
            return None;
        }
    };
    // Deserialize just the path; the profile can also contain login information.
    match serde_json::from_reader::<_, Profile>(BufReader::new(file.take(256 * 1024))) {
        Ok(profile)
            if profile
                .workspaces_root
                .as_ref()
                .is_none_or(|path| path.as_os_str().is_empty() || path.is_absolute()) =>
        {
            profile
                .workspaces_root
                .filter(|path| !path.as_os_str().is_empty())
        }
        _ => {
            errors.push("配置中的工作区位置无法识别，可在采集设置中手动选择".into());
            None
        }
    }
}

fn workspace_roots(override_root: &str, errors: &mut Vec<String>) -> BTreeSet<PathBuf> {
    if !override_root.is_empty() {
        return BTreeSet::from([PathBuf::from(override_root)]);
    }
    let mut roots = BTreeSet::new();
    roots.extend(
        std::env::var_os("MULTICA_WORKSPACES_ROOT")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute()),
    );
    if let Some(home) = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
    {
        let default = home.join("multica_workspaces");
        if default.is_dir() {
            roots.insert(default);
        }
        let config = home.join(".multica");
        let profiles = child_dirs(&config.join("profiles"), true, errors);
        for profile in std::iter::once(config).chain(profiles) {
            roots.extend(profile_workspace(&profile, errors));
        }
    }
    roots
}

fn real_directory(path: &Path, errors: &mut Vec<String>) -> bool {
    match fs::symlink_metadata(path) {
        Ok(metadata) => metadata.file_type().is_dir(),
        Err(error) if error.kind() == ErrorKind::NotFound => false,
        Err(_) => {
            errors.push("部分会话目录无法读取".into());
            false
        }
    }
}

pub(super) fn collect(db: &mut Connection, options: &Options, errors: &mut Vec<String>) -> usize {
    if !options.multica_enabled {
        return 0;
    }
    let Ok(_guard) = LOCAL_CODEX_LOCK.lock() else {
        errors.push("Multica 本机采集暂不可用".into());
        return 0;
    };
    let mut paths = Vec::new();
    let mut problems = Vec::new();
    for root in workspace_roots(&options.multica_workspace_root, &mut problems) {
        for workspace in child_dirs(&root, false, &mut problems) {
            // Workspace and run names may have readable prefixes. Match the
            // fixed session layout without descending into the checked-out code.
            for run in child_dirs(&workspace, true, &mut problems) {
                let home = run.join("codex-home");
                if !real_directory(&home, &mut problems) {
                    continue;
                }
                for name in ["sessions", "archived_sessions"] {
                    let dir = home.join(name);
                    if real_directory(&dir, &mut problems) {
                        files(&dir, &mut paths, 0, &mut problems);
                    }
                }
            }
        }
    }
    // Read the durable store directly. A legacy sessions link may point to
    // ordinary personal Codex logs, which must keep their original source.
    if !options.codex_home.is_empty() {
        let store = Path::new(&options.codex_home).join("multica-sessions");
        if real_directory(&store, &mut problems) {
            files(&store, &mut paths, 0, &mut problems);
        }
    }
    paths.retain(|path| {
        path.file_stem()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("rollout-"))
    });
    if paths.is_empty() && problems.is_empty() {
        problems
            .push("暂无本机 Codex 会话日志，请确认任务在本机运行，或在采集设置中选择工作区".into());
    }
    errors.extend(
        problems
            .into_iter()
            .map(|problem| format!("Multica {problem}")),
    );
    collect_codex_paths(db, paths, &options.device_id, true, errors)
}
