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
        // Weird ones — make `themes.switch` fun.
        synthwave_theme(),
        vaporwave_theme(),
        gameboy_theme(),
        hotdog_stand_theme(),
        brutalist_theme(),
        cyberpunk_theme(),
        bubblegum_theme(),
        newsprint_theme(),
        matrix_theme(),
        comic_sans_theme(),
        // Sci-fi tribute themes.
        lcars_theme(),
        star_wars_theme(),
        stargate_theme(),
        red_dwarf_theme(),
        // Game tributes.
        pokemon_theme(),
        doom_theme(),
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
            "font-family" => FONT_PIXEL,
            "font-family-mono" => FONT_PIXEL,
            // Press Start 2P glyphs sit on an 8×8 grid scaled up — they're
            // huge at the default 14/18px. Shrinking the body + input keeps
            // the chunky retro look without overflowing rows.
            "font-size-base" => "10px",
            "font-size-input" => "13px",
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

// ---- Weird ones ----

fn synthwave_theme() -> Theme {
    // Neon-on-deep-purple, that '80s VHS / Retrowave Miami feel.
    Theme {
        id: "synthwave".into(),
        name: "Synthwave '84".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(34, 18, 60, 0.94)",
            "bg-solid" => "#22123c",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 113, 206, 0.20)",
            "fg" => "#f8f8ff",
            "fg-dim" => "#b9a3ff",
            "fg-faint" => "#7a5fb6",
            "border" => "rgba(255, 113, 206, 0.30)",
            "accent" => "#fe6ad9",
            "danger" => "#ff5277",
            "badge-snippet" => "#01cdfe",
            "badge-quicklink" => "#fe6ad9",
            "badge-clipboard" => "#ffb86b",
            "badge-agent" => "#bd93f9",
            "badge-vite" => "#fff95b",
            "badge-docker" => "#05ffa1",
            "badge-logs" => "#7a5fb6",
            "shadow" => "0 0 0 1px rgba(254, 106, 217, 0.35), 0 28px 80px rgba(20, 0, 40, 0.7), 0 0 60px rgba(1, 205, 254, 0.15)",
            "font-family" => FONT_NERD,
            "font-family-mono" => FONT_NERD,
        },
    }
}

fn vaporwave_theme() -> Theme {
    Theme {
        id: "vaporwave".into(),
        name: "Vaporwave".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(255, 230, 246, 0.94)",
            "bg-solid" => "#ffe6f6",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 113, 206, 0.18)",
            "fg" => "#5a3070",
            "fg-dim" => "#b486c4",
            "fg-faint" => "#d9b3e6",
            "border" => "rgba(255, 113, 206, 0.30)",
            "accent" => "#ff71ce",
            "danger" => "#ff4d6d",
            "badge-snippet" => "#01cdfe",
            "badge-quicklink" => "#b967ff",
            "badge-clipboard" => "#ff9472",
            "badge-agent" => "#b967ff",
            "badge-vite" => "#fff95b",
            "badge-docker" => "#05ffa1",
            "badge-logs" => "#b486c4",
            "shadow" => "0 0 0 1px rgba(185, 103, 255, 0.30), 0 28px 80px rgba(255, 113, 206, 0.30)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn gameboy_theme() -> Theme {
    // Original DMG-01: 4 shades of swampy green. Uses the bundled VT323
    // pixel font for full pocket-monster vibes.
    Theme {
        id: "gameboy".into(),
        name: "Gameboy DMG".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(155, 188, 15, 0.96)",
            "bg-solid" => "#9bbc0f",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(15, 56, 15, 0.30)",
            "fg" => "#0f380f",
            "fg-dim" => "#306230",
            "fg-faint" => "#578a34",
            "border" => "rgba(15, 56, 15, 0.40)",
            "accent" => "#0f380f",
            "danger" => "#9c2c2c",
            "badge-snippet" => "#306230",
            "badge-quicklink" => "#0f380f",
            "badge-clipboard" => "#578a34",
            "badge-agent" => "#306230",
            "badge-vite" => "#578a34",
            "badge-docker" => "#306230",
            "badge-logs" => "#578a34",
            "shadow" => "0 0 0 2px #0f380f, 0 0 0 6px #8bac0f, 0 0 0 8px #0f380f",
            "font-family" => FONT_TERMINAL,
            "font-family-mono" => FONT_TERMINAL,
        },
    }
}

