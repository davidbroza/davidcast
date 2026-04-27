//! Window management — Raycast-style. Resize and move whichever app window
//! was frontmost before the palette opened.
//!
//! Implementation is pure osascript (System Events) so it inherits davidcast's
//! Accessibility permission instead of needing a separate AX helper. The
//! visible-desktop bounds (excludes menubar + dock) come from Finder's desktop
//! window.

/// Position the frontmost (non-davidcast) window into a fraction of the
/// visible desktop. Each `Half`/`Maximize` command boils down to a target
/// rectangle.
pub fn left_half() -> Result<(), String> {
    let (x, y, w, h) = visible_frame()?;
    move_frontmost(x, y, w / 2, h)
}

pub fn right_half() -> Result<(), String> {
    let (x, y, w, h) = visible_frame()?;
    move_frontmost(x + w / 2, y, w - w / 2, h)
}

pub fn top_half() -> Result<(), String> {
    let (x, y, w, h) = visible_frame()?;
    move_frontmost(x, y, w, h / 2)
}

pub fn bottom_half() -> Result<(), String> {
    let (x, y, w, h) = visible_frame()?;
    move_frontmost(x, y + h / 2, w, h - h / 2)
}

pub fn maximize() -> Result<(), String> {
    let (x, y, w, h) = visible_frame()?;
    move_frontmost(x, y, w, h)
}

pub fn center() -> Result<(), String> {
    let (x, y, w, h) = visible_frame()?;
    // Two-thirds size, centred — tighter than maximize, useful for docs.
    let cw = w * 2 / 3;
    let ch = h * 2 / 3;
    move_frontmost(x + (w - cw) / 2, y + (h - ch) / 2, cw, ch)
}

fn visible_frame() -> Result<(i32, i32, i32, i32), String> {
    // `Finder`'s desktop window bounds = the visible-desktop rect (already
    // inset for the menubar and Dock). Returns "x1, y1, x2, y2".
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg("tell application \"Finder\" to get bounds of window of desktop")
        .output()
        .map_err(|e| format!("osascript spawn: {e}"))?;
    if !out.status.success() {
        return Err("could not read screen bounds (Accessibility?)".into());
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<i32> = s
        .trim()
        .split(',')
        .filter_map(|p| p.trim().parse().ok())
        .collect();
    let [x1, y1, x2, y2] = parts.as_slice() else {
        return Err("unexpected bounds format".into());
    };
    Ok((*x1, *y1, x2 - x1, y2 - y1))
}

fn move_frontmost(x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    // System Events writes both position and size; we explicitly skip
    // davidcast itself in case the palette is still focused at the moment
    // the script runs.
    let script = format!(
        r#"tell application "System Events"
  set theApps to (first process whose frontmost is true)
  if name of theApps is "davidcast" then return
  tell theApps
    if (count of windows) is 0 then return
    set position of window 1 to {{{x}, {y}}}
    set size of window 1 to {{{w}, {h}}}
  end tell
end tell"#,
        x = x,
        y = y,
        w = w,
        h = h
    );
    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status()
        .map_err(|e| format!("osascript spawn: {e}"))?;
    if !status.success() {
        return Err("osascript returned non-zero".into());
    }
    Ok(())
}
