use crate::guard::guard_sandboxed;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// E1: blocking filesystem work runs on the async runtime's blocking pool so
/// the main thread (and the webview IPC handler) never stalls on a big read.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("filesystem task failed: {e}"))?
}

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
    guard_sandboxed(path).map_err(|e| e.to_string())
}

/// E1: raw request body reads resolve to an `ArrayBuffer` on the frontend —
/// no base64/array JSON encoding for book-sized reads.
#[tauri::command]
pub async fn fs_read(path: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || {
        let p = guard(&path)?;
        fs::read(&p)
            .map(tauri::ipc::Response::new)
            .map_err(|e| e.to_string())
    })
    .await
}

/// The write path is driven by a raw IPC body (`invoke(cmd, bytes, headers)`):
/// the target path rides the `x-folio-path` header so the payload can stay
/// binary instead of a JSON byte array.
const PATH_HEADER: &str = "x-folio-path";

#[tauri::command]
pub async fn fs_write_atomic(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get(PATH_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .ok_or_else(|| format!("missing {PATH_HEADER} header"))?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.to_vec(),
        _ => return Err("fs_write_atomic expects a raw body".to_string()),
    };
    blocking(move || fs_write_atomic_sync(&path, &data)).await
}

/// Unique temp file name (E1): two concurrent writes to the same target can
/// no longer share one `{p}.tmp` and rename each other's bytes. The name
/// keeps the `.tmp` suffix so stray cleanup stays trivial.
fn unique_tmp(p: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    PathBuf::from(format!(
        "{}.{}-{}-{}.tmp",
        p.display(),
        std::process::id(),
        nanos,
        n
    ))
}

pub fn fs_write_atomic_sync(path: &str, data: &[u8]) -> Result<(), String> {
    let p = guard(path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = unique_tmp(&p);
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data).map_err(|e| e.to_string())?;
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
                std::thread::sleep(std::time::Duration::from_millis(delay));
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
pub async fn fs_delete(path: String) -> Result<(), String> {
    blocking(move || {
        let p = guard(&path)?;
        // Idempotent for a missing path, but never hide permission/IO failures:
        // restore and library deletion rely on knowing that cleanup succeeded.
        let result = if p.is_dir() {
            fs::remove_dir_all(&p)
        } else {
            fs::remove_file(&p)
        };
        match result {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
}

fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last_err = None;
    for delay in [10u64, 50, 250] {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(delay));
            }
        }
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) => Err(last_err.unwrap_or(e)),
    }
}

