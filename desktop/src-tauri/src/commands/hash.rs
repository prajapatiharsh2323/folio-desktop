use crate::guard::normalize_absolute;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;

#[tauri::command]
pub fn sha256_file(path: String) -> Result<String, String> {
    let p = normalize_absolute(&path).map_err(|e| e.to_string())?;
    let mut file = File::open(&p).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}