use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) urls allowed".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open the library folder in Explorer. The frontend only knows the virtual
/// `/folio-library` path, so resolution happens here (02 §5).
#[tauri::command]
pub fn open_app_dir(app: AppHandle) -> Result<(), String> {
    let dir = crate::appdir::app_dir().ok_or_else(|| "app dir is not ready".to_string())?;
    let library = dir.join("library");
    let target = if library.exists() { library } else { dir };
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Real on-disk library path, for display in Settings.
#[tauri::command]
pub fn library_path() -> Result<String, String> {
    let dir = crate::appdir::app_dir().ok_or_else(|| "app dir is not ready".to_string())?;
    Ok(dir.join("library").to_string_lossy().to_string())
}
