use crate::guard::guard_user_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    pub size: u64,
    pub mtime_ms: i64,
    pub is_dir: bool,
}

fn guard(path: &str) -> Result<PathBuf, String> {
    guard_user_path(path).map_err(|e| e.to_string())
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

/// Free bytes available to the current user on the volume holding `path`.
#[tauri::command]
pub fn fs_free_space(path: String) -> Result<u64, String> {
    let p = guard(&path)?;
    let dir = if p.is_dir() {
        p
    } else {
        p.parent().map(Path::to_path_buf).unwrap_or(p)
    };
    free_space(&dir).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn free_space(path: &Path) -> std::io::Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut available: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;
    // SAFETY: `wide` is NUL-terminated and the out-pointers are valid for the
    // duration of the call.
    let ok =
        unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut total_free) };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(available)
    }
}

#[cfg(not(windows))]
fn free_space(_path: &Path) -> std::io::Result<u64> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "free space is only implemented on Windows",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("folio-fs-{tag}-{}-{nanos}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn s(p: &PathBuf) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn write_read_roundtrip_and_overwrite() {
        let dir = temp_dir("roundtrip");
        let file = dir.join("nested").join("data.bin");
        fs_write_atomic(s(&file), b"hello".to_vec()).unwrap();
        assert_eq!(fs_read(s(&file)).unwrap(), b"hello");
        // atomic overwrite of an existing file
        fs_write_atomic(s(&file), b"world".to_vec()).unwrap();
        assert_eq!(fs_read(s(&file)).unwrap(), b"world");
        // no temp file left behind
        let stray: Vec<_> = fs::read_dir(file.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(stray.is_empty(), "temp file left behind");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stat_list_move_delete() {
        let dir = temp_dir("ops");
        let a = dir.join("a.txt");
        let b = dir.join("sub").join("b.txt");
        fs_write_atomic(s(&a), b"12345".to_vec()).unwrap();

        let st = fs_stat(s(&a)).unwrap().expect("stat present");
        assert!(!st.is_dir);
        assert_eq!(st.size, 5);
        assert!(st.mtime_ms > 0);

        let entries = fs_list_dir(s(&dir)).unwrap();
        assert!(entries
            .iter()
            .any(|e| e.path.ends_with("a.txt") && !e.is_dir));

        fs_move(s(&a), s(&b)).unwrap();
        assert!(fs_stat(s(&a)).unwrap().is_none());
        assert_eq!(fs_read(s(&b)).unwrap(), b"12345");

        fs_delete(s(&b)).unwrap();
        assert!(fs_stat(s(&b)).unwrap().is_none());
        // delete is idempotent on a missing path
        fs_delete(s(&b)).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn guards_traversal_and_relative_paths() {
        assert!(fs_read("../escape".to_string()).is_err());
        assert!(fs_write_atomic("../escape".to_string(), vec![1]).is_err());
        assert!(fs_list_dir("/a/../../b".to_string()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn free_space_reports_positive() {
        let dir = temp_dir("free");
        let free = fs_free_space(s(&dir)).unwrap();
        assert!(free > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn entry_and_stat_serialize_camel_case() {
        // The TS FileStore reads `isDir`/`mtimeMs`; a snake_case regression
        // silently turns every directory into a file on Windows.
        let entry = serde_json::to_value(Entry {
            path: "C:\\lib\\docs".into(),
            is_dir: true,
        })
        .unwrap();
        assert_eq!(entry["isDir"], true);
        assert!(entry.get("is_dir").is_none());

        let stat = serde_json::to_value(Stat {
            size: 3,
            mtime_ms: 42,
            is_dir: false,
        })
        .unwrap();
        assert_eq!(stat["mtimeMs"], 42);
        assert!(stat.get("mtime_ms").is_none());
    }

    #[test]
    fn maps_virtual_app_dir_when_installed() {
        let dir = temp_dir("virtual");
        crate::appdir::set_app_dir(dir.clone());
        let virtual_path = crate::appdir::VIRTUAL_APP_DIR.to_string() + "/library/virtual.txt";
        fs_write_atomic(virtual_path, b"v".to_vec()).unwrap();
        assert_eq!(
            fs_read(s(&dir.join("library").join("virtual.txt"))).unwrap(),
            b"v"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
