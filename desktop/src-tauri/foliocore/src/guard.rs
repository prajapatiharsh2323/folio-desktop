use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GuardError {
    #[error("path must be absolute")]
    NotAbsolute,
    #[error("path traversal detected")]
    Traversal,
    #[error("path is outside the app directory and was not granted this session")]
    OutsideSandbox,
    #[allow(dead_code)]
    #[error("invalid path component")]
    InvalidComponent,
}

/// Normalize and validate a path. Rejects traversal and non-absolute paths.
///
/// Accepts both Windows paths (`C:\a\b`, `\\server\share`) and rooted
/// POSIX-style paths (`/a/b`). The frontend's library paths are virtual
/// (`/folio-library/...`) and are mapped to a real directory before they reach
/// the guard, but the TS path tests also assert the POSIX form, so keep both
/// accepted here for parity.
pub fn normalize_absolute(input: &str) -> Result<PathBuf, GuardError> {
    if input.is_empty() {
        return Err(GuardError::NotAbsolute);
    }
    let p = Path::new(input);
    if !p.is_absolute() && !input.starts_with('/') {
        return Err(GuardError::NotAbsolute);
    }
    // Reject any parent components / traversal.
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir => return Err(GuardError::Traversal),
            std::path::Component::Normal(c) => {
                let s = c.to_string_lossy();
                if s.contains('\0') || s == ".." {
                    return Err(GuardError::Traversal);
                }
            }
            _ => {}
        }
    }
    Ok(p.to_path_buf())
}

#[allow(dead_code)]
/// Resolve the frontend's virtual app-dir prefix, then validate.
pub fn guard_user_path(input: &str) -> Result<PathBuf, GuardError> {
    let resolved = crate::appdir::resolve(input);
    normalize_absolute(&resolved.to_string_lossy())
}

/// Canonicalize a path whose final component may not exist yet (atomic
/// writes, moves). Resolve the deepest existing ancestor through the
/// filesystem — collapsing symlinks, junctions and Windows 8.3 short names —
/// then re-attach the missing tail. This matters because `canonicalize()`
/// expands `C:\Users\RUNNE~1\…` to the long form while `env::temp_dir()` (or
/// any stored path) may still be short: a raw fallback path would never
/// prefix-match its own canonicalized app dir on Windows.
fn canonical_for_check(path: &Path) -> PathBuf {
    strip_verbatim(&crate::sandbox::canonicalize_best_effort(path))
}

/// Windows: `canonicalize()` returns verbatim `\\?\C:\…` (or
/// `\\?\UNC\server\share`) paths, so a `starts_with` against a plain path —
/// or vice versa — always fails and every file lands "outside the app
/// directory". Both sides of the check go through here, so strip the prefix
/// to make the comparison plain-path vs plain-path.
fn strip_verbatim(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.as_os_str().to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest.to_string());
        }
        path.to_path_buf()
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