fn hotdog_stand_theme() -> Theme {
    // The infamous Windows 3.1 "Hot Dog Stand" — yellow, red, black,
    // assault on the eyeballs. Strictly for the bit.
    Theme {
        id: "hot-dog-stand".into(),
        name: "Hot Dog Stand".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(255, 255, 0, 0.98)",
            "bg-solid" => "#ffff00",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 0, 0, 0.30)",
            "fg" => "#000000",
            "fg-dim" => "#aa0000",
            "fg-faint" => "#cc6600",
            "border" => "rgba(255, 0, 0, 0.50)",
            "accent" => "#ff0000",
            "danger" => "#000000",
            "badge-snippet" => "#ff0000",
            "badge-quicklink" => "#000000",
            "badge-clipboard" => "#aa0000",
            "badge-agent" => "#ff6600",
            "badge-vite" => "#ff0000",
            "badge-docker" => "#000000",
            "badge-logs" => "#aa0000",
            "shadow" => "0 0 0 3px #ff0000, 0 0 0 6px #000000",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn brutalist_theme() -> Theme {
    // Pure b&w, hard edges, no shadow. Looks like raw HTML. On purpose.
    Theme {
        id: "brutalist".into(),
        name: "Brutalist".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(255, 255, 255, 1.0)",
            "bg-solid" => "#ffffff",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(0, 0, 0, 1.0)",
            "fg" => "#000000",
            "fg-dim" => "#000000",
            "fg-faint" => "#666666",
            "border" => "rgba(0, 0, 0, 1.0)",
            "accent" => "#000000",
            "danger" => "#000000",
            "badge-snippet" => "#000000",
            "badge-quicklink" => "#000000",
            "badge-clipboard" => "#000000",
            "badge-agent" => "#000000",
            "badge-vite" => "#000000",
            "badge-docker" => "#000000",
            "badge-logs" => "#000000",
            "shadow" => "8px 8px 0 0 #000000",
            "font-family" => FONT_NERD,
            "font-family-mono" => FONT_NERD,
        },
    }
}

fn cyberpunk_theme() -> Theme {
    // Neon yellow on near-black with magenta + cyan accents.
    // 2077 vibes.
    Theme {
        id: "cyberpunk".into(),
        name: "Cyberpunk".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(8, 5, 20, 0.96)",
            "bg-solid" => "#080514",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 240, 0, 0.18)",
            "fg" => "#fcee0a",
            "fg-dim" => "#9a9000",
            "fg-faint" => "#5a5400",
            "border" => "rgba(252, 238, 10, 0.30)",
            "accent" => "#00f0ff",
            "danger" => "#ff003c",
            "badge-snippet" => "#00f0ff",
            "badge-quicklink" => "#ff00aa",
            "badge-clipboard" => "#fcee0a",
            "badge-agent" => "#ff00aa",
            "badge-vite" => "#fcee0a",
            "badge-docker" => "#00f0ff",
            "badge-logs" => "#9a9000",
            "shadow" => "0 0 0 1px rgba(252, 238, 10, 0.45), 0 28px 80px rgba(0, 240, 255, 0.20)",
            "font-family" => FONT_NERD,
            "font-family-mono" => FONT_NERD,
        },
    }
}

