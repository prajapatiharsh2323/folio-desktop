use crate::guard::normalize_absolute;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ZipEntry {
    pub name: String,
    pub data: Vec<u8>,
}

#[tauri::command]
pub fn zip_read(path: String) -> Result<Vec<ZipEntry>, String> {
    let p = normalize_absolute(&path).map_err(|e| e.to_string())?;
    let file = File::open(&p).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        out.push(ZipEntry { name, data });
    }
    Ok(out)
}

#[tauri::command]
pub fn zip_write(path: String, entries: Vec<ZipEntry>) -> Result<(), String> {
    let p = normalize_absolute(&path).map_err(|e| e.to_string())?;
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