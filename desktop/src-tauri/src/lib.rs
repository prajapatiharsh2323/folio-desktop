mod commands;
mod guard;

use commands::{dict, fs, hash, power, shell, zip};
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs::fs_read,
            fs::fs_write_atomic,
            fs::fs_delete,
            fs::fs_move,
            fs::fs_stat,
            fs::fs_list_dir,
            hash::sha256_file,
            zip::zip_read,
            zip::zip_write,
            shell::open_external_url,
            power::prevent_display_sleep,
            dict::dict_sqlite_query
        ])
        .setup(|app| {
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}