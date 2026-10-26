use crate::guard::{normalize_absolute, GuardError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Entry {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Stat {
    pub size: u64,
    pub mtime_ms: i64,
    pub is_dir: bool,
}

fn guard(path: &str) -> Result<PathBuf, String> {
    normalize_absolute(path).map_err(|e: GuardError| e.to_string())
}

#[tauri::command]
pub fn fs_read(path: String) -> Result<Vec<u8>, String> {
    let p = guard(&path)?;
    fs::read(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_atomic(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = guard(&path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", p.display()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(&data).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    // rename with retry
    let mut last_err = None;
    for delay in [10u64, 50, 250] {
        match fs::rename(&tmp, &p) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                thread::sleep(Duration::from_millis(delay));
            }
        }
    }
    // final attempt
    let res = fs::rename(&tmp, &p);
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    let _ = last_err;
    Ok(())
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    let p = guard(&path)?;
    if p.is_dir() {
        let _ = fs::remove_dir_all(&p);
    } else {
        let _ = fs::remove_file(&p);
    }
    Ok(())
}

#[tauri::command]
pub fn fs_move(from: String, to: String) -> Result<(), String> {
    let a = guard(&from)?;
    let b = guard(&to)?;
    if let Some(parent) = b.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&a, &b).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_stat(path: String) -> Result<Option<Stat>, String> {
    let p = guard(&path)?;
    match fs::metadata(&p) {
        Ok(m) => {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Ok(Some(Stat {
                size: m.len(),
                mtime_ms: mtime,
                is_dir: m.is_dir(),
            }))
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn fs_list_dir(dir: String) -> Result<Vec<Entry>, String> {
    let p = guard(&dir)?;
    let mut out = Vec::new();
    if !p.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(&p).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(Entry {
            path: path.to_string_lossy().to_string(),
            is_dir,
        });
    }
    Ok(out)
}
