use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) urls allowed".to_string());
    }
    app.shell().open(url, None).map_err(|e| e.to_string())
}