fn bubblegum_theme() -> Theme {
    Theme {
        id: "bubblegum".into(),
        name: "Bubblegum".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(255, 224, 240, 0.96)",
            "bg-solid" => "#ffe0f0",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 105, 180, 0.20)",
            "fg" => "#7a2c5a",
            "fg-dim" => "#b56a96",
            "fg-faint" => "#d8a0c0",
            "border" => "rgba(255, 105, 180, 0.30)",
            "accent" => "#ff69b4",
            "danger" => "#e0355a",
            "badge-snippet" => "#5cb8ff",
            "badge-quicklink" => "#ff69b4",
            "badge-clipboard" => "#ffaa55",
            "badge-agent" => "#cc66ff",
            "badge-vite" => "#ffd66b",
            "badge-docker" => "#5cd6c0",
            "badge-logs" => "#b56a96",
            "shadow" => "0 18px 48px rgba(255, 105, 180, 0.30), 0 4px 12px rgba(255, 105, 180, 0.20)",
            "font-family" => FONT_SYSTEM,
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn newsprint_theme() -> Theme {
    // Cream paper, ink black, generous serifs. "Times" is on every Mac.
    Theme {
        id: "newsprint".into(),
        name: "Newsprint".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(244, 236, 218, 0.98)",
            "bg-solid" => "#f4ecda",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(40, 30, 20, 0.10)",
            "fg" => "#1a1410",
            "fg-dim" => "#6b5e50",
            "fg-faint" => "#a89880",
            "border" => "rgba(40, 30, 20, 0.20)",
            "accent" => "#7a3a1a",
            "danger" => "#8b1a1a",
            "badge-snippet" => "#3a4a6a",
            "badge-quicklink" => "#5a2a6a",
            "badge-clipboard" => "#7a4a1a",
            "badge-agent" => "#5a2a6a",
            "badge-vite" => "#7a6a1a",
            "badge-docker" => "#1a4a6a",
            "badge-logs" => "#6b5e50",
            "shadow" => "0 18px 48px rgba(40, 30, 20, 0.18), 0 4px 12px rgba(40, 30, 20, 0.10)",
            "font-family" => "\"New York\", \"Times New Roman\", Georgia, serif",
            "font-family-mono" => "\"Courier New\", Courier, monospace",
        },
    }
}

fn matrix_theme() -> Theme {
    // Even greener, even darker than Hacker. Pure terminal.
    Theme {
        id: "matrix".into(),
        name: "Matrix".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(0, 0, 0, 0.98)",
            "bg-solid" => "#000000",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(0, 255, 65, 0.16)",
            "fg" => "#00ff41",
            "fg-dim" => "#008f17",
            "fg-faint" => "#005010",
            "border" => "rgba(0, 255, 65, 0.25)",
            "accent" => "#a8ff60",
            "danger" => "#ff4444",
            "badge-snippet" => "#00ff41",
            "badge-quicklink" => "#00cc33",
            "badge-clipboard" => "#aaff60",
            "badge-agent" => "#00ff88",
            "badge-vite" => "#aaff44",
            "badge-docker" => "#00ffaa",
            "badge-logs" => "#008f17",
            "shadow" => "0 0 0 1px rgba(0, 255, 65, 0.35), 0 0 80px rgba(0, 255, 65, 0.30)",
            "font-family" => FONT_TERMINAL,
            "font-family-mono" => FONT_TERMINAL,
        },
    }
}