#[tauri::command]
pub async fn fs_move(from: String, to: String) -> Result<(), String> {
    blocking(move || {
        let a = guard(&from)?;
        let b = guard(&to)?;
        if let Some(parent) = b.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        rename_with_retry(&a, &b).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn fs_stat(path: String) -> Result<Option<Stat>, String> {
    blocking(move || {
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
    })
    .await
}

#[tauri::command]
pub async fn fs_list_dir(dir: String) -> Result<Vec<Entry>, String> {
    blocking(move || {
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
    })
    .await
}

/// E1: recursive byte size of a file or directory (symlinks not followed).
#[tauri::command]
pub async fn fs_dir_size(path: String) -> Result<u64, String> {
    blocking(move || {
        let p = guard(&path)?;
        dir_size_sync(&p).map_err(|e| e.to_string())
    })
    .await
}

pub fn dir_size_sync(p: &Path) -> std::io::Result<u64> {
    let md = fs::symlink_metadata(p)?;
    if md.is_file() {
        return Ok(md.len());
    }
    if !md.is_dir() {
        return Ok(0);
    }
    let mut total = 0u64;
    for entry in fs::read_dir(p)? {
        total += dir_size_sync(&entry?.path())?;
    }
    Ok(total)
}

/// E1: batched small reads for the library list — one IPC round trip instead
/// of one per row. A missing file yields `None`; a sandbox guard failure is
/// still a hard error so the path guard never silently weakens.
#[tauri::command]
pub async fn fs_read_many(paths: Vec<String>) -> Result<Vec<Option<Vec<u8>>>, String> {
    blocking(move || {
        let mut out = Vec::with_capacity(paths.len());
        for path in paths {
            let p = guard(&path)?;
            out.push(fs::read(&p).ok());
        }
        Ok(out)
    })
    .await
}

/// Free bytes available to the current user on the volume holding `path`.
#[tauri::command]
pub async fn fs_free_space(path: String) -> Result<u64, String> {
    blocking(move || {
        let p = guard(&path)?;
        let dir = if p.is_dir() {
            p
        } else {
            p.parent().map(Path::to_path_buf).unwrap_or(p)
        };
        free_space(&dir).map_err(|e| e.to_string())
    })
    .await
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

    fn s(p: &std::path::Path) -> String {
        p.to_string_lossy().to_string()
    }

    // The async commands add only the blocking-pool wrapper around these
    // sync bodies; unit tests exercise the sync bodies directly (no runtime
    // needed) plus the guard behaviour they share.
    fn read_bytes(path: &str) -> Result<Vec<u8>, String> {
        let p = guard(path)?;
        fs::read(&p).map_err(|e| e.to_string())
    }

    fn stat_sync(path: &str) -> Result<Option<Stat>, String> {
        let p = guard(path)?;
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

    fn list_dir_sync(dir: &str) -> Result<Vec<Entry>, String> {
        let p = guard(dir)?;
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

    fn move_sync(from: &str, to: &str) -> Result<(), String> {
        let a = guard(from)?;
        let b = guard(to)?;
        if let Some(parent) = b.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        rename_with_retry(&a, &b).map_err(|e| e.to_string())
    }

    fn delete_sync(path: &str) -> Result<(), String> {
        let p = guard(path)?;
        let result = if p.is_dir() {
            fs::remove_dir_all(&p)
        } else {
            fs::remove_file(&p)
        };
        match result {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    fn read_many_sync(paths: Vec<String>) -> Result<Vec<Option<Vec<u8>>>, String> {
        let mut out = Vec::with_capacity(paths.len());
        for path in paths {
            let p = guard(&path)?;
            out.push(fs::read(&p).ok());
        }
        Ok(out)
    }

    #[test]
    fn write_read_roundtrip_and_overwrite() {
        let dir = temp_dir("roundtrip");
        crate::sandbox::grant(&dir);
        let file = dir.join("nested").join("data.bin");
        fs_write_atomic_sync(s(&file).as_str(), b"hello").unwrap();
        assert_eq!(read_bytes(&s(&file)).unwrap(), b"hello");
        // atomic overwrite of an existing file
        fs_write_atomic_sync(s(&file).as_str(), b"world").unwrap();
        assert_eq!(read_bytes(&s(&file)).unwrap(), b"world");
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
    fn concurrent_writes_use_unique_temp_names() {
        let dir = temp_dir("unique");
        crate::sandbox::grant(&dir);
        let file = dir.join("target.bin");
        // Each write produces a distinct tmp name, so a crash mid-write can
        // never collide with a later write's temp file (E1). The suffix keeps
        // `.tmp` so stray cleanup stays trivial.
        let first = unique_tmp(&file);
        let second = unique_tmp(&file);
        assert_ne!(first, second);
        assert!(first.to_string_lossy().ends_with(".tmp"));
        fs_write_atomic_sync(s(&file).as_str(), b"one").unwrap();
        fs_write_atomic_sync(s(&file).as_str(), b"two").unwrap();
        assert_eq!(read_bytes(&s(&file)).unwrap(), b"two");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dir_size_sums_files_recursively() {
        let dir = temp_dir("size");
        crate::sandbox::grant(&dir);
        fs_write_atomic_sync(s(&dir.join("a.bin")).as_str(), b"12345").unwrap();
        fs_write_atomic_sync(s(&dir.join("nested").join("b.bin")).as_str(), b"123").unwrap();
        assert_eq!(dir_size_sync(&dir).unwrap(), 8);
        // A file path reports its own size.
        assert_eq!(dir_size_sync(&dir.join("a.bin")).unwrap(), 5);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_many_returns_none_for_missing_and_bytes_for_present() {
        let dir = temp_dir("readmany");
        crate::sandbox::grant(&dir);
        fs_write_atomic_sync(s(&dir.join("a.json")).as_str(), b"{}").unwrap();
        let out =
            read_many_sync(vec![s(&dir.join("a.json")), s(&dir.join("missing.json"))]).unwrap();
        assert_eq!(out[0].as_deref(), Some(b"{}".as_slice()));
        assert_eq!(out[1], None);
    }

    #[test]
    fn stat_list_move_delete() {
        let dir = temp_dir("ops");
        crate::sandbox::grant(&dir);
        let a = dir.join("a.txt");
        let b = dir.join("sub").join("b.txt");
        fs_write_atomic_sync(s(&a).as_str(), b"12345").unwrap();

        let st = stat_sync(&s(&a)).unwrap().expect("stat present");
        assert!(!st.is_dir);
        assert_eq!(st.size, 5);
        assert!(st.mtime_ms > 0);

        let entries = list_dir_sync(&s(&dir)).unwrap();
        assert!(entries
            .iter()
            .any(|e| e.path.ends_with("a.txt") && !e.is_dir));

        move_sync(&s(&a), &s(&b)).unwrap();
        assert!(stat_sync(&s(&a)).unwrap().is_none());
        assert_eq!(read_bytes(&s(&b)).unwrap(), b"12345");

        delete_sync(&s(&b)).unwrap();
        assert!(stat_sync(&s(&b)).unwrap().is_none());
        // delete is idempotent on a missing path
        delete_sync(&s(&b)).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_removes_nonempty_directory() {
        let dir = temp_dir("delete-dir");
        crate::sandbox::grant(&dir);
        fs_write_atomic_sync(s(&dir.join("nested").join("file.txt")).as_str(), b"x").unwrap();
        delete_sync(&s(&dir)).unwrap();
        assert!(stat_sync(&s(&dir)).unwrap().is_none());
        // idempotent
        delete_sync(&s(&dir)).unwrap();
    }

    #[test]
    fn guards_traversal_and_relative_paths() {
        assert!(guard("../escape").is_err());
        assert!(fs_write_atomic_sync("../escape", &[1]).is_err());
        assert!(guard("/a/../../b").is_err());
    }

    #[test]
    fn rejects_paths_outside_the_sandbox() {
        let _lock = crate::appdir::lock_app_dir_for_tests();
        let app = temp_dir("sandbox-app");
        crate::appdir::set_app_dir(app.clone());
        let outside = temp_dir("sandbox-outside");
        let outside_file = outside.join("victim.txt");
        fs::write(&outside_file, b"do not touch").unwrap();
        let outside_string = outside_file.to_string_lossy().to_string();

        // Reads, writes and deletes all refuse an arbitrary absolute path.
        assert!(read_bytes(&outside_string).is_err());
        assert!(fs_write_atomic_sync(outside_string.as_str(), &[1]).is_err());
        assert!(delete_sync(&outside_string).is_err());
        assert!(stat_sync(&outside_string).is_err());
        assert!(list_dir_sync(outside.to_string_lossy().as_ref()).is_err());
        // The file survived: fs_delete can no longer remove anything outside.
        assert!(outside_file.is_file());

        // A granted path still works end-to-end.
        crate::sandbox::grant(&outside);
        assert!(read_bytes(&outside_string).is_ok());
        delete_sync(&outside_string).unwrap();
        assert!(!outside_file.exists());

        crate::sandbox::clear_grants();
        crate::appdir::set_app_dir(PathBuf::from("/folio-library"));
        let _ = fs::remove_dir_all(&app);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(windows)]
    #[test]
    fn free_space_reports_positive() {
        let dir = temp_dir("free");
        let free = free_space(&dir).unwrap();
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
        let _lock = crate::appdir::lock_app_dir_for_tests();
        let dir = temp_dir("virtual");
        crate::appdir::set_app_dir(dir.clone());
        let virtual_path = crate::appdir::VIRTUAL_APP_DIR.to_string() + "/library/virtual.txt";
        fs_write_atomic_sync(virtual_path.as_str(), b"v").unwrap();
        assert_eq!(
            read_bytes(&dir.join("library").join("virtual.txt").to_string_lossy()).unwrap(),
            b"v"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
