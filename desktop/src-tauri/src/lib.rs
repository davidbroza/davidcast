mod actions;
mod commands;
mod hotkey;
mod store;
mod types;

use parking_lot::RwLock;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let store = store::Store::load().expect("failed to load davidcast store");
            app.manage(RwLock::new(store));

            let handle = app.handle().clone();
            let shortcut = hotkey::default_shortcut();
            app.global_shortcut().on_shortcut(shortcut, move |_app, sc, event| {
                hotkey::on_shortcut(&handle, sc, event.state);
            })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_workspaces,
            commands::set_active_workspace,
            commands::create_workspace,
            commands::delete_workspace,
            commands::list_items,
            commands::create_snippet,
            commands::update_snippet,
            commands::delete_snippet,
            commands::create_quicklink,
            commands::update_quicklink,
            commands::delete_quicklink,
            commands::execute_snippet,
            commands::execute_quicklink,
            commands::hide_palette,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
