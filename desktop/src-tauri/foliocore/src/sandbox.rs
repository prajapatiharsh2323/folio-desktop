//! Session-scoped grants for paths outside the app data directory.
//!
//! The file commands confine every path to the app dir. Legitimate exceptions
//! are limited to paths the user physically picked this session: a native
//! open/save dialog result, a drag-drop into the window, or a launch argument
//! (open-with). Those are granted here when Rust learns about them; every
//! later command check canonicalizes the requested path (resolving symlinks
//! and Windows junctions) and requires it to stay inside the app dir or one
//! of the granted roots.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

static GRANTED: RwLock<Option<BTreeSet<PathBuf>>> = RwLock::new(None);

/// Canonicalize as deep as possible: if the full path does not exist yet
/// (save-dialog targets, new files), resolve the deepest *existing* ancestor
/// through the filesystem so symlink and junction aliases collapse, then
/// re-attach the missing components.
pub fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(c) = path.canonicalize() {
        return c;
    }
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path.to_path_buf();
    while let Some(name) = current.file_name().map(|n| n.to_os_string()) {
        let parent = match current.parent() {
            Some(p) if p != current => p.to_path_buf(),
            _ => break,
        };
        missing.push(name);
        current = parent;
        if let Ok(c) = current.canonicalize() {
            let mut out = c;
            for seg in missing.into_iter().rev() {
                out.push(seg);
            }
            return out;
        }
    }
    path.to_path_buf()
}

fn granted_paths() -> BTreeSet<PathBuf> {
    GRANTED
        .read()
        .ok()
        .and_then(|slot| slot.clone())
        .unwrap_or_default()
}

/// Grant one user-supplied path for this session. Idempotent; canonicalizes
/// so symlink/junction aliases collapse together. Only the exact path is
/// granted — a directory grant also covers its contents.
pub fn grant(path: &Path) {
    if path.as_os_str().is_empty() {
        return;
    }
    let canonical = canonicalize_best_effort(path);
    if let Ok(mut slot) = GRANTED.write() {
        slot.get_or_insert_with(BTreeSet::new).insert(canonical);
    }
}

/// Is `path` (canonicalized) inside any granted root or exactly granted?
pub fn is_granted(path: &Path) -> bool {
    let canonical = canonicalize_best_effort(path);
    for granted in granted_paths() {
        if canonical == granted || canonical.starts_with(&granted) {
            return true;
        }
    }
    false
}

/// Drop all session grants. Used by tests.
pub fn clear_grants() {
    if let Ok(mut slot) = GRANTED.write() {
        *slot = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "folio-sandbox-{tag}-{}-{nanos}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn grants_and_checks_exact_paths_and_parents() {
        let _lock = crate::appdir::lock_app_dir_for_tests();
        clear_grants();
        let dir = temp_dir("grant");
        let existing = dir.join("book.epub");
        fs::write(&existing, b"x").unwrap();

        grant(&existing);
        assert!(is_granted(&existing));
        // Only the exact path is granted: siblings and subpaths of the file's
        // directory are not.
        assert!(!is_granted(&dir.join("other-in-same-dir.txt")));
        assert!(!is_granted(&dir.join("sub").join("deep.txt")));

        // A grant on a not-yet-existing save target covers that exact file.
        let target = temp_dir("save-target").join("out.zip");
        grant(&target);
        assert!(is_granted(&target));
        assert!(!is_granted(&temp_dir("save-target").join("sibling.zip")));

        let _ = fs::remove_dir_all(&dir);
        clear_grants();
    }

    #[test]
    fn canonicalizes_before_checking() {
        let _lock = crate::appdir::lock_app_dir_for_tests();
        clear_grants();
        let dir = temp_dir("canonical");
        fs::write(dir.join("f.txt"), b"x").unwrap();
        grant(&dir);
        // Traversal-style alias of a granted root resolves inside it.
        let alias = dir.join(".").join("f.txt");
        assert!(is_granted(&alias));
        // Non-canonical absolute path never granted.
        assert!(!is_granted(&temp_dir("canonical-other")));
        let _ = fs::remove_dir_all(&dir);
        clear_grants();
    }

    #[test]
    fn empty_grant_is_ignored() {
        let _lock = crate::appdir::lock_app_dir_for_tests();
        clear_grants();
        grant(Path::new(""));
        assert!(granted_paths().is_empty());
        clear_grants();
    }
}
