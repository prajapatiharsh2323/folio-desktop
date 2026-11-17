// S2: streaming backup export + inspection (02 §5, 05 §4).
//
// `backup_export` walks the library and streams each file into the destination
// ZIP one entry at a time — a multi-gigabyte library never materialises in
// memory the way the TS `zipSync` fallback does. The archive is verified after
// the write (entry count + manifest checksum) before the command reports
// success, and progress events (`folio://backup-progress`) keep the UI live.
// `backup_inspect` reads only the central directory + metadata — it never
// expands an entry, so a hostile archive cannot cost memory to describe.
//
// The produced archive is the same v2 schema the TS restore path validates
// (see desktop/src/backup/backupSchema.ts): manifest.json + docs/** + user/**
// + a root backup.json, no derived index.

use crate::guard::guard_sandboxed;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

const BACKUP_META_NAME: &str = "backup.json";
const MANIFEST_NAME: &str = "manifest.json";
const BACKUP_SCHEMA: i64 = 2;

/// 64 KiB copy chunks keep per-entry streaming off the allocator fast path.
const COPY_CHUNK: usize = 65536;
/// Progress events are emitted every N entries (and at 0 and the end).
const PROGRESS_EVERY: u64 = 16;

/// S2: set by `backup_cancel` from the webview; the next entry boundary in
/// `backup_export` aborts the write and removes the partial archive. Cleared
/// at the start of every export so a stale signal cannot kill a new run.
static BACKUP_CANCELLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    done: u64,
    total: u64,
    current: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    schema: i64,
    created_at: String,
    app_version: String,
    doc_count: i64,
    file_count: i64,
    uncompressed_bytes: i64,
    compressed_bytes: i64,
    legacy: bool,
    warnings: Vec<String>,
}

/// UTC ISO-8601 with millisecond precision, `nowIso()` parity.
fn iso_now() -> String {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z",
        h = rem / 3600,
        mi = (rem % 3600) / 60,
        s = rem % 60,
    )
}

/// Howard Hinnant's civil-from-days (proleptic Gregorian, era-correct).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn is_junk(name: &str) -> bool {
    name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini"
}

/// Library-entry classification parity with the TS `classifyArchivePath`:
/// manifest.json, docs/<slug>/<file> (3+ segments), user/<file>. Used only for
/// the file count / byte total recorded in backup.json.
fn is_library_entry(rel: &str) -> bool {
    if rel == MANIFEST_NAME {
        return true;
    }
    let segments = rel.split('/').count();
    if rel.starts_with("docs/") {
        return segments >= 3;
    }
    if rel.starts_with("user/") {
        return segments >= 2;
    }
    false
}

/// Relative file paths under `root` that belong in a backup. The derived
/// search index is excluded (rebuilt after restore), as are OS junk files,
/// temp files and a stale backup.json from a previous export.
fn collect_files(root: &Path, rel: String, out: &mut Vec<String>) -> Result<(), String> {
    let dir = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(&rel)
    };
    let mut children: Vec<(String, bool)> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() {
            continue;
        }
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        children.push((child_rel, is_dir));
    }
    children.sort();
    for (child_rel, is_dir) in children {
        let name = child_rel.rsplit('/').next().unwrap_or("");
        if is_dir {
            // Derived index text is rebuilt after restore.
            if child_rel == "index" {
                continue;
            }
            collect_files(root, child_rel, out)?;
            continue;
        }
        if child_rel == BACKUP_META_NAME || name.ends_with(".tmp") || is_junk(name) {
            continue;
        }
        out.push(child_rel);
    }
    Ok(())
}

struct ManifestFacts {
    doc_count: i64,
    library_id: Option<String>,
}

fn manifest_facts(root: &Path) -> Result<ManifestFacts, String> {
    let bytes = fs::read(root.join(MANIFEST_NAME)).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;
    let doc_count = value
        .get("docs")
        .and_then(|d| d.as_array())
        .map(|d| d.len() as i64)
        .ok_or("manifest.json has no document list")?;
    let library_id = value
        .get("libraryId")
        .and_then(|l| l.as_str())
        .map(str::to_string);
    Ok(ManifestFacts {
        doc_count,
        library_id,
    })
}

