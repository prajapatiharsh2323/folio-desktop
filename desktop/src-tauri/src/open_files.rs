//! Open-with / command-line plumbing and single-instance hand-off.
//!
//! Windows file associations and the jump list launch `Folio.exe <path>` (or
//! `Folio.exe --import`). The first instance collects the paths into a pending
//! queue; later instances forward them through `tauri-plugin-single-instance`
//! and focus the existing window. The frontend drains the queue on mount and
//! whenever it receives `folio://launch`.

use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const LAUNCH_EVENT: &str = "folio://launch";

#[derive(Debug, Default, Clone, Serialize)]
pub struct LaunchRequest {
    pub files: Vec<String>,
    pub import_requested: bool,
}

static PENDING: Mutex<LaunchRequest> = Mutex::new(LaunchRequest {
    files: Vec::new(),
    import_requested: false,
});

// "pdf" added for the PDF feature (plan §5, D4 alternate handler): flagged-off
// builds still refuse the file at the TS import gate with "PDF is not
// supported", so behaviour is unchanged when the feature is disabled.
const OPENABLE_EXTENSIONS: &[&str] = &["epub", "html", "htm", "txt", "md", "pdf"];

fn is_openable(path: &str) -> bool {
    let p = Path::new(path);
    if !p.is_file() {
        return false;
    }
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| OPENABLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Parse a process argv (skipping argv[0]).
pub fn parse_args<I: IntoIterator<Item = String>>(argv: I) -> LaunchRequest {
    let mut req = LaunchRequest::default();
    for arg in argv.into_iter().skip(1) {
        let trimmed = arg.trim();
        if trimmed.eq_ignore_ascii_case("--import") || trimmed.eq_ignore_ascii_case("/import") {
            req.import_requested = true;
        } else if !trimmed.starts_with('-') && is_openable(trimmed) {
            req.files.push(trimmed.to_string());
        }
    }
    req
}

/// Merge a launch request into the pending queue.
pub fn remember(req: LaunchRequest) {
    if req.files.is_empty() && !req.import_requested {
        return;
    }
    if let Ok(mut pending) = PENDING.lock() {
        for f in req.files {
            if !pending.files.contains(&f) {
                // Open-with paths are a user action: grant them so the file
                // commands accept them this session.
                crate::sandbox::grant(Path::new(&f));
                pending.files.push(f);
            }
        }
        pending.import_requested |= req.import_requested;
    }
}

/// Drain the pending queue (called by the frontend).
#[tauri::command]
pub fn take_pending_launch() -> LaunchRequest {
    PENDING
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

/// Bring the single window to the foreground.
pub fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Single-instance callback: queue the new args, focus, notify the frontend.
pub fn handle_second_instance(app: &AppHandle, argv: Vec<String>) {
    remember(parse_args(argv));
    focus_main(app);
    let _ = app.emit(LAUNCH_EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn ignores_flags_and_missing_files() {
        let req = parse_args(vec![
            "Folio.exe".to_string(),
            "--import".to_string(),
            "C:/books/missing.epub".to_string(),
            "--some-flag".to_string(),
        ]);
        assert!(req.import_requested);
        assert!(req.files.is_empty());
    }

    #[test]
    fn accepts_openable_existing_files() {
        let dir = std::env::temp_dir().join(format!("folio-open-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let book = dir.join("book.epub");
        let txt = dir.join("notes.txt");
        let pdf = dir.join("paper.pdf");
        let upper = dir.join("DOC.PDF");
        fs::write(&book, b"x").unwrap();
        fs::write(&txt, b"x").unwrap();
        fs::write(&pdf, b"x").unwrap();
        fs::write(&upper, b"x").unwrap();
        let req = parse_args(vec![
            "Folio.exe".to_string(),
            book.to_string_lossy().to_string(),
            txt.to_string_lossy().to_string(),
            pdf.to_string_lossy().to_string(),
            upper.to_string_lossy().to_string(),
        ]);
        // PDFs are openable now (PDF plan §5): the feature gate lives in the
        // TS import gate, which refuses them while FEATURES.pdf is off.
        assert_eq!(req.files.len(), 4);
        assert!(!req.import_requested);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn remember_deduplicates() {
        // Statics are process-wide; this test only asserts additive behaviour.
        remember(LaunchRequest {
            files: vec!["a.epub".into()],
            import_requested: false,
        });
        remember(LaunchRequest {
            files: vec!["a.epub".into()],
            import_requested: true,
        });
        let drained = take_pending_launch();
        assert_eq!(drained.files, vec!["a.epub".to_string()]);
        assert!(drained.import_requested);
        assert!(take_pending_launch().files.is_empty());
    }
}
