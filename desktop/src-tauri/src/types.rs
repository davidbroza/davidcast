use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
    pub text: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub rev: u64,
    /// When true the value is treated as a secret: never shown in the
    /// palette row subtitle, and the edit form starts with the
    /// textarea masked. Default false (existing snippets unaffected).
    #[serde(default)]
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quicklink {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
    pub url: String,
    #[serde(default)]
    pub open_in: OpenIn,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub rev: u64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenIn {
    #[default]
    DefaultBrowser,
    Chrome,
    Safari,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub active_workspace: String,
    pub workspaces: Vec<Workspace>,
    /// Whether running Vite dev servers appear inline in the unfiltered
    /// palette list. The "Show Vite Ports" command always finds them
    /// regardless of this flag.
    #[serde(default = "default_true")]
    pub show_vite_inline: bool,
    /// Same idea for Docker containers.
    #[serde(default = "default_true")]
    pub show_docker_inline: bool,
    /// Whether the user's snippets appear inline in the unfiltered
    /// palette list. When off, they're only reachable via the
    /// "Search Snippets" command. Defaults on.
    #[serde(default = "default_true")]
    pub show_snippets_inline: bool,
    /// Same idea for quicklinks.
    #[serde(default = "default_true")]
    pub show_quicklinks_inline: bool,
    /// Folders the "Find Screenshots" command scans, newest-mtime first.
    /// `~/Desktop` is the macOS default; `~/Pictures/Screenshots` is the
    /// most common redirect target. Stored as resolved absolute paths.
    #[serde(default = "default_screenshot_dirs")]
    pub screenshot_dirs: Vec<String>,
    /// Active theme id. Matches `themes::Theme::id` — built-in (`default`,
    /// `light`, `high-contrast`) or any user-imported theme filename.
    #[serde(default = "default_theme_id")]
    pub theme: String,
    /// Whether to ping the GitHub Releases updater endpoint at startup.
    /// Manual "Check for Updates" still works either way.
    #[serde(default = "default_true")]
    pub check_updates_on_launch: bool,
    /// Git-based backup of the store directory. Disabled by default —
    /// the user wires up a remote in Preferences.
    #[serde(default)]
    pub backup: BackupConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    /// Master switch. When false, no auto-sync timer fires; manual
    /// "Sync now" still works as long as the repo is initialized.
    #[serde(default)]
    pub enabled: bool,
    /// Git remote URL — anything `git` can push to. Empty until the
    /// user runs Backup → Connect.
    #[serde(default)]
    pub remote: String,
    /// Branch to push to. Defaults to `main`.
    #[serde(default = "default_branch")]
    pub branch: String,
    /// Whether `analytics.jsonl` is included in the backup. Off by
    /// default for privacy — the log contains every query you've typed.
    #[serde(default)]
    pub include_analytics: bool,
    /// Unix milliseconds of the last successful push, if any.
    #[serde(default)]
    pub last_synced_ms: Option<u64>,
    /// Stderr from the last failed sync, if any. Cleared on success.
    #[serde(default)]
    pub last_error: Option<String>,
    /// Minutes between background auto-sync attempts. The timer only
    /// pushes if the repo is dirty AND this much time has elapsed.
    #[serde(default = "default_auto_interval")]
    pub auto_interval_min: u32,
}

fn default_branch() -> String {
    "main".to_string()
}

fn default_auto_interval() -> u32 {
    10
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            remote: String::new(),
            branch: default_branch(),
            include_analytics: false,
            last_synced_ms: None,
            last_error: None,
            auto_interval_min: default_auto_interval(),
        }
    }
}

fn default_theme_id() -> String {
    "default".to_string()
}

fn default_screenshot_dirs() -> Vec<String> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let mut out = vec![home.join("Desktop").to_string_lossy().into_owned()];
    let pics = home.join("Pictures").join("Screenshots");
    if pics.exists() {
        out.push(pics.to_string_lossy().into_owned());
    }
    out
}

fn default_true() -> bool {
    true
}

impl Default for Config {
    fn default() -> Self {
        Self {
            active_workspace: "personal".to_string(),
            workspaces: vec![Workspace {
                id: "personal".to_string(),
                name: "Personal".to_string(),
                color: Some("#7bd88f".to_string()),
            }],
            show_vite_inline: true,
            show_docker_inline: true,
            show_snippets_inline: true,
            show_quicklinks_inline: true,
            screenshot_dirs: default_screenshot_dirs(),
            theme: default_theme_id(),
            check_updates_on_launch: true,
            backup: BackupConfig::default(),
        }
    }
}

// Wire-format for the frontend: a flat list of items across snippets and quicklinks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    Snippet(Snippet),
    Quicklink(Quicklink),
}

