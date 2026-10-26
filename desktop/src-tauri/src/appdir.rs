//! App-data directory resolution and the frontend's virtual path scheme.
//!
//! The TS layer builds every library path from a single virtual root
//! (`/folio-library`) so that the data model stays platform-neutral and the
//! Rust core never hard-codes Folio layout knowledge. At the OS boundary we
//! translate that virtual prefix to the real `%APPDATA%/Folio` directory
//! (02 §4: default app dir `%APPDATA%/Folio`, library under `library/`).

use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// Virtual root used by the TypeScript layer.
pub const VIRTUAL_APP_DIR: &str = "/folio-library";

static APP_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);

/// Resolve the default app dir. Tauri gives us
/// `%APPDATA%/<bundle-identifier>`; walk one level up and use `Folio` so the
/// on-disk layout matches the mobile/desktop spec exactly.
pub fn default_app_dir(tauri_app_data: Option<PathBuf>) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(base) = tauri_app_data {
            if let Some(roaming) = base.parent() {
                return roaming.join("Folio");
            }
            return base;
        }
    }
    tauri_app_data.unwrap_or_else(|| PathBuf::from(VIRTUAL_APP_DIR))
}

/// Install the process-wide app dir (called once from `setup`).
pub fn set_app_dir(dir: PathBuf) {
    if let Ok(mut slot) = APP_DIR.write() {
        *slot = Some(dir);
    }
}

pub fn app_dir() -> Option<PathBuf> {
    APP_DIR.read().ok().and_then(|slot| slot.clone())
}

/// Translate the virtual app dir prefix into the real app dir.
///
/// Paths that do not start with the virtual root (native dialog picks, UNC
/// paths, `C:\...`) pass through untouched.
pub fn resolve(input: &str) -> PathBuf {
    resolve_with_base(input, app_dir().as_deref())
}

/// Pure form of [`resolve`] used by unit tests.
pub fn resolve_with_base(input: &str, base: Option<&Path>) -> PathBuf {
    if let Some(base) = base {
        if let Some(rest) = input.strip_prefix(VIRTUAL_APP_DIR) {
            let boundary = rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\');
            if boundary {
                let mut out = base.to_path_buf();
                for seg in rest
                    .split(['/', '\\'])
                    .filter(|s| !s.is_empty() && *s != ".")
                {
                    out.push(seg);
                }
                return out;
            }
        }
    }
    PathBuf::from(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_virtual_prefix() {
        let dir = Path::new("/tmp/folio-app");
        let mapped = resolve_with_base("/folio-library/library/manifest.json", Some(dir));
        assert_eq!(mapped, dir.join("library").join("manifest.json"));
    }

    #[test]
    fn leaves_native_paths_alone() {
        let dir = Path::new("/tmp/folio-app");
        let p = resolve_with_base(r"C:\Users\reader\book.epub", Some(dir));
        assert_eq!(p, PathBuf::from(r"C:\Users\reader\book.epub"));
        // `.../folio-library-extra` must not be treated as the virtual root.
        let q = resolve_with_base("/folio-library-extra/file", Some(dir));
        assert_eq!(q, PathBuf::from("/folio-library-extra/file"));
    }

    #[test]
    fn maps_root() {
        let dir = Path::new("/tmp/folio-app");
        assert_eq!(resolve_with_base("/folio-library", Some(dir)), dir);
    }
}