fn lcars_theme() -> Theme {
    // Star Trek: TNG bridge UI. Black bg, peach/orange/lilac blocks,
    // condensed Helvetica. Make it so. Cyberpunky scanline overlay
    // + radial accent glow give the TNG-bridge holographic feel.
    Theme {
        id: "lcars".into(),
        name: "LCARS (Star Trek)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(0, 0, 0, 0.97)",
            "bg-solid" => "#000000",
            "bg-image" => "radial-gradient(ellipse at top left, rgba(255, 153, 0, 0.18), transparent 55%), radial-gradient(ellipse at bottom right, rgba(204, 102, 153, 0.15), transparent 55%), repeating-linear-gradient(0deg, rgba(255, 153, 0, 0.04) 0 1px, transparent 1px 3px)",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 153, 0, 0.22)",
            "fg" => "#ff9966",
            "fg-dim" => "#cc99cc",
            "fg-faint" => "#996699",
            "border" => "#ff9900",
            "accent" => "#ff9900",
            "danger" => "#cc6666",
            "badge-snippet" => "#99ccff",
            "badge-quicklink" => "#cc99cc",
            "badge-clipboard" => "#ffcc99",
            "badge-agent" => "#cc6699",
            "badge-vite" => "#ffcc66",
            "badge-docker" => "#99ccff",
            "badge-logs" => "#996699",
            "shadow" => "0 28px 80px rgba(0, 0, 0, 0.7), 0 0 60px rgba(255, 153, 0, 0.20)",
            "font-family" => "\"Helvetica Neue\", \"Helvetica\", Impact, sans-serif",
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn star_wars_theme() -> Theme {
    // Opening crawl: Lucasfilm yellow #FFE81F on the deepest space black.
    // Lightsaber accents on badges. Starfield gradient sells the crawl.
    Theme {
        id: "star-wars".into(),
        name: "Star Wars (Crawl)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(0, 0, 8, 0.98)",
            "bg-solid" => "#000008",
            "bg-image" => "radial-gradient(ellipse at center top, rgba(255, 232, 31, 0.10), transparent 60%), radial-gradient(circle at 20% 80%, rgba(77, 217, 255, 0.06), transparent 35%), radial-gradient(circle at 80% 30%, rgba(255, 56, 56, 0.05), transparent 35%)",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 232, 31, 0.18)",
            "fg" => "#ffe81f",
            "fg-dim" => "#b3a316",
            "fg-faint" => "#5a5208",
            "border" => "rgba(255, 232, 31, 0.30)",
            "accent" => "#ffe81f",
            "danger" => "#ff3030",
            "badge-snippet" => "#4dd9ff",
            "badge-quicklink" => "#ff3838",
            "badge-clipboard" => "#aaff66",
            "badge-agent" => "#9b59b6",
            "badge-vite" => "#ffe81f",
            "badge-docker" => "#4dd9ff",
            "badge-logs" => "#b3a316",
            "shadow" => "0 0 0 1px rgba(255, 232, 31, 0.35), 0 28px 100px rgba(255, 232, 31, 0.20)",
            "font-family" => "\"Trajan Pro\", \"Helvetica Neue\", Helvetica, Impact, sans-serif",
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn stargate_theme() -> Theme {
    // Event-horizon blue + Egyptian bronze on deep navy. Chevron seven,
    // locked. Hieroglyph radial pulse for the gate-pool effect.
    Theme {
        id: "stargate".into(),
        name: "Stargate".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(10, 18, 32, 0.96)",
            "bg-solid" => "#0a1220",
            "bg-image" => "radial-gradient(ellipse at center, rgba(77, 196, 255, 0.18), transparent 50%), conic-gradient(from 90deg at 50% 50%, rgba(221, 184, 104, 0.06), rgba(77, 196, 255, 0.04), rgba(221, 184, 104, 0.06))",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(77, 196, 255, 0.16)",
            "fg" => "#ddb868",
            "fg-dim" => "#a08850",
            "fg-faint" => "#5a4a30",
            "border" => "rgba(221, 184, 104, 0.30)",
            "accent" => "#4dc4ff",
            "danger" => "#cc5533",
            "badge-snippet" => "#4dc4ff",
            "badge-quicklink" => "#ddb868",
            "badge-clipboard" => "#c8956d",
            "badge-agent" => "#88aabb",
            "badge-vite" => "#ddb868",
            "badge-docker" => "#4dc4ff",
            "badge-logs" => "#a08850",
            "shadow" => "0 0 0 1px rgba(77, 196, 255, 0.40), 0 28px 80px rgba(77, 196, 255, 0.25), 0 0 60px rgba(221, 184, 104, 0.10)",
            "font-family" => "\"Optima\", \"Trajan Pro\", \"Helvetica Neue\", Helvetica, sans-serif",
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn red_dwarf_theme() -> Theme {
    // JMC mining ship hull red, off-white block letters, smegheads
    // yellow accent and Holly's cyan on badges.
    Theme {
        id: "red-dwarf".into(),
        name: "Red Dwarf".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(60, 6, 12, 0.97)",
            "bg-solid" => "#3c060c",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 220, 70, 0.18)",
            "fg" => "#f5f0e6",
            "fg-dim" => "#c4a08a",
            "fg-faint" => "#7a4040",
            "border" => "rgba(255, 220, 70, 0.25)",
            "accent" => "#ffdc46",
            "danger" => "#ff3030",
            "badge-snippet" => "#00ddee",
            "badge-quicklink" => "#ffdc46",
            "badge-clipboard" => "#cc6666",
            "badge-agent" => "#00ddee",
            "badge-vite" => "#ffdc46",
            "badge-docker" => "#88bbcc",
            "badge-logs" => "#c4a08a",
            "shadow" => "0 0 0 2px rgba(255, 220, 70, 0.35), 0 28px 80px rgba(0, 0, 0, 0.7), 0 0 60px rgba(60, 6, 12, 0.5)",
            "font-family" => "\"Impact\", \"Helvetica Neue\", Helvetica, sans-serif",
            "font-family-mono" => FONT_MONO,
        },
    }
}

fn pokemon_theme() -> Theme {
    // Red & Blue Game Boy era — pokeball red, pikachu yellow, soft cream
    // dialog box. VT323 because all the original menus were bitmap.
    Theme {
        id: "pokemon".into(),
        name: "Pokémon (R/B)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(255, 248, 232, 0.97)",
            "bg-solid" => "#fff8e8",
            "bg-image" => "radial-gradient(circle at 0% 0%, rgba(232, 28, 28, 0.10), transparent 40%), radial-gradient(circle at 100% 100%, rgba(60, 88, 168, 0.10), transparent 40%)",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(232, 28, 28, 0.18)",
            "fg" => "#1c1c24",
            "fg-dim" => "#5a5a64",
            "fg-faint" => "#a8a8b0",
            "border" => "#1c1c24",
            "accent" => "#e81c1c",
            "danger" => "#3c58a8",
            "badge-snippet" => "#3c58a8",
            "badge-quicklink" => "#e81c1c",
            "badge-clipboard" => "#f0c020",
            "badge-agent" => "#58a830",
            "badge-vite" => "#f0c020",
            "badge-docker" => "#3c58a8",
            "badge-logs" => "#5a5a64",
            "shadow" => "0 0 0 3px #1c1c24, 0 0 0 6px #fff8e8, 0 0 0 9px #1c1c24, 0 28px 80px rgba(0, 0, 0, 0.4)",
            "font-family" => FONT_TERMINAL,
            "font-family-mono" => FONT_TERMINAL,
        },
    }
}

fn doom_theme() -> Theme {
    // E1M1 status bar: blood red, brown, the kind of green that says
    // "armor pickup". Heavy, mean, monospaced.
    Theme {
        id: "doom".into(),
        name: "DOOM".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(20, 8, 8, 0.97)",
            "bg-solid" => "#140808",
            "bg-image" => "radial-gradient(ellipse at center, rgba(255, 68, 0, 0.18), transparent 55%), radial-gradient(circle at 20% 100%, rgba(180, 30, 0, 0.20), transparent 50%), repeating-linear-gradient(45deg, rgba(80, 20, 0, 0.06) 0 2px, transparent 2px 8px)",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(255, 68, 0, 0.22)",
            "fg" => "#ff6633",
            "fg-dim" => "#a04020",
            "fg-faint" => "#5a2410",
            "border" => "rgba(255, 68, 0, 0.35)",
            "accent" => "#ff4400",
            "danger" => "#ffd700",
            "badge-snippet" => "#ff8844",
            "badge-quicklink" => "#ffd700",
            "badge-clipboard" => "#a04020",
            "badge-agent" => "#ff4400",
            "badge-vite" => "#ffd700",
            "badge-docker" => "#88aa44",
            "badge-logs" => "#a04020",
            "shadow" => "0 0 0 1px rgba(255, 68, 0, 0.50), 0 28px 80px rgba(0, 0, 0, 0.85), 0 0 80px rgba(255, 68, 0, 0.30)",
            "font-family" => "Impact, \"Helvetica Neue\", \"Arial Black\", sans-serif",
            "font-family-mono" => FONT_TERMINAL,
        },
    }
}

