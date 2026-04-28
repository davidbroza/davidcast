//! macOS quick actions — Lock Screen, Sleep, Empty Trash, Restart, Shut Down,
//! Log Out. All shell out (osascript / pmset). Destructive actions are gated
//! by a frontend confirm step before they ever land here, but each call is
//! still safe to fire on its own — we don't add extra "are you sure" prompts.

fn osascript(script: &str) -> Result<(), String> {
    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|e| format!("osascript spawn: {e}"))?;
    if !status.success() {
        return Err("osascript returned non-zero".into());
    }
    Ok(())
}

/// Lock the screen. Sends ⌃⌘Q via System Events — the system shortcut
/// macOS has bound to "Lock Screen" since Mojave. Inherits davidcast's
/// Accessibility permission (same one the window-management commands use).
pub fn lock_screen() -> Result<(), String> {
    osascript(
        r#"tell application "System Events" to keystroke "q" using {control down, command down}"#,
    )
}

/// Put the Mac to sleep immediately. `pmset sleepnow` is the canonical CLI
/// equivalent of the Apple-menu Sleep item; no permission required.
pub fn sleep_now() -> Result<(), String> {
    let status = std::process::Command::new("pmset")
        .arg("sleepnow")
        .status()
        .map_err(|e| format!("pmset spawn: {e}"))?;
    if !status.success() {
        return Err("pmset returned non-zero".into());
    }
    Ok(())
}

pub fn empty_trash() -> Result<(), String> {
    osascript(r#"tell application "Finder" to empty trash"#)
}

pub fn restart() -> Result<(), String> {
    osascript(r#"tell application "System Events" to restart"#)
}

pub fn shut_down() -> Result<(), String> {
    osascript(r#"tell application "System Events" to shut down"#)
}

pub fn log_out() -> Result<(), String> {
    // `log out` triggers the standard macOS confirm sheet on its own; our
    // frontend confirm is redundant but harmless and keeps UX consistent
    // with restart/shutdown.
    osascript(r#"tell application "System Events" to log out"#)
}