/// The streaming core: writes the archive and returns its summary. Progress is
/// reported through a callback so the command wrapper can emit Tauri events
/// while unit tests can drive the same code without an app handle.
fn backup_export_core(
    root: &Path,
    dest: &Path,
    app_version: &str,
    on_progress: &mut dyn FnMut(u64, u64, &str),
) -> Result<BackupSummary, String> {
    let mut rels: Vec<String> = Vec::new();
    collect_files(root, String::new(), &mut rels)?;
    if !rels.iter().any(|r| r == MANIFEST_NAME) {
        return Err(
            "Your library has no manifest, so it cannot be backed up. Repair the library first."
                .to_string(),
        );
    }
    let total = rels.len() as u64;
    on_progress(0, total, "");

    let facts = manifest_facts(root)?;

    // The library root is trusted input (the app owns every byte under it), so
    // entry names are written as-is — they are relative, forward-slash paths
    // built by collect_files.
    let file = File::create(dest).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(BufWriter::new(file));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);

    let mut manifest_sha = Sha256::new();
    let mut file_count: i64 = 0;
    let mut uncompressed: i64 = 0;
    let mut chunk = [0u8; COPY_CHUNK];
    let mut done: u64 = 0;

    for rel in &rels {
        if BACKUP_CANCELLED.load(std::sync::atomic::Ordering::SeqCst) {
            // Drop the partial archive so no truncated zip is left behind.
            let _ = fs::remove_file(dest);
            return Err("backup was cancelled".to_string());
        }
        let library = is_library_entry(rel);
        writer.start_file(rel, options).map_err(|e| e.to_string())?;
        let mut src = File::open(root.join(rel)).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        loop {
            let n = src.read(&mut chunk).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            writer.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
            hasher.update(&chunk[..n]);
            if library {
                uncompressed += n as i64;
            }
        }
        if library {
            file_count += 1;
        }
        if rel == MANIFEST_NAME {
            manifest_sha = hasher;
        }
        done += 1;
        if done.is_multiple_of(PROGRESS_EVERY) {
            on_progress(done, total, rel);
        }
    }

    // backup.json (metadata entry, not counted in file_count/uncompressed).
    let meta = serde_json::json!({
        "schema": BACKUP_SCHEMA,
        "app": "folio",
        "createdAt": iso_now(),
        "appVersion": app_version,
        "libraryId": facts.library_id,
        "manifestSha256": format!("{:x}", manifest_sha.finalize()),
        "docCount": facts.doc_count,
        "fileCount": file_count,
        "uncompressedBytes": uncompressed,
    });
    writer
        .start_file(BACKUP_META_NAME, options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(meta.to_string().as_bytes())
        .map_err(|e| e.to_string())?;

    let mut inner = writer.finish().map_err(|e| e.to_string())?;
    inner.flush().map_err(|e| e.to_string())?;
    let compressed = fs::metadata(dest).map_err(|e| e.to_string())?.len() as i64;
    drop(inner);

    // Verify before reporting success: the archive must open, hold every
    // entry, and its manifest bytes must match the recorded checksum.
    verify_archive(dest, rels.len(), &hex_manifest_sha(root)?)?;

    on_progress(total, total, "");
    Ok(BackupSummary {
        schema: BACKUP_SCHEMA,
        created_at: iso_now(),
        app_version: app_version.to_string(),
        doc_count: facts.doc_count,
        file_count,
        uncompressed_bytes: uncompressed,
        compressed_bytes: compressed,
        legacy: false,
        warnings: Vec::new(),
    })
}

