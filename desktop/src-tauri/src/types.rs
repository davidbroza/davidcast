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
    /// Folders the "Find Screenshots" command scans, newest-mtime first.
    /// `~/Desktop` is the macOS default; `~/Pictures/Screenshots` is the
    /// most common redirect target. Stored as resolved absolute paths.
    #[serde(default = "default_screenshot_dirs")]
    pub screenshot_dirs: Vec<String>,
    /// Active theme id. Matches `themes::Theme::id` — built-in (`default`,
    /// `light`, `high-contrast`) or any user-imported theme filename.
    #[serde(default = "default_theme_id")]
    pub theme: String,
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
            screenshot_dirs: default_screenshot_dirs(),
            theme: default_theme_id(),
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

