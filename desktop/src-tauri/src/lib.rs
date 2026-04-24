mod actions;
mod apps;
mod commands;
mod hotkey;
mod store;
mod types;

use parking_lot::RwLock;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // On macOS, run as an accessory app — no dock icon, menu bar only.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Load the store.
            let store = store::Store::load().expect("failed to load davidcast store");
            app.manage(RwLock::new(store));

            // Register global hotkey.
            let handle = app.handle().clone();
            let shortcut = hotkey::default_shortcut();
            app.global_shortcut().on_shortcut(shortcut, move |_app, sc, event| {
                hotkey::on_shortcut(&handle, sc, event.state);
            })?;

            // Build the menu-bar tray.
            let show_i = MenuItem::with_id(app, "show", "Open davidcast", true, Some("Ctrl+Space"))?;
            let prefs_i = MenuItem::with_id(app, "prefs", "Preferences…", true, Some("Cmd+,"))?;
            let sep_i = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit davidcast", true, Some("Cmd+Q"))?;
            let menu = Menu::with_items(app, &[&show_i, &prefs_i, &sep_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("default window icon missing"),
                )
                .icon_as_template(true)
                .menu(&menu)
                // Left-click opens the palette; the menu surfaces on right-click.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        hotkey::toggle_palette(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => hotkey::toggle_palette(app),
                    "prefs" => {
                        if let Err(e) = commands::show_preferences(app.clone()) {
                            eprintln!("failed to open preferences: {e}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

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
            commands::list_palette,
            commands::execute_app,
            commands::create_snippet,
            commands::update_snippet,
            commands::delete_snippet,
            commands::create_quicklink,
            commands::update_quicklink,
            commands::delete_quicklink,
            commands::execute_snippet,
            commands::execute_quicklink,
            commands::hide_palette,
            commands::hide_and_paste,
            commands::show_preferences,
            commands::import_from_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