fn hex_manifest_sha(root: &Path) -> Result<String, String> {
    let bytes = fs::read(root.join(MANIFEST_NAME)).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_archive(
    dest: &Path,
    expected_entries: usize,
    manifest_sha_hex: &str,
) -> Result<(), String> {
    let file = File::open(dest).map_err(|e| e.to_string())?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("the written backup cannot be opened: {e}"))?;
    if archive.len() != expected_entries + 1 {
        return Err("the written backup is missing entries".to_string());
    }
    let mut manifest = archive
        .by_name(MANIFEST_NAME)
        .map_err(|e| format!("the written backup is missing its manifest: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; COPY_CHUNK];
    loop {
        let n = manifest.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    if format!("{:x}", hasher.finalize()) != manifest_sha_hex {
        return Err("the written backup failed its manifest checksum verification".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn backup_export(
    app: tauri::AppHandle,
    dest_path: String,
) -> Result<BackupSummary, String> {
    // A fresh export always starts from a clean cancellation signal.
    BACKUP_CANCELLED.store(false, std::sync::atomic::Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let dest = guard_sandboxed(&dest_path).map_err(|e| e.to_string())?;
        let root = guard_sandboxed("/folio-library/library").map_err(|e| e.to_string())?;
        let app_version = app.package_info().version.to_string();
        let handle = app.clone();
        backup_export_core(&root, &dest, &app_version, &mut |done, total, current| {
            let _ = handle.emit(
                "folio://backup-progress",
                BackupProgress {
                    done,
                    total,
                    current: current.to_string(),
                },
            );
        })
    })
    .await
    .map_err(|e| format!("backup task failed: {e}"))?
}

#[tauri::command]
pub async fn backup_inspect(path: String) -> Result<BackupSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = guard_sandboxed(&path).map_err(|e| e.to_string())?;
        backup_inspect_core(&p)
    })
    .await
    .map_err(|e| format!("backup task failed: {e}"))?
}

/// S2: request cancellation of a running `backup_export`. The flag is checked
/// at every entry boundary, so a multi-gigabyte export stops within one file
/// instead of at command return. Harmless when nothing is running: the flag is
/// cleared when the next export starts.
#[tauri::command]
pub async fn backup_cancel() -> Result<(), String> {
    BACKUP_CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// Central-directory-only inspection: metadata + manifest checksum, no entry
/// is ever expanded.
fn backup_inspect_core(path: &Path) -> Result<BackupSummary, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("not a readable ZIP: {e}"))?;

    let meta_bytes = read_entry(&mut archive, BACKUP_META_NAME, 1024 * 1024)?;
    let meta: serde_json::Value = serde_json::from_slice(&meta_bytes)
        .map_err(|_| "This backup's backup.json is not valid JSON.".to_string())?;
    if meta.get("app").and_then(|a| a.as_str()) != Some("folio") {
        return Err("This ZIP is not a Folio backup.".to_string());
    }
    let schema = meta
        .get("schema")
        .and_then(|s| s.as_i64())
        .ok_or("This backup has no format version.")?;
    if schema > BACKUP_SCHEMA {
        return Err(format!(
            "This backup was made by a newer version of Folio (schema {schema}). Update Folio before restoring it."
        ));
    }

    let mut warnings: Vec<String> = Vec::new();
    let legacy = schema == 1;
    if legacy {
        warnings.push("This is an older backup format; it will be upgraded after restore.".into());
    }

    // Manifest checksum (when recorded) + central-directory accounting.
    let manifest_sha_recorded = meta
        .get("manifestSha256")
        .and_then(|s| s.as_str())
        .unwrap_or("");
    let mut file_count: i64 = 0;
    let mut uncompressed: i64 = 0;
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i).map_err(|e| e.to_string())?;
        let name = entry.name().map_err(|e| e.to_string())?.into_owned();
        if name.ends_with('/') {
            continue;
        }
        names.push(name.clone());
        if is_library_entry(&name) {
            file_count += 1;
            uncompressed += entry.size() as i64;
        }
    }

    let manifest_sha_actual = {
        let mut manifest = archive
            .by_name(MANIFEST_NAME)
            .map_err(|_| "This backup has no manifest.json.".to_string())?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; COPY_CHUNK];
        loop {
            let n = manifest.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        format!("{:x}", hasher.finalize())
    };
    if !manifest_sha_recorded.is_empty() {
        if manifest_sha_recorded != manifest_sha_actual {
            return Err(
                "This backup is damaged: its manifest does not match the recorded checksum."
                    .to_string(),
            );
        }
    } else {
        warnings.push("This backup has no checksum; its contents could not be verified.".into());
    }

    let doc_count = if legacy {
        -1
    } else {
        meta.get("docCount").and_then(|d| d.as_i64()).unwrap_or(-1)
    };
    let declared_files = if legacy {
        -1
    } else {
        meta.get("fileCount").and_then(|d| d.as_i64()).unwrap_or(-1)
    };
    let declared_bytes = if legacy {
        -1
    } else {
        meta.get("uncompressedBytes")
            .and_then(|d| d.as_i64())
            .unwrap_or(-1)
    };
    if !legacy {
        if doc_count < 0 || declared_files < 0 || declared_bytes < 0 {
            return Err("This backup's metadata is incomplete.".to_string());
        }
        if declared_files != file_count {
            return Err("This backup's file count does not match its contents.".to_string());
        }
        if declared_bytes != uncompressed {
            return Err("This backup's size does not match its contents.".to_string());
        }
        if !names.iter().any(|n| n == MANIFEST_NAME) {
            return Err("This backup has no manifest.json.".to_string());
        }
    }

    Ok(BackupSummary {
        schema,
        created_at: meta
            .get("createdAt")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string(),
        app_version: if legacy {
            String::new()
        } else {
            meta.get("appVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        },
        doc_count,
        file_count,
        uncompressed_bytes: uncompressed,
        compressed_bytes: fs::metadata(path).map_err(|e| e.to_string())?.len() as i64,
        legacy,
        warnings,
    })
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str, max: usize) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| format!("This ZIP is not a Folio backup ({name} is missing)."))?;
    let mut out = Vec::new();
    let mut buf = [0u8; COPY_CHUNK];
    loop {
        let n = entry.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        if out.len() > max {
            return Err("This backup's metadata is too large.".to_string());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appdir;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("folio-backup-{tag}-{}-{nanos}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn seed_library(root: &Path) {
        fs::create_dir_all(root.join("docs/dune/reading")).unwrap();
        fs::create_dir_all(root.join("docs/dune/cache")).unwrap();
        fs::create_dir_all(root.join("user")).unwrap();
        fs::create_dir_all(root.join("index/text")).unwrap();
        fs::write(root.join("manifest.json"), r#"{"schema":1,"app":"folio","libraryId":"lib-1","updatedAt":"2026-01-01T00:00:00.000Z","docs":[{"id":"d1","slug":"dune","title":"Dune","contentHash":"h1","updatedAt":"2026-01-01T00:00:00.000Z","files":[]}]}"#).unwrap();
        fs::write(root.join("docs/dune/reading/book.epub"), b"epub-bytes").unwrap();
        fs::write(root.join("docs/dune/meta.json"), b"{}").unwrap();
        fs::write(root.join("docs/dune/cache/cover-thumb.jpg"), b"thumb").unwrap();
        fs::write(root.join("user/progress.json"), b"{}").unwrap();
        fs::write(root.join("index/text/d1.json"), b"derived").unwrap();
        fs::write(root.join("docs/dune/reading/book.epub.tmp"), b"stray").unwrap();
    }

    fn no_progress(_done: u64, _total: u64, _current: &str) {}

    /// BACKUP_CANCELLED is process-wide; the export and cancel tests run in
    /// parallel threads on Windows, so serialize them.
    static TEST_BACKUP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn export_streams_and_verifies_then_inspect_matches() {
        let _lock = TEST_BACKUP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        // A cancelled signal from another test must not kill this export.
        BACKUP_CANCELLED.store(false, std::sync::atomic::Ordering::SeqCst);
        let dir = temp_dir("roundtrip");
        let root = dir.join("library");
        seed_library(&root);
        let dest = dir.join("backup.zip");

        let summary = backup_export_core(&root, &dest, "0.1.0", &mut no_progress).unwrap();
        // index/, .tmp and a stale backup.json are excluded; manifest +
        // docs/dune/reading/book.epub + docs/dune/meta.json +
        // docs/dune/cache/cover-thumb.jpg + user/progress.json = 5 library
        // entries.
        assert_eq!(summary.file_count, 5);
        assert_eq!(summary.doc_count, 1);
        assert!(summary.compressed_bytes > 0);

        // The archive verifies: it opens and the manifest checksum matches.
        verify_archive(&dest, 5, &hex_manifest_sha(&root).unwrap()).unwrap();

        let inspected = backup_inspect_core(&dest).unwrap();
        assert_eq!(inspected.file_count, summary.file_count);
        assert_eq!(inspected.uncompressed_bytes, summary.uncompressed_bytes);
        assert_eq!(inspected.doc_count, summary.doc_count);
        assert!(!inspected.legacy);
        assert!(inspected.warnings.is_empty());

        // Entry names: no index/, no .tmp, plus backup.json.
        let file = File::open(&dest).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| {
                archive
                    .by_index_raw(i)
                    .unwrap()
                    .name()
                    .unwrap()
                    .into_owned()
            })
            .collect();
        assert!(names.contains(&MANIFEST_NAME.to_string()));
        assert!(names.contains(&BACKUP_META_NAME.to_string()));
        assert!(names.contains(&"docs/dune/reading/book.epub".to_string()));
        assert!(names.contains(&"docs/dune/cache/cover-thumb.jpg".to_string()));
        assert!(names.contains(&"user/progress.json".to_string()));
        assert!(!names.iter().any(|n| n.starts_with("index")));
        assert!(!names.iter().any(|n| n.ends_with(".tmp")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_without_manifest_is_refused() {
        let dir = temp_dir("nomanifest");
        let root = dir.join("library");
        fs::create_dir_all(&root).unwrap();
        let err =
            backup_export_core(&root, &dir.join("b.zip"), "0.1.0", &mut no_progress).unwrap_err();
        assert!(err.contains("no manifest"));
        // Nothing was written on refusal.
        assert!(!dir.join("b.zip").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_cancel_removes_partial_archive() {
        use std::sync::atomic::Ordering;

        let _lock = TEST_BACKUP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = temp_dir("cancel");
        let root = dir.join("library");
        seed_library(&root);
        let dest = dir.join("b.zip");

        // Cancel before the run: the entry loop aborts and leaves no file.
        BACKUP_CANCELLED.store(true, Ordering::SeqCst);
        let err = backup_export_core(&root, &dest, "0.1.0", &mut no_progress).unwrap_err();
        assert!(err.contains("cancelled"));
        assert!(!dest.exists());

        // The command clears the flag at the start of the next export, so a
        // stale signal cannot kill a fresh run.
        BACKUP_CANCELLED.store(false, Ordering::SeqCst);
        backup_export_core(&root, &dest, "0.1.0", &mut no_progress).unwrap();
        assert!(dest.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn inspect_reports_legacy_and_missing_checksum_warnings() {
        let dir = temp_dir("legacy");
        let dest = dir.join("legacy.zip");
        {
            let file = File::create(&dest).unwrap();
            let mut zw = zip::ZipWriter::new(BufWriter::new(file));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zw.start_file(MANIFEST_NAME, opts).unwrap();
            zw.write_all(br#"{"schema":1,"app":"folio","docs":[]}"#)
                .unwrap();
            zw.start_file(BACKUP_META_NAME, opts).unwrap();
            zw.write_all(br#"{"schema":1,"app":"folio","createdAt":"2025-01-01T00:00:00.000Z"}"#)
                .unwrap();
            zw.finish().unwrap();
        }
        let summary = backup_inspect_core(&dest).unwrap();
        assert!(summary.legacy);
        assert_eq!(summary.schema, 1);
        assert!(summary
            .warnings
            .iter()
            .any(|w| w.contains("older backup format")));
        assert!(summary.warnings.iter().any(|w| w.contains("no checksum")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn inspect_rejects_non_folio_and_schema_mismatch() {
        let dir = temp_dir("reject");
        // A zip with no backup.json.
        let plain = dir.join("plain.zip");
        {
            let file = File::create(&plain).unwrap();
            let mut zw = zip::ZipWriter::new(BufWriter::new(file));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zw.start_file("random.txt", opts).unwrap();
            zw.write_all(b"x").unwrap();
            zw.finish().unwrap();
        }
        assert!(backup_inspect_core(&plain).is_err());

        // A v3 backup.json → unsupported schema.
        let future = dir.join("future.zip");
        {
            let file = File::create(&future).unwrap();
            let mut zw = zip::ZipWriter::new(BufWriter::new(file));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zw.start_file(BACKUP_META_NAME, opts).unwrap();
            zw.write_all(br#"{"schema":3,"app":"folio"}"#).unwrap();
            zw.finish().unwrap();
        }
        let err = backup_inspect_core(&future).unwrap_err();
        assert!(err.contains("newer version of Folio"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_is_confined_to_the_sandbox() {
        let _lock = appdir::lock_app_dir_for_tests();
        let app = temp_dir("confine-app");
        appdir::set_app_dir(app.clone());
        let outside = temp_dir("confine-outside");
        let outside_dest = outside.join("steal.zip");
        // An ungranted destination must be refused by the guard.
        let err = guard_sandboxed(&outside_dest.to_string_lossy()).unwrap_err();
        assert!(matches!(err, crate::guard::GuardError::OutsideSandbox));
        let _ = fs::remove_dir_all(&app);
        let _ = fs::remove_dir_all(&outside);
    }
}
