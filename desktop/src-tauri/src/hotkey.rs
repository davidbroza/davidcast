use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

pub fn default_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Space)
}

pub fn on_shortcut(app: &AppHandle, _shortcut: &Shortcut, state: ShortcutState) {
    if state != ShortcutState::Pressed {
        return;
    }
    toggle_palette(app);
}

pub fn toggle_palette(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    match w.is_visible() {
        Ok(true) => {
            let _ = w.hide();
        }
        _ => {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
            // Nudge the frontend to reset its state (clear query, refetch).
            let _ = app.emit("palette:show", ());
        }
    }
}
