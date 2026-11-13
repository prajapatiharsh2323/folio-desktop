//! Folio's platform-neutral security and path core: app-dir resolution, the
//! virtual `/folio-library` scheme, the path guard and the session sandbox.
//! Pure Rust — no Tauri, no OS GUI deps — so the security tests run on any
//! host (the full Tauri crate is Windows-only at build time).

pub mod appdir;
pub mod guard;
pub mod sandbox;
