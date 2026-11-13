//! Native dialog pickers that double as the sandbox grant points.
//!
//! File commands only accept paths inside the app dir or granted this
//! session. The grants are made here, in Rust, when the user physically
//! picks a file — the webview never needs to ask for an arbitrary path.

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

fn grant_and_string(fp: FilePath) -> Option<String> {
    let path = fp.into_path().ok()?;
    crate::sandbox::grant(&path);
    Some(path.to_string_lossy().to_string())
}

async fn pick_files(
    app: AppHandle,
    title: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        let picked = app
            .dialog()
            .file()
            .set_title(&title)
            .add_filter(&filter_name, &exts)
            .blocking_pick_files();
        Ok(picked
            .unwrap_or_default()
            .into_iter()
            .filter_map(grant_and_string)
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn pick_file(
    app: AppHandle,
    title: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        let picked = app
            .dialog()
            .file()
            .set_title(&title)
            .add_filter(&filter_name, &exts)
            .blocking_pick_file();
        Ok(picked.and_then(grant_and_string))
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn save_file(
    app: AppHandle,
    title: String,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        let picked = app
            .dialog()
            .file()
            .set_title(&title)
            .set_file_name(&default_name)
            .add_filter(&filter_name, &exts)
            .blocking_save_file();
        Ok(picked.and_then(grant_and_string))
    })
    .await
    .map_err(|e| e.to_string())?
}

const BOOK_EXTENSIONS: &[&str] = &["epub", "html", "htm", "txt", "md"];

fn owned(extensions: &[&str]) -> Vec<String> {
    extensions.iter().map(|s| s.to_string()).collect()
}

/// Import picker: multiple open dialog for books & articles.
#[tauri::command]
pub async fn pick_import_files(app: AppHandle) -> Result<Vec<String>, String> {
    pick_files(
        app,
        "Import files".to_string(),
        "Books & articles".to_string(),
        owned(BOOK_EXTENSIONS),
    )
    .await
}

/// Restore picker: a single .zip backup to read.
#[tauri::command]
pub async fn pick_backup_source(app: AppHandle) -> Result<Option<String>, String> {
    pick_file(
        app,
        "Choose a backup to restore".to_string(),
        "Zip".to_string(),
        owned(&["zip"]),
    )
    .await
}

/// Export picker: where to write the backup archive.
#[tauri::command]
pub async fn pick_backup_dest(
    app: AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    save_file(
        app,
        "Export backup".to_string(),
        default_name,
        "Zip".to_string(),
        owned(&["zip"]),
    )
    .await
}

/// Quote-card picker: where to write the PNG image.
#[tauri::command]
pub async fn pick_image_dest(
    app: AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    save_file(
        app,
        "Save image".to_string(),
        default_name,
        "Image".to_string(),
        owned(&["png"]),
    )
    .await
}
