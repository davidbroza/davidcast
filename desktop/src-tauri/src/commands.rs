use crate::actions;
use crate::store::Store;
use crate::types::*;
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

// ---------- Snippet CRUD ----------

#[derive(serde::Deserialize)]
pub struct NewSnippet {
    pub name: String,
    pub text: String,
    pub keyword: Option<String>,
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
pub fn show_preferences(app: AppHandle) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(w) = app.get_webview_window("prefs") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "prefs",
        WebviewUrl::App("index.html?view=prefs".into()),
    )
    .title("davidcast — Preferences")
    .inner_size(640.0, 520.0)
    .resizable(true)
    .center()
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
