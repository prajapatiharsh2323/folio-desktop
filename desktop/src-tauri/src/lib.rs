mod appdir;
mod commands;
mod guard;
mod jumplist;
mod open_files;
mod window_state;

use commands::{dict, fs, hash, power, shell, zip};
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launch should de-focus nothing and
        // hand its file args to the already-running instance (09 §3).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            open_files::handle_second_instance(app, argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs::fs_read,
            fs::fs_write_atomic,
            fs::fs_delete,
            fs::fs_move,
            fs::fs_stat,
            fs::fs_list_dir,
            fs::fs_free_space,
            hash::sha256_file,
            zip::zip_read,
            zip::zip_write,
            shell::open_external_url,
            shell::open_app_dir,
            shell::library_path,
            power::prevent_display_sleep,
            dict::dict_sqlite_query,
            dict::dict_lookup,
            dict::dict_status,
            open_files::take_pending_launch
        ])
        .setup(|app| {
            // %APPDATA%/Folio — the default app dir (02 §4).
            let tauri_data = app.path().app_data_dir().ok();
            let app_dir = appdir::default_app_dir(tauri_data);
            let _ = std::fs::create_dir_all(app_dir.join("library"));
            let _ = std::fs::create_dir_all(app_dir.join("user"));
            appdir::set_app_dir(app_dir);

            // Copy + verify the bundled dictionary pack on first run (06 §5).
            if let Ok(resources) = app.path().resource_dir() {
                let _ = dict::ensure_installed(Some(resources.as_path()));
            }

            // Open-with / command-line paths for this first launch.
            open_files::remember(open_files::parse_args(std::env::args()));

            // Taskbar jump list (09 §3): Open Folio / Import file…
            jumplist::install();

            if let Some(window) = app.get_webview_window("Library") {
                window_state::restore(&window);

                let w = window.clone();
                window.on_window_event(move |event| match event {
                    WindowEvent::Moved(_)
                    | WindowEvent::Resized(_)
                    | WindowEvent::ScaleFactorChanged { .. } => {
                        window_state::schedule_save(w.clone());
                    }
                    WindowEvent::CloseRequested { .. } => {
                        let _ = window_state::save_now(&w);
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
