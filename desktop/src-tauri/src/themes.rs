//! JSON-driven theming. Two built-in themes (Default and Light) plus
//! anything the user drops into `~/Library/Application Support/davidcast/themes/`.
//!
//! A theme is a simple `{ id, name, tokens }` map: token names mirror the
//! CSS variables on `body[data-view="palette"]` (`bg`, `fg`, `accent`, …).
//! The frontend reads the active theme on load, sets the variables on
//! `document.documentElement`, and that's it — no rebuilding, no restart.
//!
//! User themes live as one file per theme, easy to commit, share, swap.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub id: String,
    pub name: String,
    /// CSS-variable name (without the leading `--`) → value.
    pub tokens: BTreeMap<String, String>,
    /// True for the baked-in defaults — surfaced so the UI can mark them
    /// as read-only.
    #[serde(default)]
    pub builtin: bool,
}

pub fn list_all() -> Vec<Theme> {
    let mut out = builtin();
    out.extend(list_user());
    out
}

pub fn load(id: &str) -> Option<Theme> {
    list_all().into_iter().find(|t| t.id == id)
}

pub fn themes_dir() -> Option<std::path::PathBuf> {
    crate::store::Store::root_dir()
        .ok()
        .map(|p| p.join("themes"))
}

fn list_user() -> Vec<Theme> {
    let Some(dir) = themes_dir() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let content = std::fs::read_to_string(e.path()).ok()?;
            let mut t: Theme = serde_json::from_str(&content).ok()?;
            t.builtin = false;
            Some(t)
        })
        .collect()
}

/// Save a JSON file under the user's themes directory. The id becomes the
/// filename. Used by import + export.
pub fn save_user_theme(theme: &Theme) -> Result<std::path::PathBuf, String> {
    let dir = themes_dir().ok_or("no data dir")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", sanitize_id(&theme.id)));
    let json = serde_json::to_string_pretty(theme).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn import_from_path(src: &str) -> Result<Theme, String> {
    let bytes = std::fs::read(src).map_err(|e| format!("read {src}: {e}"))?;
    let mut theme: Theme = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    theme.builtin = false;
    save_user_theme(&theme)?;
    Ok(theme)
}

fn sanitize_id(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

// ---------- Built-in themes ----------

fn builtin() -> Vec<Theme> {
    vec![default_theme(), light_theme(), high_contrast_theme()]
}

macro_rules! tokens {
    ($($k:literal => $v:literal),* $(,)?) => {{
        let mut m = BTreeMap::new();
        $(m.insert($k.to_string(), $v.to_string());)*
        m
    }};
}

fn default_theme() -> Theme {
    Theme {
        id: "default".into(),
        name: "Default (Dark)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(24, 24, 28, 0.92)",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 255, 255, 0.08)",
            "fg" => "#e8e8ea",
            "fg-dim" => "#8a8a92",
            "fg-faint" => "#5a5a60",
            "border" => "rgba(255, 255, 255, 0.06)",
            "accent" => "#7bd88f",
            "danger" => "#ef6a6a",
            "badge-snippet" => "#6aaaef",
            "badge-quicklink" => "#c56aef",
            "badge-clipboard" => "#e0a960",
            "badge-agent" => "#d08ae0",
            "badge-vite" => "#f5e961",
            "badge-docker" => "#5ab8e0",
            "badge-logs" => "#8aa2b8",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.55), 0 6px 18px rgba(0, 0, 0, 0.35)",
        },
    }
}

fn light_theme() -> Theme {
    Theme {
        id: "light".into(),
        name: "Light".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(248, 248, 250, 0.94)",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(0, 0, 0, 0.06)",
            "fg" => "#1c1c20",
            "fg-dim" => "#5a5a60",
            "fg-faint" => "#9a9aa0",
            "border" => "rgba(0, 0, 0, 0.08)",
            "accent" => "#1f8a45",
            "danger" => "#c43d3d",
            "badge-snippet" => "#1f6dc6",
            "badge-quicklink" => "#8a35c0",
            "badge-clipboard" => "#b97a35",
            "badge-agent" => "#a050b8",
            "badge-vite" => "#a07a00",
            "badge-docker" => "#1a72a8",
            "badge-logs" => "#506678",
            "shadow" => "0 18px 48px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.10)",
        },
    }
}

fn high_contrast_theme() -> Theme {
    Theme {
        id: "high-contrast".into(),
        name: "High Contrast".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(0, 0, 0, 0.96)",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 255, 255, 0.16)",
            "fg" => "#ffffff",
            "fg-dim" => "#c0c0c0",
            "fg-faint" => "#8a8a8a",
            "border" => "rgba(255, 255, 255, 0.18)",
            "accent" => "#5cff8a",
            "danger" => "#ff6a6a",
            "badge-snippet" => "#7ac4ff",
            "badge-quicklink" => "#dd9dff",
            "badge-clipboard" => "#ffc880",
            "badge-agent" => "#e8a4ff",
            "badge-vite" => "#fff36a",
            "badge-docker" => "#7ad6ff",
            "badge-logs" => "#a8c0d8",
            "shadow" => "0 0 0 1px #ffffff, 0 28px 80px rgba(0, 0, 0, 0.85)",
        },
    }
}