/// Full confinement check for every file command:
///
/// 1. resolve the virtual `/folio-library` prefix, normalize (absolute, no
///    `..`),
/// 2. canonicalize (resolves symlinks and Windows junctions),
/// 3. accept when the result stays inside the app directory,
/// 4. otherwise accept only when the path was granted this session (a native
///    dialog pick, a drop, or a launch argument),
/// 5. reject everything else.
pub fn guard_sandboxed(input: &str) -> Result<PathBuf, GuardError> {
    let resolved = guard_user_path(input)?;
    let canonical = canonical_for_check(&resolved);
    if let Some(app) = crate::appdir::app_dir() {
        let app_canonical = canonical_for_check(&app);
        if canonical.starts_with(&app_canonical) {
            return Ok(resolved);
        }
    }
    if crate::sandbox::is_granted(&canonical) {
        return Ok(resolved);
    }
    Err(GuardError::OutsideSandbox)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appdir;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("folio-guard-{tag}-{}-{nanos}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn rejects_relative() {
        assert!(normalize_absolute("foo/bar").is_err());
    }

    #[test]
    fn rejects_traversal() {
        assert!(normalize_absolute("/a/../b").is_err());
        assert!(normalize_absolute("/a/..").is_err());
    }

    #[test]
    fn accepts_absolute() {
        assert!(normalize_absolute("/a/b/c").is_ok());
    }

    #[test]
    fn rejects_null() {
        assert!(normalize_absolute("/a/b\0c").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn accepts_windows_absolute() {
        assert!(normalize_absolute(r"C:\a\b").is_ok());
        assert!(normalize_absolute(r"\\server\share\a").is_ok());
        assert!(normalize_absolute(r"C:\a\..\b").is_err());
        assert!(normalize_absolute(r"C:a\b").is_err());
    }

    #[test]
    fn sandbox_keeps_app_dir_contents() {
        let _lock = appdir::lock_app_dir_for_tests();
        let app = temp_dir("app");
        appdir::set_app_dir(app.clone());
        let inside = app.join("library").join("docs").join("x.json");
        let virtual_path = format!("{}/library/docs/x.json", appdir::VIRTUAL_APP_DIR);
        assert_eq!(guard_sandboxed(&virtual_path).unwrap(), inside);
        appdir::set_app_dir(PathBuf::from("/folio-library"));
    }

    #[test]
    fn sandbox_rejects_arbitrary_absolute_paths() {
        let _lock = appdir::lock_app_dir_for_tests();
        let app = temp_dir("app2");
        appdir::set_app_dir(app.clone());
        // A path outside the app dir is rejected unless granted.
        let outside = temp_dir("outside");
        assert!(matches!(
            guard_sandboxed(&outside.to_string_lossy()).unwrap_err(),
            GuardError::OutsideSandbox
        ));
        // …and the virtual root of a *different* app dir too.
        assert!(guard_sandboxed("/folio-library/../../etc/passwd").is_err());
        appdir::set_app_dir(PathBuf::from("/folio-library"));
        let _ = fs::remove_dir_all(&app);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn sandbox_accepts_granted_paths() {
        let _lock = appdir::lock_app_dir_for_tests();
        let app = temp_dir("app3");
        appdir::set_app_dir(app.clone());
        let picked = temp_dir("picked").join("book.epub");
        fs::write(&picked, b"x").unwrap();
        crate::sandbox::grant(&picked);
        assert!(guard_sandboxed(&picked.to_string_lossy()).is_ok());
        // A sibling of the granted file is NOT granted (exact-path grants).
        let sibling = picked.with_file_name("other.epub");
        assert!(matches!(
            guard_sandboxed(&sibling.to_string_lossy()).unwrap_err(),
            GuardError::OutsideSandbox
        ));
        // A deeper path outside any granted root stays rejected.
        let unrelated = temp_dir("unrelated").join("x.txt");
        assert!(matches!(
            guard_sandboxed(&unrelated.to_string_lossy()).unwrap_err(),
            GuardError::OutsideSandbox
        ));
        crate::sandbox::clear_grants();
        appdir::set_app_dir(PathBuf::from("/folio-library"));
        let _ = fs::remove_dir_all(&app);
        let _ = fs::remove_dir_all(&picked.parent().unwrap());
        let _ = fs::remove_dir_all(unrelated.parent().unwrap());
    }

    #[test]
    fn sandbox_resolves_symlink_alias_outside_the_root() {
        let _lock = appdir::lock_app_dir_for_tests();
        let app = temp_dir("app4");
        let outside = temp_dir("outside4");
        fs::write(outside.join("secret.txt"), b"x").unwrap();
        #[cfg(unix)]
        {
            // The virtual scheme maps `/folio-library/library/...` to
            // `<app>/library/...` — mirror that layout, then symlink a dir
            // inside it to a location outside the app dir.
            fs::create_dir_all(app.join("library")).unwrap();
            let link = app.join("library").join("link");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            appdir::set_app_dir(app.clone());
            // The virtual path is normalized inside the app dir, but the
            // canonical target escapes through the symlink into `outside`.
            let virtual_path = format!("{}/library/link/secret.txt", appdir::VIRTUAL_APP_DIR);
            assert!(matches!(
                guard_sandboxed(&virtual_path).unwrap_err(),
                GuardError::OutsideSandbox
            ));
            // The symlink itself is unusable even when the target file name
            // does not exist (dangling through a symlinked directory).
            let dangling = format!("{}/library/link/nothing.txt", appdir::VIRTUAL_APP_DIR);
            assert!(matches!(
                guard_sandboxed(&dangling).unwrap_err(),
                GuardError::OutsideSandbox
            ));
        }
        appdir::set_app_dir(PathBuf::from("/folio-library"));
        let _ = fs::remove_dir_all(&app);
        let _ = fs::remove_dir_all(&outside);
    }
}
