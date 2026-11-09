//! Local, rotating error log for crashes and unhandled rejections.
//!
//! Folio has no telemetry. Diagnostics stay on disk under
//! `%APPDATA%/Folio/user/logs/` and Settings can open that folder. The log
//! keeps one previous file and is capped so a crash loop cannot fill the disk.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const MAX_LOG_BYTES: u64 = 512 * 1024;
const MAX_MESSAGE_CHARS: usize = 4_000;

fn log_dir() -> Result<PathBuf, String> {
    let dir = crate::appdir::app_dir().ok_or_else(|| "app dir is not ready".to_string())?;
    let logs = dir.join("user").join("logs");
    fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    Ok(logs)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn truncate(message: &str) -> String {
    let mut out: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
    if message.chars().count() > MAX_MESSAGE_CHARS {
        out.push_str("… [truncated]");
    }
    out
}

fn format_line(context: &str, message: &str) -> String {
    let context = context.trim();
    let context = if context.is_empty() { "app" } else { context };
    format!("[{}] {}: {}\n", now_ms(), context, truncate(message))
}

fn should_rotate(current_bytes: u64, incoming_bytes: usize) -> bool {
    current_bytes > 0 && current_bytes.saturating_add(incoming_bytes as u64) > MAX_LOG_BYTES
}

fn append_line(dir: &Path, line: &str) -> Result<(), String> {
    let current = dir.join("folio.log");
    let previous = dir.join("folio.1.log");
    let current_bytes = fs::metadata(&current).map(|m| m.len()).unwrap_or(0);
    if should_rotate(current_bytes, line.len()) {
        let _ = fs::remove_file(&previous);
        let _ = fs::rename(&current, &previous);
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&current)
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

/// Append one diagnostic line from the frontend.
#[tauri::command]
pub fn log_error(context: String, message: String) -> Result<(), String> {
    let dir = log_dir()?;
    append_line(&dir, &format_line(&context, &message))
}

/// Real log-folder path, for display in Settings.
#[tauri::command]
pub fn log_path() -> Result<String, String> {
    Ok(log_dir()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = log_dir()?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_line_includes_context_and_truncates() {
        let line = format_line("window.error", "boom");
        assert!(line.contains("window.error"));
        assert!(line.contains("boom"));

        let long = "x".repeat(MAX_MESSAGE_CHARS + 10);
        let line = format_line("", &long);
        assert!(line.starts_with("["));
        assert!(line.contains("app:"));
        assert!(line.contains("[truncated]"));
        assert!(line.chars().count() < MAX_MESSAGE_CHARS + 100);
    }

    #[test]
    fn rotation_only_when_the_next_line_would_overflow() {
        assert!(!should_rotate(0, MAX_LOG_BYTES as usize));
        assert!(!should_rotate(10, 10));
        assert!(should_rotate(MAX_LOG_BYTES, 1));
    }
}