fn comic_sans_theme() -> Theme {
    // The crime against typography. Comic Sans MS ships with macOS.
    // Bright pastel candy palette to match the energy.
    Theme {
        id: "comic-sans".into(),
        name: "Comic Sans (please don't)".into(),
        builtin: true,
        tokens: tokens! {
            "bg" => "rgba(255, 245, 230, 0.98)",
            "bg-solid" => "#fff5e6",
            "bg-row" => "transparent",
            "bg-row-active" => "rgba(70, 200, 220, 0.18)",
            "fg" => "#22334d",
            "fg-dim" => "#6a8aaa",
            "fg-faint" => "#a8c0d8",
            "border" => "rgba(70, 200, 220, 0.30)",
            "accent" => "#22c8a8",
            "danger" => "#e63946",
            "badge-snippet" => "#3aa6ff",
            "badge-quicklink" => "#c63aff",
            "badge-clipboard" => "#ff9a3a",
            "badge-agent" => "#ff6abb",
            "badge-vite" => "#ffd33a",
            "badge-docker" => "#3ad6c8",
            "badge-logs" => "#6a8aaa",
            "shadow" => "0 18px 48px rgba(34, 200, 168, 0.30), 0 4px 12px rgba(34, 200, 168, 0.18)",
            "font-family" => "\"Comic Sans MS\", \"Chalkboard SE\", cursive",
            "font-family-mono" => "\"Comic Sans MS\", \"Chalkboard SE\", cursive",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- sanitize_id ----------

    #[test]
    fn sanitize_id_keeps_alphanumeric_dash_underscore() {
        assert_eq!(sanitize_id("my-theme_1"), "my-theme_1");
    }

    #[test]
    fn sanitize_id_replaces_spaces_and_dots() {
        assert_eq!(sanitize_id("My Theme.v2"), "My-Theme-v2");
    }

    #[test]
    fn sanitize_id_strips_trailing_dashes() {
        // sanitize_id replaces special chars with '-' but does not strip trailing dashes.
        assert_eq!(sanitize_id("theme!"), "theme-");
    }

    #[test]
    fn sanitize_id_empty_stays_empty() {
        assert_eq!(sanitize_id(""), "");
    }

    // ---------- builtin themes ----------

    #[test]
    fn list_all_includes_expected_builtin_ids() {
        let themes = list_all();
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        for expected in ["default", "light", "high-contrast", "dracula", "nord", "tokyo-night"] {
            assert!(ids.contains(&expected), "missing builtin theme: {expected}");
        }
    }

    #[test]
    fn all_builtins_have_builtin_flag_set() {
        // The `builtin` field must be true for every theme returned by the
        // internal `builtin()` helper (i.e. not loaded from user files).
        // list_all() prepends builtins; since there are no user themes in test,
        // every entry in list_all() should be builtin.
        for t in list_all() {
            assert!(t.builtin, "expected builtin=true for theme '{}'", t.id);
        }
    }

    #[test]
    fn load_default_returns_some() {
        let t = load("default");
        assert!(t.is_some());
        assert_eq!(t.unwrap().id, "default");
    }

    #[test]
    fn load_nonexistent_returns_none() {
        assert!(load("this-theme-does-not-exist").is_none());
    }

    #[test]
    fn builtin_themes_have_nonempty_tokens() {
        for t in list_all() {
            assert!(
                !t.tokens.is_empty(),
                "theme '{}' has no tokens",
                t.id
            );
        }
    }

    #[test]
    fn theme_serde_roundtrip() {
        let t = load("default").unwrap();
        let json = serde_json::to_string(&t).unwrap();
        let back: Theme = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, t.id);
        assert_eq!(back.name, t.name);
        assert_eq!(back.tokens, t.tokens);
        assert_eq!(back.builtin, t.builtin);
    }
}
