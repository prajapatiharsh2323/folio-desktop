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

// "pdf" added behind the TS feature flag (PDF plan §5): the path is accepted
// here and the import gate in fileDetector.ts refuses it with the
// mobile-parity copy when FEATURES.pdf is off, so a flag-off build behaves
// exactly as before — the picker just lists one extra type.
const BOOK_EXTENSIONS: &[&str] = &["epub", "html", "htm", "txt", "md", "pdf"];

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

/// F7: folder-import picker. Picking a folder grants it this session, which
/// (per `sandbox.grant`) covers its contents, so the webview can enumerate
/// and read it recursively through the existing `fs_*` commands.
#[tauri::command]
pub async fn pick_import_folder(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a folder to import")
            .blocking_pick_folder();
        Ok(picked.and_then(grant_and_string))
    })
    .await
    .map_err(|e| e.to_string())?
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

/// Notes-export picker: where to write a Markdown/CSV text export.
#[tauri::command]
pub async fn pick_export_dest(
    app: AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    save_file(
        app,
        "Export notes".to_string(),
        default_name,
        "Text".to_string(),
        owned(&["md", "csv", "txt"]),
    )
    .await
}

/// Reveal a document's folder in the OS file manager (L4 "Show in folder").
/// The path must live inside the app directory — the guard rejects anything
/// else, and the opener only ever reveals, it never writes.
#[tauri::command]
pub async fn reveal_doc(app: AppHandle, slug: String) -> Result<(), String> {
    let _ = app;
    tauri::async_runtime::spawn_blocking(move || {
        let safe_slug = slug.replace(['/', '\\'], "_");
        let dir =
            crate::guard::guard_sandboxed(&format!("/folio-library/library/docs/{safe_slug}"))
                .map_err(|e| e.to_string())?;
        tauri_plugin_opener::reveal_item_in_dir(dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("reveal failed: {e}"))?
}
