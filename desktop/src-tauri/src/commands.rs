use crate::actions;
use crate::agents::{self, AgentEntry};
use crate::analytics;
use crate::apps::{self, AppEntry};
use crate::backup;
use crate::clipboard::{self, ClipboardEntry};
use crate::docker_ps::{self, DockerEntry};
use crate::files::{self, FileEntry, FileSearchOpts};
use crate::icons;
use crate::skills::{self, SkillEntry};
use crate::stats::{self, Stats};
use crate::store::Store;
use crate::system;
use crate::types::*;
use crate::themes::{self, Theme};
use crate::vite_ports::{self, VitePortEntry};
use crate::window_mgmt;
use chrono::Utc;
use parking_lot::RwLock;
use std::collections::HashMap;
use tauri::{AppHandle, State};
use uuid::Uuid;

pub type StoreState<'r> = State<'r, RwLock<Store>>;

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn new_id() -> String {
    Uuid::now_v7().to_string()
}

fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    // collapse dashes
    let mut out = String::new();
    let mut last_dash = false;
    for c in s.chars() {
        if c == '-' {
            if !last_dash && !out.is_empty() {
                out.push('-');
            }
            last_dash = true;
        } else {
            out.push(c);
            last_dash = false;
        }
    }
    out.trim_end_matches('-').to_string()
}

// ---------- Settings ----------

#[derive(serde::Serialize)]
pub struct Settings {
    pub show_vite_inline: bool,
    pub show_docker_inline: bool,
    pub show_snippets_inline: bool,
    pub show_quicklinks_inline: bool,
    pub screenshot_dirs: Vec<String>,
    pub check_updates_on_launch: bool,
}

#[tauri::command]
pub fn get_settings(store: StoreState<'_>) -> Settings {
    let s = store.read();
    Settings {
        show_vite_inline: s.config.show_vite_inline,
        show_docker_inline: s.config.show_docker_inline,
        show_snippets_inline: s.config.show_snippets_inline,
        show_quicklinks_inline: s.config.show_quicklinks_inline,
        screenshot_dirs: s.config.screenshot_dirs.clone(),
        check_updates_on_launch: s.config.check_updates_on_launch,
    }
}

#[tauri::command]
pub fn set_check_updates_on_launch(value: bool, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.check_updates_on_launch = value;
    s.save_config().map_err(|e| e.to_string())
}

// ---------- Backup ----------

#[derive(serde::Serialize)]
pub struct BackupSettings {
    pub enabled: bool,
    pub remote: String,
    pub branch: String,
    pub include_analytics: bool,
    pub auto_interval_min: u32,
}

#[tauri::command]
pub fn get_backup_settings(store: StoreState<'_>) -> BackupSettings {
    let s = store.read();
    BackupSettings {
        enabled: s.config.backup.enabled,
        remote: s.config.backup.remote.clone(),
        branch: s.config.backup.branch.clone(),
        include_analytics: s.config.backup.include_analytics,
        auto_interval_min: s.config.backup.auto_interval_min,
    }
}

