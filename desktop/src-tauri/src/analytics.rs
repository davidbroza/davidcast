use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// Append-only JSONL log of palette interactions, written next to the JSON
/// store at `~/Library/Application Support/davidcast/analytics.jsonl`.
///
/// One line per event. The frontend decides what to record; this module is
/// just the file sink. Local-only — nothing is ever sent off the box.
#[derive(Serialize)]
pub struct AnalyticsEvent {
    /// Unix milliseconds.
    pub ts: u128,
    /// Frontend-generated UUID, one per palette open. Lets us group events
    /// from the same session.
    pub session_id: String,
    /// e.g. "open", "execute", "no_results", "close".
    pub kind: String,
    /// Free-form payload.
    pub data: serde_json::Value,
}

/// Serialize calls so concurrent writes never interleave a single record.
/// One line in, one line out.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn log_path() -> Option<PathBuf> {
    crate::store::Store::root_dir()
        .ok()
        .map(|p| p.join("analytics.jsonl"))
}

pub fn record(
    session_id: String,
    kind: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let Some(path) = log_path() else {
        return Err("no data dir".into());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let event = AnalyticsEvent {
        ts: now_ms(),
        session_id,
        kind,
        data,
    };
    let mut line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    line.push('\n');

    let _guard = WRITE_LOCK.lock().unwrap();
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Read the last `limit` events. Used by the eventual "review my usage" UI.
pub fn tail(limit: usize) -> Vec<serde_json::Value> {
    let Some(path) = log_path() else {
        return Vec::new();
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    content
        .lines()
        .rev()
        .take(limit)
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

pub fn clear() -> Result<(), String> {
    let Some(path) = log_path() else {
        return Err("no data dir".into());
    };
    let _guard = WRITE_LOCK.lock().unwrap();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
