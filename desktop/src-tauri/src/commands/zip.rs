use crate::guard::guard_sandboxed;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};

/// Defence-in-depth against zip bombs: entry count and total uncompressed
/// bytes are capped per archive. The backup contract (05 §5) holds ~50 files
/// of JSON plus books; 4 GiB total is far above any real library.
const MAX_ENTRIES: usize = 20_000;
const MAX_TOTAL_UNCOMPRESSED: u64 = 4 * 1024 * 1024 * 1024;
/// Single entries above this are almost certainly an attack (the largest
/// legitimate book is capped well below this at import).
const MAX_ENTRY_UNCOMPRESSED: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ZipEntry {
    pub name: String,
    pub data: Vec<u8>,
}

#[tauri::command]
pub fn zip_read(path: String) -> Result<Vec<ZipEntry>, String> {
    let p = guard_sandboxed(&path).map_err(|e| e.to_string())?;
    let file = File::open(&p).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.len() > MAX_ENTRIES {
        return Err("Archive has too many entries".to_string());
    }
    let mut out = Vec::new();
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let size = entry.size();
        if size > MAX_ENTRY_UNCOMPRESSED {
            return Err("Archive entry is too large to read".to_string());
        }
        total = total.saturating_add(size);
        if total > MAX_TOTAL_UNCOMPRESSED {
            return Err("Archive is too large to read".to_string());
        }
        let mut data = Vec::new();
        // Bounded read: a header may lie about sizes, so enforce the cap on
        // the bytes actually decompressed instead of trusting `entry.size()`.
        let mut chunk = [0u8; 65536];
        let mut entry_total: u64 = 0;
        loop {
            let n = entry.read(&mut chunk).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            entry_total += n as u64;
            total += n as u64;
            if entry_total > MAX_ENTRY_UNCOMPRESSED || total > MAX_TOTAL_UNCOMPRESSED {
                return Err("Archive is too large to read".to_string());
            }
            data.extend_from_slice(&chunk[..n]);
        }
        out.push(ZipEntry { name, data });
    }
    Ok(out)
}

#[tauri::command]
pub fn zip_write(path: String, entries: Vec<ZipEntry>) -> Result<(), String> {
    let p = guard_sandboxed(&path).map_err(|e| e.to_string())?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = File::create(&p).map_err(|e| e.to_string())?;
    let mut zw = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for e in entries {
        zw.start_file(&e.name, opts).map_err(|er| er.to_string())?;
        zw.write_all(&e.data).map_err(|er| er.to_string())?;
    }
    zw.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("folio-zip-{tag}-{}-{nanos}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    use std::time::UNIX_EPOCH;

    #[test]
    fn write_read_roundtrip_inside_app_dir() {
        let _lock = crate::appdir::lock_app_dir_for_tests();
        let app = temp_path("app");
        crate::appdir::set_app_dir(app.clone());
        let zip_path = format!("{}/backup/folio.zip", crate::appdir::VIRTUAL_APP_DIR);
        zip_write(
            zip_path.clone(),
            vec![ZipEntry {
                name: "one.txt".into(),
                data: b"hello".to_vec(),
            }],
        )
        .unwrap();
        let entries = zip_read(zip_path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "one.txt");
        assert_eq!(entries[0].data, b"hello");
        crate::appdir::set_app_dir(std::path::PathBuf::from(crate::appdir::VIRTUAL_APP_DIR));
        let _ = std::fs::remove_dir_all(&app);
    }

    #[test]
    fn rejects_paths_outside_the_sandbox() {
        let dir = temp_path("outside");
        let outside_zip = dir.join("outside.zip");
        assert!(zip_write(
            outside_zip.to_string_lossy().to_string(),
            vec![ZipEntry {
                name: "x".into(),
                data: b"x".to_vec(),
            }],
        )
        .is_err());
        assert!(zip_read(outside_zip.to_string_lossy().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
