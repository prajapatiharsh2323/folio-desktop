mod commands;
mod jumplist;
mod open_files;
mod window_state;

// Platform-neutral security core (tests run on any host via `cargo test
// -p foliocore`); re-exported so `crate::appdir`/`crate::guard`/`crate::sandbox`
// keep resolving inside the Tauri crate.
pub use foliocore::{appdir, guard, sandbox};

use commands::{fs, hash, logging, pick, power, shell, zip};
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
            logging::log_error,
            logging::log_path,
            logging::open_log_dir,
            power::prevent_display_sleep,
            pick::pick_import_files,
            pick::pick_backup_source,
            pick::pick_backup_dest,
            pick::pick_image_dest,
            open_files::take_pending_launch
        ])
        .setup(|app| {
            // %APPDATA%/Folio — the default app dir (02 §4).
            let tauri_data = app.path().app_data_dir().ok();
            let app_dir = appdir::default_app_dir(tauri_data);
            let _ = std::fs::create_dir_all(app_dir.join("library"));
            let _ = std::fs::create_dir_all(app_dir.join("user"));
            appdir::set_app_dir(app_dir);

            // Open-with / command-line paths for this first launch. `args_os`
            // keeps a non-Unicode filename from panicking the process; the
            // lossy string is only used for the filter and the frontend's
            // display path (the dialog/import path arrives separately).
            open_files::remember(open_files::parse_args(
                std::env::args_os().map(|arg| arg.to_string_lossy().into_owned()),
            ));

            // Taskbar jump list (09 §3): Open Folio / Import file…
            jumplist::install();

            if let Some(window) = app.get_webview_window("main") {
                window_state::restore(&window);

                // The window starts hidden so WebView2 cannot flash white
                // before the theme is applied. The frontend shows it after the
                // first frame; this timer is the crash-proof fallback.
                let fallback = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let _ = fallback.show();
                });

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
                    WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                        // Dropped files are a user action: grant them for this
                        // session, then hand the granted paths to the frontend
                        // so the read always happens after the grant.
                        for p in paths {
                            crate::sandbox::grant(p);
                        }
                        let granted: Vec<String> = paths
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        use tauri::Emitter;
                        let _ = w.emit("folio://drop-granted", granted);
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
