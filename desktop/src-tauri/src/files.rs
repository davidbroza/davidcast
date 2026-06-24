//! File search plugin. Live `fd`-backed lookup across a small list of root
//! directories the user actually browses. Designed to be cheap on a single
//! keystroke (fd is parallel + .gitignore-aware) so the palette can debounce
//! ~200 ms and call straight into here.
//!
//! Query semantics are decided by the frontend (it parses `:png`, `:img`,
//! `:newest` etc. and hands us a structured `FileSearchOpts`). This module
//! just runs the search, decorates each hit with metadata, and answers the
//! per-row actions the palette needs (open, reveal, copy path, copy image,
//! thumbnail).

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    /// Parent directory, preserved as the user typed it (so home-relative
    /// paths stay short in the row subtitle).
    pub parent: String,
    pub size: u64,
    /// Unix milliseconds.
    pub modified_at: u64,
    pub is_image: bool,
    pub ext: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct FileSearchOpts {
    pub query: Option<String>,
    pub extensions: Vec<String>,
    pub category: Option<String>, // "image"
    pub roots: Vec<String>,
    pub sort_by_mtime: bool,
    pub limit: Option<usize>,
}

const DEFAULT_LIMIT: usize = 100;
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic"];
/// macOS screencapture writes .mov for screen recordings; users searching
/// "screenshots" usually want those alongside still PNGs.
const SCREENSHOT_VIDEO_EXTS: &[&str] = &["mov", "mp4"];
const EXCLUDES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    ".turbo",
    "build",
    ".venv",
    "__pycache__",
];

pub fn default_roots() -> Vec<String> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    ["Desktop", "Documents", "github", "Pictures"]
        .iter()
        .map(|s| home.join(s).to_string_lossy().to_string())
        .filter(|p| std::path::Path::new(p).exists())
        .collect()
}

/// Where macOS is currently saving screenshots. Reads
/// `defaults read com.apple.screencapture location`; if that's unset, falls
/// back to `~/Desktop` (the historical default) and `~/Screenshots` (Sonoma+
/// default for some installs). Only existing directories are returned.
pub fn default_screenshot_dirs() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    let mut cmd = std::process::Command::new("defaults");
    cmd.args(["read", "com.apple.screencapture", "location"]);
    if let Some(stdout) = crate::proc::capture_stdout(cmd, std::time::Duration::from_secs(3)) {
        let s = String::from_utf8_lossy(&stdout).trim().to_string();
        if !s.is_empty() {
            out.push(expand_tilde(&s));
        }
    }

    if let Some(home) = dirs::home_dir() {
        for sub in ["Screenshots", "Desktop"] {
            let p = home.join(sub).to_string_lossy().to_string();
            if !out.contains(&p) {
                out.push(p);
            }
        }
    }

    out.into_iter()
        .filter(|p| std::path::Path::new(p).exists())
        .collect()
}

/// Expand a leading `~/` or bare `~` into the home directory. Idempotent
/// for already-absolute paths.
pub fn expand_tilde(p: &str) -> String {
    if p == "~" {
        return dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| p.to_string());
    }
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    p.to_string()
}

pub fn search(mut opts: FileSearchOpts) -> Vec<FileEntry> {
    if opts.roots.is_empty() {
        opts.roots = default_roots();
    }
    let extensions = expand_extensions(&opts.extensions, opts.category.as_deref());
    let limit = opts.limit.unwrap_or(DEFAULT_LIMIT);

    let mut hits: Vec<PathBuf> = Vec::new();
    let pattern = opts
        .query
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(".");

    for root in &opts.roots {
        if !std::path::Path::new(root).exists() {
            continue;
        }
        let Some(out) = run_fd(pattern, root, &extensions) else {
            continue;
        };
        for line in out.lines() {
            if line.is_empty() {
                continue;
            }
            hits.push(PathBuf::from(line));
        }
    }

    let mut entries: Vec<FileEntry> = hits
        .into_iter()
        .filter_map(|p| decorate(&p))
        .collect();

    if opts.sort_by_mtime {
        entries.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    }
    entries.truncate(limit);
    entries
}

fn run_fd(pattern: &str, root: &str, extensions: &[String]) -> Option<String> {
    let mut cmd = std::process::Command::new("fd");
    cmd.args(["--type", "f", "--max-depth", "8", "--hidden", "--no-ignore-vcs"]);
    for ex in EXCLUDES {
        cmd.args(["--exclude", ex]);
    }
    for ext in extensions {
        cmd.args(["--extension", ext]);
    }
    cmd.arg(pattern);
    cmd.arg(root);
    // fd over a deep/large tree (or a stale network mount) can run long — cap
    // it so a slow root can't stall the whole search.
    let out = crate::proc::capture_stdout(cmd, std::time::Duration::from_secs(6))?;
    Some(String::from_utf8_lossy(&out).into_owned())
}

