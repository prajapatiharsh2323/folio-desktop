use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GuardError {
    #[error("path must be absolute")]
    NotAbsolute,
    #[error("path traversal detected")]
    Traversal,
    #[error("invalid path component")]
    InvalidComponent,
}

/// Normalize and validate a path. Rejects traversal and non-absolute paths.
pub fn normalize_absolute(input: &str) -> Result<PathBuf, GuardError> {
    if input.is_empty() {
        return Err(GuardError::NotAbsolute);
    }
    let p = Path::new(input);
    if !p.is_absolute() {
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
}
