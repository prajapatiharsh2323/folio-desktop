//! Window size/position persistence (02 §3, REMAINING Phase 11).
//!
//! Restores `user/window.json` clamped to a visible monitor work area and
//! rewrites it (debounced) as the user moves/resizes/maximizes the window.
//! Unknown keys written by the frontend — notably `preventSleepWhileReading`
//! — are preserved byte-for-value.

use crate::appdir;
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

static SAVE_GEN: AtomicU64 = AtomicU64::new(0);

fn state_path() -> Option<PathBuf> {
    appdir::app_dir().map(|d| d.join("user").join("window.json"))
}

fn read_state() -> Map<String, Value> {
    let Some(path) = state_path() else {
        return Map::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Map::new();
    };
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

fn write_state(map: &Map<String, Value>) -> Result<(), String> {
    let Some(path) = state_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes =
        serde_json::to_vec_pretty(&Value::Object(map.clone())).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    let mut last = None;
    for delay in [10u64, 50, 250] {
        match fs::rename(&tmp, &path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                thread::sleep(Duration::from_millis(delay));
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(last
        .map(|e| e.to_string())
        .unwrap_or_else(|| "window state write failed".to_string()))
}

fn num(map: &Map<String, Value>, key: &str) -> Option<i64> {
    map.get(key).and_then(Value::as_i64)
}

/// Restore the saved geometry, clamped so the window cannot land off-screen.
pub fn restore(window: &WebviewWindow) {
    let map = read_state();
    if map.is_empty() {
        return;
    }

    let width = num(&map, "width").filter(|v| *v > 0).unwrap_or(1100) as u32;
    let height = num(&map, "height").filter(|v| *v > 0).unwrap_or(760) as u32;
    let saved_x = num(&map, "x").map(|v| v as i32);
    let saved_y = num(&map, "y").map(|v| v as i32);
    let maximized = map
        .get("maximized")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if let Some((x, y, w, h)) = clamp_to_work_area(window, saved_x, saved_y, width, height) {
        let _ = window.set_size(PhysicalSize::new(w, h));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    if maximized {
        let _ = window.maximize();
    }
}

/// Clamp a saved rect to a monitor work area (Windows taskbar removed).
fn clamp_to_work_area(
    window: &WebviewWindow,
    saved_x: Option<i32>,
    saved_y: Option<i32>,
    width: u32,
    height: u32,
) -> Option<(i32, i32, u32, u32)> {
    let monitors = window.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return None;
    }

    let (sx, sy) = (saved_x.unwrap_or(0), saved_y.unwrap_or(0));
    // Prefer the monitor that contains the saved top-left corner.
    let monitor = monitors
        .iter()
        .find(|m| {
            let wa = m.work_area();
            let x0 = wa.position.x;
            let y0 = wa.position.y;
            sx >= x0
                && sy >= y0
                && sx < x0 + wa.size.width as i32
                && sy < y0 + wa.size.height as i32
        })
        .unwrap_or(&monitors[0]);
    let wa = monitor.work_area();

    let wa_x = wa.position.x;
    let wa_y = wa.position.y;
    let wa_w = wa.size.width;
    let wa_h = wa.size.height;

    Some(clamp_rect(sx, sy, width, height, wa_x, wa_y, wa_w, wa_h))
}

/// Pure clamping rule, unit-testable without a real window.
fn clamp_rect(
    sx: i32,
    sy: i32,
    width: u32,
    height: u32,
    wa_x: i32,
    wa_y: i32,
    wa_w: u32,
    wa_h: u32,
) -> (i32, i32, u32, u32) {
    let w = width.min(wa_w).max(1);
    let h = height.min(wa_h).max(1);

    // Keep at least 120 px of the window horizontally and the title bar
    // vertically inside the work area.
    let min_x = wa_x - w as i32 + 120;
    let max_x = wa_x + wa_w as i32 - 120;
    let min_y = wa_y;
    let max_y = wa_y + wa_h as i32 - 40;

    let x = sx.clamp(min_x.min(max_x), max_x);
    let y = sy.clamp(min_y.min(max_y), max_y);
    (x, y, w, h)
}

/// Debounced save after move/resize/maximize. Cheap even during drags.
pub fn schedule_save(window: WebviewWindow) {
    let generation = SAVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(350));
        if SAVE_GEN.load(Ordering::SeqCst) != generation {
            return; // a newer event superseded this one
        }
        let _ = save_now(&window);
    });
}

/// Synchronous save (close request / app exit).
pub fn save_now(window: &WebviewWindow) -> Result<(), String> {
    if appdir::app_dir().is_none() {
        return Ok(());
    }
    let mut map = read_state();
    let maximized = window.is_maximized().unwrap_or(false);

    if !maximized {
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            map.insert("x".into(), Value::from(pos.x));
            map.insert("y".into(), Value::from(pos.y));
            map.insert("width".into(), Value::from(size.width));
            map.insert("height".into(), Value::from(size.height));
        }
    }
    map.insert("maximized".into(), Value::from(maximized));
    write_state(&map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_keeps_offscreen_window_reachable() {
        // Saved far off the left edge → at least 120 px remains visible.
        let (x, y, w, h) = clamp_rect(-5000, 100, 1100, 760, 0, 0, 1920, 1040);
        assert_eq!(x, -980);
        assert_eq!(y, 100);
        assert_eq!((w, h), (1100, 760));
    }

    #[test]
    fn clamp_fits_oversized_window_to_work_area() {
        let (x, y, w, h) = clamp_rect(100, 100, 4000, 3000, 0, 0, 1920, 1040);
        assert_eq!((w, h), (1920, 1040));
        assert_eq!((x, y), (100, 100));
    }

    #[test]
    fn clamp_keeps_title_bar_on_screen() {
        let (_, y, _, _) = clamp_rect(100, 99999, 1100, 760, 0, 0, 1920, 1040);
        assert_eq!(y, 1000);
    }
}
