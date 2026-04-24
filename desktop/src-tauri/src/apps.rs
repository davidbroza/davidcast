use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
}

#[cfg(target_os = "macos")]
pub fn list_apps() -> Vec<AppEntry> {
    let mut out: Vec<AppEntry> = Vec::new();
    let mut roots: Vec<PathBuf> = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    for root in roots {
        scan(&root, &mut out, 0);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.path == b.path);
    out
}

#[cfg(not(target_os = "macos"))]
pub fn list_apps() -> Vec<AppEntry> {
    Vec::new()
}

fn scan(dir: &Path, out: &mut Vec<AppEntry>, depth: usize) {
    if depth > 2 {
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        let is_app = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("app"))
            .unwrap_or(false);
        if is_app {
            if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                out.push(AppEntry {
                    name: name.to_string(),
                    path: path.to_string_lossy().to_string(),
                });
            }
            continue;
        }
        if path.is_dir() {
            // Recurse into "Utilities", etc.
            scan(&path, out, depth + 1);
        }
    }
}
