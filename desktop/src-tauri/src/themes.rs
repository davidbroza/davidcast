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
    vec![
        default_theme(),
        light_theme(),
        high_contrast_theme(),
        dracula_theme(),
        nord_theme(),
        tokyo_night_theme(),
        solarized_dark_theme(),
        solarized_light_theme(),
        gruvbox_dark_theme(),
        hacker_green_theme(),
        retro_amber_theme(),
        pixel_theme(),
        nerd_theme(),
    ]
}

// Font stacks. The bundled fonts (`Press Start 2P`, `VT323`,
// `JetBrains Mono`) are loaded via @font-face in palette.css; they ship
// with the .app, so themes can reference them without any user setup.
const FONT_SYSTEM: &str = "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif";
const FONT_MONO: &str = "ui-monospace, SFMono-Regular, Menlo, monospace";
const FONT_PIXEL: &str = "\"Press Start 2P\", \"VT323\", Monaco, monospace";
const FONT_TERMINAL: &str = "\"VT323\", Monaco, Menlo, monospace";
const FONT_NERD: &str = "\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace";

macro_rules! tokens {
    ($($k:literal => $v:expr),* $(,)?) => {{
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
            "bg-solid" => "#18181c",
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
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
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
            "bg-solid" => "#f8f8fa",
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
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
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
            "bg-solid" => "#000000",
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
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

// ---- Curated dark color schemes (palette only, system font) ----

fn dracula_theme() -> Theme {
    Theme {
        id: "dracula".into(),
        name: "Dracula".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(40, 42, 54, 0.94)",
            "bg-solid" => "#282a36",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(189, 147, 249, 0.18)",
            "fg" => "#f8f8f2",
            "fg-dim" => "#9a9caf",
            "fg-faint" => "#6272a4",
            "border" => "rgba(98, 114, 164, 0.30)",
            "accent" => "#50fa7b",
            "danger" => "#ff5555",
            "badge-snippet" => "#8be9fd",
            "badge-quicklink" => "#bd93f9",
            "badge-clipboard" => "#ffb86c",
            "badge-agent" => "#ff79c6",
            "badge-vite" => "#f1fa8c",
            "badge-docker" => "#8be9fd",
            "badge-logs" => "#6272a4",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.55), 0 6px 18px rgba(0, 0, 0, 0.35)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn nord_theme() -> Theme {
    Theme {
        id: "nord".into(),
        name: "Nord".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(46, 52, 64, 0.94)",
            "bg-solid" => "#2e3440",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(136, 192, 208, 0.16)",
            "fg" => "#eceff4",
            "fg-dim" => "#a3aabd",
            "fg-faint" => "#6c7686",
            "border" => "rgba(216, 222, 233, 0.10)",
            "accent" => "#a3be8c",
            "danger" => "#bf616a",
            "badge-snippet" => "#88c0d0",
            "badge-quicklink" => "#b48ead",
            "badge-clipboard" => "#ebcb8b",
            "badge-agent" => "#b48ead",
            "badge-vite" => "#ebcb8b",
            "badge-docker" => "#81a1c1",
            "badge-logs" => "#7b8a9c",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.50), 0 6px 18px rgba(0, 0, 0, 0.32)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn tokyo_night_theme() -> Theme {
    Theme {
        id: "tokyo-night".into(),
        name: "Tokyo Night".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(26, 27, 38, 0.94)",
            "bg-solid" => "#1a1b26",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(125, 207, 255, 0.14)",
            "fg" => "#c0caf5",
            "fg-dim" => "#9aa5ce",
            "fg-faint" => "#565f89",
            "border" => "rgba(125, 207, 255, 0.10)",
            "accent" => "#9ece6a",
            "danger" => "#f7768e",
            "badge-snippet" => "#7dcfff",
            "badge-quicklink" => "#bb9af7",
            "badge-clipboard" => "#e0af68",
            "badge-agent" => "#bb9af7",
            "badge-vite" => "#e0af68",
            "badge-docker" => "#7aa2f7",
            "badge-logs" => "#737aa2",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.6), 0 6px 18px rgba(0, 0, 0, 0.4)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn solarized_dark_theme() -> Theme {
    Theme {
        id: "solarized-dark".into(),
        name: "Solarized Dark".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(0, 43, 54, 0.94)",
            "bg-solid" => "#002b36",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(38, 139, 210, 0.18)",
            "fg" => "#fdf6e3",
            "fg-dim" => "#93a1a1",
            "fg-faint" => "#586e75",
            "border" => "rgba(147, 161, 161, 0.16)",
            "accent" => "#859900",
            "danger" => "#dc322f",
            "badge-snippet" => "#268bd2",
            "badge-quicklink" => "#6c71c4",
            "badge-clipboard" => "#cb4b16",
            "badge-agent" => "#d33682",
            "badge-vite" => "#b58900",
            "badge-docker" => "#2aa198",
            "badge-logs" => "#586e75",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.5), 0 6px 18px rgba(0, 0, 0, 0.3)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn solarized_light_theme() -> Theme {
    Theme {
        id: "solarized-light".into(),
        name: "Solarized Light".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(253, 246, 227, 0.96)",
            "bg-solid" => "#fdf6e3",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(38, 139, 210, 0.14)",
            "fg" => "#073642",
            "fg-dim" => "#586e75",
            "fg-faint" => "#93a1a1",
            "border" => "rgba(7, 54, 66, 0.10)",
            "accent" => "#859900",
            "danger" => "#dc322f",
            "badge-snippet" => "#268bd2",
            "badge-quicklink" => "#6c71c4",
            "badge-clipboard" => "#cb4b16",
            "badge-agent" => "#d33682",
            "badge-vite" => "#b58900",
            "badge-docker" => "#2aa198",
            "badge-logs" => "#657b83",
            "shadow" => "0 18px 48px rgba(7, 54, 66, 0.18), 0 4px 12px rgba(7, 54, 66, 0.10)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn gruvbox_dark_theme() -> Theme {
    Theme {
        id: "gruvbox-dark".into(),
        name: "Gruvbox Dark".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(40, 40, 40, 0.94)",
            "bg-solid" => "#282828",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(254, 128, 25, 0.20)",
            "fg" => "#ebdbb2",
            "fg-dim" => "#a89984",
            "fg-faint" => "#7c6f64",
            "border" => "rgba(235, 219, 178, 0.10)",
            "accent" => "#b8bb26",
            "danger" => "#fb4934",
            "badge-snippet" => "#83a598",
            "badge-quicklink" => "#d3869b",
            "badge-clipboard" => "#fabd2f",
            "badge-agent" => "#d3869b",
            "badge-vite" => "#fabd2f",
            "badge-docker" => "#83a598",
            "badge-logs" => "#928374",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.5), 0 6px 18px rgba(0, 0, 0, 0.32)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

// ---- Themes that change typography too (pixel / terminal / nerd) ----

fn hacker_green_theme() -> Theme {
    Theme {
        id: "hacker-green".into(),
        name: "Hacker (Green on Black)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(2, 8, 4, 0.96)",
            "bg-solid" => "#020804",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(50, 255, 120, 0.14)",
            "fg" => "#33ff66",
            "fg-dim" => "#1ea84a",
            "fg-faint" => "#0f6628",
            "border" => "rgba(50, 255, 120, 0.18)",
            "accent" => "#7dff95",
            "danger" => "#ff6a6a",
            "badge-snippet" => "#33ff99",
            "badge-quicklink" => "#7dff95",
            "badge-clipboard" => "#ccff66",
            "badge-agent" => "#aaffaa",
            "badge-vite" => "#ccff33",
            "badge-docker" => "#33ffcc",
            "badge-logs" => "#1ea84a",
            "shadow" => "0 0 0 1px rgba(50, 255, 120, 0.25), 0 28px 80px rgba(0, 30, 10, 0.7)",
            "font-family" => FONT_TERMINAL,
            "font-family-mono" => FONT_TERMINAL,
        },
    }
}

fn retro_amber_theme() -> Theme {
    Theme {
        id: "retro-amber".into(),
        name: "Retro Amber CRT".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(20, 10, 0, 0.96)",
            "bg-solid" => "#140a00",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 176, 0, 0.18)",
            "fg" => "#ffb000",
            "fg-dim" => "#c08800",
            "fg-faint" => "#664500",
            "border" => "rgba(255, 176, 0, 0.20)",
            "accent" => "#ffd966",
            "danger" => "#ff6644",
            "badge-snippet" => "#ffaa33",
            "badge-quicklink" => "#ffcc66",
            "badge-clipboard" => "#ffd980",
            "badge-agent" => "#ffaa66",
            "badge-vite" => "#fff066",
            "badge-docker" => "#ffaa33",
            "badge-logs" => "#aa7700",
            "shadow" => "0 0 0 1px rgba(255, 176, 0, 0.25), 0 28px 80px rgba(40, 20, 0, 0.7)",
            "font-family" => FONT_TERMINAL,
            "font-family-mono" => FONT_TERMINAL,
        },
    }
}

fn pixel_theme() -> Theme {
    Theme {
        id: "pixel".into(),
        name: "Pixel (8-bit)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(12, 12, 24, 0.96)",
            "bg-solid" => "#0c0c18",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 220, 90, 0.18)",
            "fg" => "#ffe9a8",
            "fg-dim" => "#9a8e58",
            "fg-faint" => "#5e5232",
            "border" => "rgba(255, 220, 90, 0.20)",
            "accent" => "#7be07b",
            "danger" => "#ff5c5c",
            "badge-snippet" => "#5cd1ff",
            "badge-quicklink" => "#ff7adb",
            "badge-clipboard" => "#ffb84a",
            "badge-agent" => "#dd99ff",
            "badge-vite" => "#fff066",
            "badge-docker" => "#5cd1ff",
            "badge-logs" => "#9a8e58",
            "shadow" => "0 0 0 1px rgba(255, 220, 90, 0.25), 0 28px 80px rgba(0, 0, 0, 0.7)",
            // Press Start 2P is *very* big at 14px — but the bundled glyphs
            // are designed for that pixel grid, so we let the user feel it.
            "font-family" => FONT_PIXEL,
            "font-family-mono" => FONT_PIXEL,
        },
    }
}

fn nerd_theme() -> Theme {
    // Tokyo-Night-ish palette + JetBrains Mono everywhere — the
    // quintessential developer-tooling look.
    Theme {
        id: "nerd".into(),
        name: "Nerd (JetBrains Mono)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(24, 26, 38, 0.94)",
            "bg-solid" => "#181a26",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(125, 207, 255, 0.16)",
            "fg" => "#c8d3f5",
            "fg-dim" => "#86a1c4",
            "fg-faint" => "#535f7a",
            "border" => "rgba(125, 207, 255, 0.12)",
            "accent" => "#9ece6a",
            "danger" => "#f7768e",
            "badge-snippet" => "#7dcfff",
            "badge-quicklink" => "#c099ff",
            "badge-clipboard" => "#ffaa66",
            "badge-agent" => "#bb9af7",
            "badge-vite" => "#ffd166",
            "badge-docker" => "#7aa2f7",
            "badge-logs" => "#7077a1",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.6), 0 6px 18px rgba(0, 0, 0, 0.4)",
            "font-family" => FONT_NERD,
            "font-family-mono" => FONT_NERD,
        },
    }
}
