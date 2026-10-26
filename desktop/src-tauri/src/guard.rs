use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GuardError {
    #[error("path must be absolute")]
    NotAbsolute,
    #[error("path traversal detected")]
    Traversal,
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
pub fn ensure_no_escape(root: Option<&Path>, target: &Path) -> Result<(), GuardError> {
    if let Some(r) = root {
        // Best-effort: target must start with canonicalized root.
        if let (Ok(rc), Ok(tc)) = (r.canonicalize(), target.canonicalize()) {
            if !tc.starts_with(&rc) {
                return Err(GuardError::Traversal);
            }
        }
    }
    Ok(())
}

/// Resolve the frontend's virtual app-dir prefix, then validate.
pub fn guard_user_path(input: &str) -> Result<PathBuf, GuardError> {
    let resolved = crate::appdir::resolve(input);
    normalize_absolute(&resolved.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
