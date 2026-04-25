mod actions;
mod agents;
mod analytics;
mod apps;
mod clipboard;
mod commands;
mod docker_ps;
mod files;
mod git;
mod hotkey;
mod icons;
mod store;
mod types;
mod vite_ports;
mod window_mgmt;

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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // On macOS, run as an accessory app — no dock icon, menu bar only.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Load the store.
            let store = store::Store::load().expect("failed to load davidcast store");
            app.manage(RwLock::new(store));

            // Register global hotkeys: palette + clipboard.
            let handle = app.handle().clone();
            let palette_sc = hotkey::default_shortcut();
            let clipboard_sc = hotkey::clipboard_shortcut();
            app.global_shortcut().on_shortcut(palette_sc, {
                let handle = handle.clone();
                move |_app, sc, event| {
                    hotkey::on_palette_shortcut(&handle, sc, event.state);
                }
            })?;
            app.global_shortcut().on_shortcut(clipboard_sc, {
                let handle = handle.clone();
                move |_app, sc, event| {
                    hotkey::on_clipboard_shortcut(&handle, sc, event.state);
                }
            })?;

            // Background clipboard watcher.
            clipboard::start_watcher(app.handle().clone());

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
            commands::get_settings,
            commands::set_show_vite_inline,
            commands::set_show_docker_inline,
            commands::set_screenshot_dirs,
            commands::search_screenshots,
            commands::analytics_record,
            commands::analytics_tail,
            commands::analytics_clear,
            commands::analytics_log_path,
            commands::search_files,
            commands::open_file,
            commands::reveal_file,
            commands::copy_file_path,
            commands::copy_file_image,
            commands::file_thumbnail,
            commands::wm_left_half,
            commands::wm_right_half,
            commands::wm_top_half,
            commands::wm_bottom_half,
            commands::wm_maximize,
            commands::wm_center,
            commands::list_workspaces,
            commands::set_active_workspace,
            commands::create_workspace,
            commands::delete_workspace,
            commands::list_items,
            commands::list_palette,
            commands::list_agents,
            commands::list_vite_ports,
            commands::list_docker_containers,
            commands::execute_app,
            commands::execute_agent,
            commands::execute_vite,
            commands::execute_docker_shell,
            commands::execute_docker_logs,
            commands::get_app_icon,
            commands::list_clipboard,
            commands::execute_clipboard,
            commands::delete_clipboard,
            commands::clear_clipboard,
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
            commands::detect_raycast,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