fn decorate(p: &Path) -> Option<FileEntry> {
    let meta = p.metadata().ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let name = p.file_name().and_then(|s| s.to_str())?.to_string();
    let parent = p
        .parent()
        .map(|x| home_relative(&x.to_string_lossy()))
        .unwrap_or_default();
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let is_image = IMAGE_EXTS.contains(&ext.as_str());
    Some(FileEntry {
        path: p.to_string_lossy().into_owned(),
        name,
        parent,
        size: meta.len(),
        modified_at,
        is_image,
        ext,
    })
}

fn home_relative(p: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let h = home.to_string_lossy().to_string();
        if let Some(rest) = p.strip_prefix(&h) {
            return format!("~{rest}");
        }
    }
    p.to_string()
}

fn expand_extensions(exts: &[String], category: Option<&str>) -> Vec<String> {
    let mut out: Vec<String> = exts.iter().map(|s| s.to_lowercase()).collect();
    let mut add = |list: &[&str]| {
        for &e in list {
            if !out.iter().any(|x| x == e) {
                out.push(e.to_string());
            }
        }
    };
    match category {
        Some("image") | Some("img") => add(IMAGE_EXTS),
        Some("screenshot") => {
            add(IMAGE_EXTS);
            add(SCREENSHOT_VIDEO_EXTS);
        }
        _ => {}
    }
    out
}

// ---------- Per-row actions ----------

pub fn open_in_default_app(path: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .status()
        .map_err(|e| format!("open: {e}"))?;
    Ok(())
}

pub fn reveal_in_finder(path: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", path])
        .status()
        .map_err(|e| format!("open -R: {e}"))?;
    Ok(())
}

/// Copy the image content (not the path) to the macOS clipboard. The user
/// can then paste it directly into Slack, Notes, an email, etc.
///
/// Implemented via AppleScript's clipboard data classes — `«class PNGf»`
/// for PNG, `JPEG` for JPEG. Unsupported formats fall back to copying the
/// path so the action never silently no-ops.
pub fn copy_image_to_clipboard(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("file not found: {path}"));
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let class = match ext.as_str() {
        "png" => "PNGf",
        "jpg" | "jpeg" => "JPEG",
        _ => return copy_path_to_clipboard(path),
    };
    // AppleScript string escape — only " and \ matter inside a quoted run.
    let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "set the clipboard to (read (POSIX file \"{p}\") as «class {c}»)",
        p = escaped,
        c = class
    );
    let mut cmd = std::process::Command::new("osascript");
    cmd.arg("-e").arg(&script);
    let out = crate::proc::output_with_timeout(cmd, std::time::Duration::from_secs(8))?;
    if !out.status.success() {
        return Err("osascript returned non-zero".into());
    }
    Ok(())
}

pub fn copy_path_to_clipboard(path: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("pbcopy spawn: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(path.as_bytes())
            .map_err(|e| format!("pbcopy write: {e}"))?;
    }
    let status = child.wait().map_err(|e| format!("pbcopy wait: {e}"))?;
    if !status.success() {
        return Err("pbcopy failed".into());
    }
    Ok(())
}

/// Read an image and return a base64 data URL the webview can render
/// directly. Big images are skipped — over 5 MB we'd rather show no
/// thumbnail than freeze the palette.
pub fn thumbnail_data_url(path: &str) -> Option<String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > 5_000_000 {
        return None;
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())?;
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        _ => return None,
    };
    let bytes = std::fs::read(p).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime, b64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_image_category() {
        let out = expand_extensions(&[], Some("image"));
        assert!(out.contains(&"png".to_string()));
        assert!(out.contains(&"jpg".to_string()));
    }

    #[test]
    fn expand_image_category_dedupes() {
        let out = expand_extensions(&["png".into()], Some("img"));
        let count = out.iter().filter(|x| x.as_str() == "png").count();
        assert_eq!(count, 1);
    }

    #[test]
    fn home_relative_strips_home() {
        if let Some(home) = dirs::home_dir() {
            let p = home.join("Desktop").to_string_lossy().to_string();
            assert!(home_relative(&p).starts_with("~/"));
        }
    }

    #[test]
    fn expand_screenshot_includes_video() {
        let out = expand_extensions(&[], Some("screenshot"));
        assert!(out.contains(&"png".to_string()));
        assert!(out.contains(&"mov".to_string()));
    }

    #[test]
    fn expand_tilde_resolves_home() {
        if let Some(home) = dirs::home_dir() {
            let h = home.to_string_lossy().to_string();
            assert_eq!(expand_tilde("~"), h);
            assert_eq!(expand_tilde("~/foo"), home.join("foo").to_string_lossy());
            assert_eq!(expand_tilde("/abs/path"), "/abs/path");
        }
    }
}