#[tauri::command]
pub fn set_backup_remote(value: String, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.backup.remote = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_backup_branch(value: String, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.backup.branch = if value.trim().is_empty() {
        "main".to_string()
    } else {
        value
    };
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_backup_enabled(value: bool, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.backup.enabled = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_backup_include_analytics(
    value: bool,
    store: StoreState<'_>,
) -> Result<(), String> {
    let mut s = store.write();
    s.config.backup.include_analytics = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn backup_status(store: StoreState<'_>) -> backup::BackupStatus {
    let s = store.read();
    let branch = s.config.backup.branch.clone();
    let last_ms = s.config.backup.last_synced_ms;
    let last_err = s.config.backup.last_error.clone();
    drop(s);
    backup::status(&branch, last_ms, last_err)
}

fn record_sync_outcome(
    store: &StoreState<'_>,
    result: Result<(), String>,
) -> Result<backup::BackupStatus, String> {
    let mut s = store.write();
    match &result {
        Ok(()) => {
            s.config.backup.last_synced_ms = Some(now_ms());
            s.config.backup.last_error = None;
        }
        Err(e) => {
            s.config.backup.last_error = Some(e.clone());
        }
    }
    s.save_config().map_err(|e| e.to_string())?;
    let branch = s.config.backup.branch.clone();
    let last_ms = s.config.backup.last_synced_ms;
    let last_err = s.config.backup.last_error.clone();
    drop(s);
    result?;
    Ok(backup::status(&branch, last_ms, last_err))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn backup_init(store: StoreState<'_>) -> Result<backup::BackupStatus, String> {
    let s = store.read();
    let cfg = s.config.backup.clone();
    drop(s);
    let result = backup::init(&cfg.remote, &cfg.branch, cfg.include_analytics);
    record_sync_outcome(&store, result)
}

#[tauri::command]
pub fn backup_sync(store: StoreState<'_>) -> Result<backup::BackupStatus, String> {
    let s = store.read();
    let cfg = s.config.backup.clone();
    drop(s);
    let result = backup::sync(&cfg.branch, cfg.include_analytics);
    record_sync_outcome(&store, result)
}

#[tauri::command]
pub fn backup_pull(store: StoreState<'_>) -> Result<backup::BackupStatus, String> {
    let s = store.read();
    let branch = s.config.backup.branch.clone();
    drop(s);
    let result = backup::pull(&branch);
    record_sync_outcome(&store, result)
}

#[tauri::command]
pub fn backup_force_push(
    store: StoreState<'_>,
) -> Result<backup::BackupStatus, String> {
    let s = store.read();
    let branch = s.config.backup.branch.clone();
    drop(s);
    let result = backup::force_push(&branch);
    record_sync_outcome(&store, result)
}

#[tauri::command]
pub fn backup_git_dir() -> Option<String> {
    backup::git_dir_path()
}

#[tauri::command]
pub fn set_show_vite_inline(value: bool, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.show_vite_inline = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_show_docker_inline(value: bool, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.show_docker_inline = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_show_snippets_inline(value: bool, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.show_snippets_inline = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_show_quicklinks_inline(value: bool, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.show_quicklinks_inline = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_screenshot_dirs(value: Vec<String>, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    s.config.screenshot_dirs = value;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_screenshots(limit: Option<usize>, store: StoreState<'_>) -> Vec<FileEntry> {
    let s = store.read();
    let configured: Vec<String> = s.config.screenshot_dirs.clone();
    drop(s);

    // Expand `~/...`, drop nonexistent paths so a stale config never silently
    // returns zero results.
    let mut roots: Vec<String> = configured
        .into_iter()
        .map(|p| files::expand_tilde(&p))
        .filter(|p| std::path::Path::new(p).exists())
        .collect();

    // Always merge in the macOS-resolved screenshot location + ~/Desktop.
    // Without this, a misconfigured `screenshot_dirs` (e.g. a folder the
    // user renamed) means the palette shows nothing — even though the
    // screenshots live in the OS-default folder.
    for p in files::default_screenshot_dirs() {
        if !roots.contains(&p) {
            roots.push(p);
        }
    }

    files::search(FileSearchOpts {
        query: None,
        extensions: vec![],
        // Includes PNG/JPG/HEIC + .mov/.mp4 screen recordings that
        // `screencapture -V` produces.
        category: Some("screenshot".into()),
        roots,
        sort_by_mtime: true,
        limit: Some(limit.unwrap_or(50)),
    })
}

// ---------- File search ----------

#[tauri::command]
pub fn search_files(opts: FileSearchOpts) -> Vec<FileEntry> {
    files::search(opts)
}

#[tauri::command]
pub fn open_file(path: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    files::open_in_default_app(&path)
}

#[tauri::command]
pub fn reveal_file(path: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    files::reveal_in_finder(&path)
}

#[tauri::command]
pub fn copy_file_path(path: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    files::copy_path_to_clipboard(&path)
}

#[tauri::command]
pub fn copy_file_image(path: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    files::copy_image_to_clipboard(&path)
}

#[tauri::command]
pub fn file_thumbnail(path: String) -> Option<String> {
    files::thumbnail_data_url(&path)
}

// ---------- Skills ----------

#[tauri::command]
pub fn list_skills() -> Vec<SkillEntry> {
    skills::list_skills()
}

#[tauri::command]
pub fn read_skill(path: String) -> Result<String, String> {
    skills::read_body(&path)
}

// ---------- Themes ----------

#[tauri::command]
pub fn list_themes() -> Vec<Theme> {
    themes::list_all()
}

#[tauri::command]
pub fn get_active_theme(store: StoreState<'_>) -> Theme {
    let id = store.read().config.theme.clone();
    themes::load(&id).unwrap_or_else(|| {
        // Fall back to default if the configured id was deleted out from
        // under us (e.g. user removed a custom theme file).
        themes::load("default").expect("default theme always present")
    })
}

#[tauri::command]
pub fn set_active_theme(id: String, store: StoreState<'_>) -> Result<Theme, String> {
    if themes::load(&id).is_none() {
        return Err(format!("theme not found: {id}"));
    }
    let mut s = store.write();
    s.config.theme = id.clone();
    s.save_config().map_err(|e| e.to_string())?;
    drop(s);
    themes::load(&id).ok_or_else(|| "theme vanished mid-update".to_string())
}

#[tauri::command]
pub fn import_theme(path: String) -> Result<Theme, String> {
    themes::import_from_path(&path)
}

#[tauri::command]
pub fn themes_dir() -> Option<String> {
    themes::themes_dir().map(|p| p.to_string_lossy().into_owned())
}

// ---------- Window management ----------
//
// Each command hides the palette (so focus returns to the previous app),
// waits a beat for the OS to follow through, then runs an osascript that
// repositions the now-frontmost window. The 60ms sleep is the same trick
// agents.rs uses for terminal activation.

fn run_wm<F: FnOnce() -> Result<(), String>>(app: &AppHandle, op: F) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(60));
    op()
}

#[tauri::command]
pub fn wm_left_half(app: AppHandle) -> Result<(), String> {
    run_wm(&app, window_mgmt::left_half)
}

#[tauri::command]
pub fn wm_right_half(app: AppHandle) -> Result<(), String> {
    run_wm(&app, window_mgmt::right_half)
}

#[tauri::command]
pub fn wm_top_half(app: AppHandle) -> Result<(), String> {
    run_wm(&app, window_mgmt::top_half)
}

#[tauri::command]
pub fn wm_bottom_half(app: AppHandle) -> Result<(), String> {
    run_wm(&app, window_mgmt::bottom_half)
}

#[tauri::command]
pub fn wm_maximize(app: AppHandle) -> Result<(), String> {
    run_wm(&app, window_mgmt::maximize)
}

#[tauri::command]
pub fn wm_center(app: AppHandle) -> Result<(), String> {
    run_wm(&app, window_mgmt::center)
}

// ---------- System quick actions ----------
//
// Same hide-then-act pattern as window management: drop the palette so
// the keystroke / pmset target lands somewhere sensible, then run the
// shell-out. Destructive actions (restart/shutdown/logout/empty trash)
// are gated by a frontend confirm step before they get here.

fn run_system<F: FnOnce() -> Result<(), String>>(
    app: &AppHandle,
    op: F,
) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(60));
    op()
}

#[tauri::command]
pub fn system_lock_screen(app: AppHandle) -> Result<(), String> {
    run_system(&app, system::lock_screen)
}

#[tauri::command]
pub fn system_sleep(app: AppHandle) -> Result<(), String> {
    run_system(&app, system::sleep_now)
}

#[tauri::command]
pub fn system_empty_trash(app: AppHandle) -> Result<(), String> {
    run_system(&app, system::empty_trash)
}

#[tauri::command]
pub fn system_restart(app: AppHandle) -> Result<(), String> {
    run_system(&app, system::restart)
}

#[tauri::command]
pub fn system_shut_down(app: AppHandle) -> Result<(), String> {
    run_system(&app, system::shut_down)
}

#[tauri::command]
pub fn system_log_out(app: AppHandle) -> Result<(), String> {
    run_system(&app, system::log_out)
}

// ---------- System stats ----------

#[tauri::command]
pub fn system_stats() -> Stats {
    stats::collect()
}

// ---------- Analytics ----------

#[tauri::command]
pub fn analytics_record(
    session_id: String,
    kind: String,
    data: serde_json::Value,
) -> Result<(), String> {
    analytics::record(session_id, kind, data)
}

#[tauri::command]
pub fn analytics_tail(limit: usize) -> Vec<serde_json::Value> {
    analytics::tail(limit)
}

#[tauri::command]
pub fn analytics_clear() -> Result<(), String> {
    analytics::clear()
}

#[tauri::command]
pub fn analytics_summary() -> analytics::AnalyticsSummary {
    analytics::summarize()
}

#[tauri::command]
pub fn analytics_log_path() -> Option<String> {
    analytics::log_path().map(|p| p.to_string_lossy().to_string())
}

// ---------- Workspace commands ----------

#[derive(serde::Serialize)]
pub struct WorkspaceList {
    pub workspaces: Vec<Workspace>,
    pub active: String,
}

#[tauri::command]
pub fn list_workspaces(store: StoreState<'_>) -> Result<WorkspaceList, String> {
    let s = store.read();
    Ok(WorkspaceList {
        workspaces: s.config.workspaces.clone(),
        active: s.config.active_workspace.clone(),
    })
}

#[tauri::command]
pub fn set_active_workspace(id: String, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    if !s.config.workspaces.iter().any(|w| w.id == id) {
        return Err(format!("workspace {id} not found"));
    }
    Store::ensure_workspace_dir(&s.root, &id).map_err(|e| e.to_string())?;
    s.config.active_workspace = id;
    s.save_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace(
    name: String,
    color: Option<String>,
    store: StoreState<'_>,
) -> Result<Workspace, String> {
    let mut s = store.write();
    let id = slug(&name);
    if id.is_empty() {
        return Err("name must contain alphanumerics".into());
    }
    if s.config.workspaces.iter().any(|w| w.id == id) {
        return Err(format!("workspace {id} already exists"));
    }
    let ws = Workspace { id: id.clone(), name, color };
    s.config.workspaces.push(ws.clone());
    Store::ensure_workspace_dir(&s.root, &id).map_err(|e| e.to_string())?;
    s.save_config().map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn delete_workspace(id: String, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.write();
    if s.config.workspaces.len() <= 1 {
        return Err("cannot delete the last workspace".into());
    }
    let Some(idx) = s.config.workspaces.iter().position(|w| w.id == id) else {
        return Err(format!("workspace {id} not found"));
    };
    s.config.workspaces.remove(idx);
    if s.config.active_workspace == id {
        s.config.active_workspace = s.config.workspaces[0].id.clone();
    }
    s.save_config().map_err(|e| e.to_string())?;
    // We intentionally leave the workspace directory on disk for safety;
    // the user can remove it manually if they want.
    Ok(())
}

// ---------- Item listing ----------

#[tauri::command]
pub fn list_items(store: StoreState<'_>) -> Result<Vec<Item>, String> {
    let s = store.read();
    let snippets = s.load_snippets().map_err(|e| e.to_string())?;
    let quicklinks = s.load_quicklinks().map_err(|e| e.to_string())?;
    let mut items: Vec<Item> = Vec::new();
    for x in snippets.into_iter().filter(|x| !x.deleted) {
        items.push(Item::Snippet(x));
    }
    for x in quicklinks.into_iter().filter(|x| !x.deleted) {
        items.push(Item::Quicklink(x));
    }
    Ok(items)
}

// ---------- Palette ----------
//
// The palette mixes four sources into one searchable list:
//   - built-in commands ("Create Snippet", "Preferences", ...)
//   - user snippets
//   - user quicklinks
//   - installed macOS apps

#[derive(serde::Serialize, Clone)]
pub struct CommandEntry {
    pub id: String,
    pub name: String,
    pub subtitle: String,
}

/// Wire-format wrapper that pairs a container with the action mode the row
/// represents. We push two of these per container — one for `shell`, one for
/// `logs` — so each action is searchable on its own (e.g. "logs nginx").
#[derive(serde::Serialize, Clone)]
pub struct DockerPaletteEntry {
    #[serde(flatten)]
    pub container: DockerEntry,
    pub mode: String, // "shell" | "logs"
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PaletteEntry {
    Command(CommandEntry),
    Snippet(Snippet),
    Quicklink(Quicklink),
    App(AppEntry),
    Agent(AgentEntry),
    Vite(VitePortEntry),
    Docker(DockerPaletteEntry),
    // The variants below are constructed on the frontend (their list
    // commands return the inner shape; the kind tag is added in TS).
    // Kept here so the wire union is exhaustive and matches TS.
    #[allow(dead_code)]
    Clipboard(ClipboardEntry),
    #[allow(dead_code)]
    File(FileEntry),
    #[allow(dead_code)]
    Theme(Theme),
    #[allow(dead_code)]
    Skill(SkillEntry),
}

fn builtin_commands() -> Vec<CommandEntry> {
    vec![
        CommandEntry {
            id: "create.snippet".into(),
            name: "Create Snippet".into(),
            subtitle: "New snippet in this workspace".into(),
        },
        CommandEntry {
            id: "create.quicklink".into(),
            name: "Create Quicklink".into(),
            subtitle: "New quicklink in this workspace".into(),
        },
        CommandEntry {
            id: "search.snippets".into(),
            name: "Search Snippets".into(),
            subtitle: "Browse only your snippets".into(),
        },
        CommandEntry {
            id: "search.quicklinks".into(),
            name: "Search Quicklinks".into(),
            subtitle: "Browse only your quicklinks".into(),
        },
        CommandEntry {
            id: "show.clipboard".into(),
            name: "Show Clipboard History".into(),
            subtitle: "Recent items you've copied — ⌘⇧V".into(),
        },
        CommandEntry {
            id: "show.agents".into(),
            name: "Show Running Agents".into(),
            subtitle: "Claude CLI sessions — jump back to the terminal".into(),
        },
        CommandEntry {
            id: "show.vite".into(),
            name: "Show Vite Ports".into(),
            subtitle: "Running Vite dev servers — open in browser".into(),
        },
        CommandEntry {
            id: "show.docker".into(),
            name: "Show Docker Containers".into(),
            subtitle: "Running containers — shell in or follow logs".into(),
        },
        CommandEntry {
            id: "files.find".into(),
            name: "Find Files".into(),
            subtitle: "fd-backed search — :png, :img, :newest filters".into(),
        },
        CommandEntry {
            id: "files.screenshots".into(),
            name: "Find Screenshots".into(),
            subtitle: "Most recent images on Desktop & Pictures".into(),
        },
        CommandEntry {
            id: "skills.search".into(),
            name: "Search Skills".into(),
            subtitle: "Browse Claude Code SKILL.md files — preview, copy path, open".into(),
        },
        CommandEntry {
            id: "wm.left".into(),
            name: "Window: Left Half".into(),
            subtitle: "Resize the frontmost window to the left half".into(),
        },
        CommandEntry {
            id: "wm.right".into(),
            name: "Window: Right Half".into(),
            subtitle: "Resize the frontmost window to the right half".into(),
        },
        CommandEntry {
            id: "wm.top".into(),
            name: "Window: Top Half".into(),
            subtitle: "Resize the frontmost window to the top half".into(),
        },
        CommandEntry {
            id: "wm.bottom".into(),
            name: "Window: Bottom Half".into(),
            subtitle: "Resize the frontmost window to the bottom half".into(),
        },
        CommandEntry {
            id: "wm.maximize".into(),
            name: "Window: Maximize".into(),
            subtitle: "Fill the visible desktop".into(),
        },
        CommandEntry {
            id: "wm.center".into(),
            name: "Window: Center".into(),
            subtitle: "Two-thirds size, centred".into(),
        },
        CommandEntry {
            id: "themes.switch".into(),
            name: "Switch Theme".into(),
            subtitle: "Pick a colour theme — built-in or your own JSON".into(),
        },
        CommandEntry {
            id: "system.lock".into(),
            name: "Lock Screen".into(),
            subtitle: "Lock the Mac (⌃⌘Q)".into(),
        },
        CommandEntry {
            id: "system.sleep".into(),
            name: "Sleep".into(),
            subtitle: "Put the Mac to sleep".into(),
        },
        CommandEntry {
            id: "system.empty_trash".into(),
            name: "Empty Trash".into(),
            subtitle: "Permanently delete everything in Trash".into(),
        },
        CommandEntry {
            id: "system.restart".into(),
            name: "Restart".into(),
            subtitle: "Restart the Mac (confirms before)".into(),
        },
        CommandEntry {
            id: "system.shut_down".into(),
            name: "Shut Down".into(),
            subtitle: "Shut down the Mac (confirms before)".into(),
        },
        CommandEntry {
            id: "system.log_out".into(),
            name: "Log Out".into(),
            subtitle: "Log out of your macOS user (confirms before)".into(),
        },
        CommandEntry {
            id: "open.preferences".into(),
            name: "Open Preferences".into(),
            subtitle: "Autostart, workspaces, import".into(),
        },
        CommandEntry {
            id: "help.show".into(),
            name: "Show Help".into(),
            subtitle: "Every davidcast feature, command, and shortcut".into(),
        },
        CommandEntry {
            id: "show.analytics".into(),
            name: "Show Analytics".into(),
            subtitle: "Top queries, top items, daily activity — local only".into(),
        },
        CommandEntry {
            id: "show.stats".into(),
            name: "Show System Stats".into(),
            subtitle: "CPU load, memory, disk, battery, thermal — local snapshot".into(),
        },
        CommandEntry {
            id: "app.check_updates".into(),
            name: "Check for Updates".into(),
            subtitle: "Ping the release endpoint and install if newer".into(),
        },
        CommandEntry {
            id: "switch.workspace".into(),
            name: "Switch Workspace".into(),
            subtitle: "Change the active workspace".into(),
        },
    ]
}

#[tauri::command]
pub fn list_palette(store: StoreState<'_>) -> Result<Vec<PaletteEntry>, String> {
    let total_t0 = std::time::Instant::now();
    let s = store.read();
    let store_t0 = std::time::Instant::now();
    let snippets = s.load_snippets().map_err(|e| e.to_string())?;
    let quicklinks = s.load_quicklinks().map_err(|e| e.to_string())?;
    let store_ms = store_t0.elapsed().as_millis();
    drop(s);

    // Run the four shell-out-heavy subsystems in parallel. Each one is
    // independent — apps scans the filesystem, agents/vite/docker each
    // shell out to ps / lsof / docker. Sequential they were ~1s; in
    // parallel the total is bounded by the slowest single one.
    let (apps_list, agent_list, vite_list, docker_list, breakdown) =
        std::thread::scope(|scope| {
            let apps_h = scope.spawn(|| {
                let t = std::time::Instant::now();
                let r = apps::list_apps();
                (r, t.elapsed().as_millis())
            });
            let agents_h = scope.spawn(|| {
                let t = std::time::Instant::now();
                let r = agents::list_agents();
                (r, t.elapsed().as_millis())
            });
            let vite_h = scope.spawn(|| {
                let t = std::time::Instant::now();
                let r = vite_ports::list_vite_ports();
                (r, t.elapsed().as_millis())
            });
            let docker_h = scope.spawn(|| {
                let t = std::time::Instant::now();
                let r = docker_ps::list_docker_containers();
                (r, t.elapsed().as_millis())
            });
            let (apps_r, apps_ms) = apps_h.join().unwrap();
            let (agents_r, agents_ms) = agents_h.join().unwrap();
            let (vite_r, vite_ms) = vite_h.join().unwrap();
            let (docker_r, docker_ms) = docker_h.join().unwrap();
            let breakdown =
                format!("apps={apps_ms} agents={agents_ms} vite={vite_ms} docker={docker_ms}");
            (apps_r, agents_r, vite_r, docker_r, breakdown)
        });

    let mut out = Vec::with_capacity(
        builtin_commands().len()
            + snippets.len()
            + quicklinks.len()
            + apps_list.len()
            + agent_list.len()
            + vite_list.len()
            + docker_list.len() * 2,
    );
    for c in builtin_commands() {
        out.push(PaletteEntry::Command(c));
    }
    for x in snippets.into_iter().filter(|x| !x.deleted) {
        out.push(PaletteEntry::Snippet(x));
    }
    for x in quicklinks.into_iter().filter(|x| !x.deleted) {
        out.push(PaletteEntry::Quicklink(x));
    }
    for a in agent_list {
        out.push(PaletteEntry::Agent(a));
    }
    for v in vite_list {
        out.push(PaletteEntry::Vite(v));
    }
    for d in docker_list {
        out.push(PaletteEntry::Docker(DockerPaletteEntry {
            container: d.clone(),
            mode: "shell".into(),
        }));
        out.push(PaletteEntry::Docker(DockerPaletteEntry {
            container: d,
            mode: "logs".into(),
        }));
    }
    for a in apps_list {
        out.push(PaletteEntry::App(a));
    }
    eprintln!(
        "[davidcast] list_palette {}ms (store={}ms {}; total_entries={})",
        total_t0.elapsed().as_millis(),
        store_ms,
        breakdown,
        out.len()
    );
    Ok(out)
}

#[tauri::command]
pub fn list_agents() -> Vec<AgentEntry> {
    agents::list_agents()
}

#[tauri::command]
pub fn list_vite_ports() -> Vec<VitePortEntry> {
    vite_ports::list_vite_ports()
}

#[tauri::command]
pub fn list_docker_containers() -> Vec<DockerEntry> {
    docker_ps::list_docker_containers()
}

#[tauri::command]
pub fn execute_app(path: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    std::process::Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| format!("open {path} failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn execute_agent(
    pid: i32,
    tty: String,
    terminal_app: String,
    app: AppHandle,
) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let entry = AgentEntry {
        pid,
        tty,
        terminal_app,
        // Other fields are ignored by `activate` — fill placeholders.
        cwd: String::new(),
        project: String::new(),
        command: String::new(),
        elapsed: String::new(),
        git: Default::default(),
    };
    std::thread::sleep(std::time::Duration::from_millis(60));
    agents::activate(&entry)
}

#[tauri::command]
pub fn execute_vite(url: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    vite_ports::open_url(&url)
}

#[tauri::command]
pub fn execute_docker_shell(id: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(60));
    docker_ps::open_shell(&id)
}

#[tauri::command]
pub fn execute_docker_logs(id: String, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(60));
    docker_ps::open_logs(&id)
}

// ---------- Snippet CRUD ----------

#[derive(serde::Deserialize)]
pub struct NewSnippet {
    pub name: String,
    pub text: String,
    pub keyword: Option<String>,
    #[serde(default)]
    pub sensitive: bool,
}

#[tauri::command]
pub fn create_snippet(input: NewSnippet, store: StoreState<'_>) -> Result<Snippet, String> {
    let s = store.read();
    let mut items = s.load_snippets().map_err(|e| e.to_string())?;
    let ts = now();
    let item = Snippet {
        id: new_id(),
        name: input.name,
        keyword: input.keyword.filter(|k| !k.trim().is_empty()),
        text: input.text,
        created_at: ts.clone(),
        updated_at: ts,
        deleted: false,
        rev: 1,
        sensitive: input.sensitive,
    };
    items.push(item.clone());
    s.save_snippets(&items).map_err(|e| e.to_string())?;
    Ok(item)
}

#[derive(serde::Deserialize)]
pub struct UpdateSnippet {
    pub id: String,
    pub name: Option<String>,
    pub text: Option<String>,
    pub keyword: Option<Option<String>>,
    pub sensitive: Option<bool>,
}

#[tauri::command]
pub fn update_snippet(input: UpdateSnippet, store: StoreState<'_>) -> Result<Snippet, String> {
    let s = store.read();
    let mut items = s.load_snippets().map_err(|e| e.to_string())?;
    let Some(it) = items.iter_mut().find(|x| x.id == input.id) else {
        return Err(format!("snippet {} not found", input.id));
    };
    if let Some(n) = input.name { it.name = n; }
    if let Some(t) = input.text { it.text = t; }
    if let Some(k) = input.keyword { it.keyword = k.filter(|v| !v.trim().is_empty()); }
    if let Some(b) = input.sensitive { it.sensitive = b; }
    it.updated_at = now();
    it.rev += 1;
    let updated = it.clone();
    s.save_snippets(&items).map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_snippet(id: String, store: StoreState<'_>) -> Result<(), String> {
    let s = store.read();
    let mut items = s.load_snippets().map_err(|e| e.to_string())?;
    let Some(it) = items.iter_mut().find(|x| x.id == id) else {
        return Err(format!("snippet {id} not found"));
    };
    it.deleted = true;
    it.updated_at = now();
    it.rev += 1;
    s.save_snippets(&items).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Quicklink CRUD ----------

#[derive(serde::Deserialize)]
pub struct NewQuicklink {
    pub name: String,
    pub url: String,
    pub keyword: Option<String>,
    #[serde(default)]
    pub open_in: OpenIn,
}

#[tauri::command]
pub fn create_quicklink(input: NewQuicklink, store: StoreState<'_>) -> Result<Quicklink, String> {
    let s = store.read();
    let mut items = s.load_quicklinks().map_err(|e| e.to_string())?;
    let ts = now();
    let item = Quicklink {
        id: new_id(),
        name: input.name,
        keyword: input.keyword.filter(|k| !k.trim().is_empty()),
        url: input.url,
        open_in: input.open_in,
        created_at: ts.clone(),
        updated_at: ts,
        deleted: false,
        rev: 1,
    };
    items.push(item.clone());
    s.save_quicklinks(&items).map_err(|e| e.to_string())?;
    Ok(item)
}

#[derive(serde::Deserialize)]
pub struct UpdateQuicklink {
    pub id: String,
    pub name: Option<String>,
    pub url: Option<String>,
    pub keyword: Option<Option<String>>,
    pub open_in: Option<OpenIn>,
}

#[tauri::command]
pub fn update_quicklink(input: UpdateQuicklink, store: StoreState<'_>) -> Result<Quicklink, String> {
    let s = store.read();
    let mut items = s.load_quicklinks().map_err(|e| e.to_string())?;
    let Some(it) = items.iter_mut().find(|x| x.id == input.id) else {
        return Err(format!("quicklink {} not found", input.id));
    };
    if let Some(n) = input.name { it.name = n; }
    if let Some(u) = input.url { it.url = u; }
    if let Some(k) = input.keyword { it.keyword = k.filter(|v| !v.trim().is_empty()); }
    if let Some(o) = input.open_in { it.open_in = o; }
    it.updated_at = now();
    it.rev += 1;
    let updated = it.clone();
    s.save_quicklinks(&items).map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_quicklink(id: String, store: StoreState<'_>) -> Result<(), String> {
    let s = store.read();
    let mut items = s.load_quicklinks().map_err(|e| e.to_string())?;
    let Some(it) = items.iter_mut().find(|x| x.id == id) else {
        return Err(format!("quicklink {id} not found"));
    };
    it.deleted = true;
    it.updated_at = now();
    it.rev += 1;
    s.save_quicklinks(&items).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Execute ----------

#[tauri::command]
pub fn execute_snippet(
    id: String,
    app: AppHandle,
    store: StoreState<'_>,
) -> Result<(), String> {
    let snippet = {
        let s = store.read();
        let items = s.load_snippets().map_err(|e| e.to_string())?;
        items.into_iter().find(|x| x.id == id).ok_or_else(|| format!("snippet {id} not found"))?
    };
    actions::execute_snippet(&app, &snippet)
}

#[tauri::command]
pub fn execute_quicklink(
    id: String,
    args: Option<HashMap<String, String>>,
    app: AppHandle,
    store: StoreState<'_>,
) -> Result<(), String> {
    let ql = {
        let s = store.read();
        let items = s.load_quicklinks().map_err(|e| e.to_string())?;
        items.into_iter().find(|x| x.id == id).ok_or_else(|| format!("quicklink {id} not found"))?
    };
    actions::execute_quicklink(&app, &ql, &args.unwrap_or_default())
}

// ---------- Window ----------

#[tauri::command]
pub fn hide_palette(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_and_paste(app: AppHandle) -> Result<(), String> {
    actions::hide_and_paste(&app);
    Ok(())
}

// ---------- Raycast detection ----------

#[derive(serde::Serialize)]
pub struct RaycastStatus {
    pub installed: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub fn detect_raycast() -> RaycastStatus {
    for candidate in ["/Applications/Raycast.app", "/System/Applications/Raycast.app"]
    {
        if std::path::Path::new(candidate).exists() {
            return RaycastStatus {
                installed: true,
                path: Some(candidate.to_string()),
            };
        }
    }
    if let Some(home) = dirs::home_dir() {
        let p = home.join("Applications").join("Raycast.app");
        if p.exists() {
            return RaycastStatus {
                installed: true,
                path: Some(p.to_string_lossy().to_string()),
            };
        }
    }
    RaycastStatus {
        installed: false,
        path: None,
    }
}

// ---------- Import ----------

#[derive(serde::Serialize)]
pub struct ImportSummary {
    pub snippets: usize,
    pub quicklinks: usize,
    pub skipped: usize,
}

#[tauri::command]
pub fn import_from_file(path: String, store: StoreState<'_>) -> Result<ImportSummary, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("invalid JSON: {e}"))?;
    let entries = parsed.as_array().ok_or("expected a JSON array at the top level")?;

    let s = store.read();
    let mut snippets = s.load_snippets().map_err(|e| e.to_string())?;
    let mut quicklinks = s.load_quicklinks().map_err(|e| e.to_string())?;

    let mut n_snip = 0;
    let mut n_ql = 0;
    let mut skipped = 0;

    for entry in entries {
        let Some(obj) = entry.as_object() else {
            skipped += 1;
            continue;
        };
        // Quicklink-shaped: has "link" or "url".
        if let Some(url_raw) = obj
            .get("link")
            .or_else(|| obj.get("url"))
            .and_then(|v| v.as_str())
        {
            let url = normalize_raycast_url(url_raw);
            let name = obj
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled")
                .to_string();
            let keyword = obj
                .get("keyword")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let open_in = match obj.get("openWith").and_then(|v| v.as_str()) {
                Some("com.google.Chrome") => OpenIn::Chrome,
                Some("com.apple.Safari") => OpenIn::Safari,
                _ => OpenIn::DefaultBrowser,
            };
            let ts = now();
            quicklinks.push(Quicklink {
                id: new_id(),
                name,
                keyword,
                url,
                open_in,
                created_at: ts.clone(),
                updated_at: ts,
                deleted: false,
                rev: 1,
            });
            n_ql += 1;
            continue;
        }
        // Snippet-shaped: has "text".
        if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
            let name = obj
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled")
                .to_string();
            let keyword = obj
                .get("keyword")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let ts = now();
            snippets.push(Snippet {
                id: new_id(),
                name,
                keyword,
                text: text.to_string(),
                created_at: ts.clone(),
                updated_at: ts,
                deleted: false,
                rev: 1,
                sensitive: false,
            });
            n_snip += 1;
            continue;
        }
        skipped += 1;
    }

    s.save_snippets(&snippets).map_err(|e| e.to_string())?;
    s.save_quicklinks(&quicklinks).map_err(|e| e.to_string())?;

    Ok(ImportSummary {
        snippets: n_snip,
        quicklinks: n_ql,
        skipped,
    })
}

/// Convert Raycast's `{argument name="foo" placeholder="..."}` syntax to `{foo}`.
fn normalize_raycast_url(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    let mut rest = url;
    while let Some(start) = rest.find("{argument") {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let Some(end) = tail.find('}') else {
            out.push_str(tail);
            return out;
        };
        let tag = &tail[..end];
        let name = tag
            .find("name=\"")
            .and_then(|i| {
                let ns = &tag[i + 6..];
                ns.find('"').map(|e| &ns[..e])
            });
        match name {
            Some(n) => {
                out.push('{');
                out.push_str(n);
                out.push('}');
            }
            None => out.push_str(&tail[..=end]),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_simple() {
        assert_eq!(normalize_raycast_url("x{argument name=\"q\"}y"), "x{q}y");
    }

    #[test]
    fn normalize_with_placeholder() {
        assert_eq!(
            normalize_raycast_url("search?q={argument name=\"query\" placeholder=\"Search\"}"),
            "search?q={query}"
        );
    }

    #[test]
    fn normalize_preserves_non_argument() {
        assert_eq!(normalize_raycast_url("{already}"), "{already}");
    }
}

// ---------- App icons ----------

#[tauri::command]
pub fn get_app_icon(path: String) -> Option<String> {
    icons::get_app_icon(&path)
}

// ---------- Clipboard history ----------

#[tauri::command]
pub fn list_clipboard() -> Vec<ClipboardEntry> {
    clipboard::list()
}

#[tauri::command]
pub fn execute_clipboard(id: String, app: AppHandle) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let entry = clipboard::list()
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("clipboard entry {id} not found"))?;
    // Suppress so the watcher doesn't double-record our own write.
    clipboard::suppress_next(&entry.text);
    app.clipboard()
        .write_text(entry.text.clone())
        .map_err(|e| format!("clipboard: {e}"))?;
    actions::hide_and_paste(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_clipboard(id: String) -> Result<(), String> {
    clipboard::delete(&id);
    Ok(())
}

#[tauri::command]
pub fn clear_clipboard() -> Result<(), String> {
    clipboard::clear();
    Ok(())
}

#[tauri::command]
pub fn show_preferences(app: AppHandle) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    // Preferences live inline inside the main palette window now. Show
    // and focus the window, then nudge the React app to switch its view.
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    app.emit("preferences:show", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}
