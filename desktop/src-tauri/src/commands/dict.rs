#[tauri::command]
pub fn dict_sqlite_query(_db_path: String, _query: String) -> Result<Vec<String>, String> {
    Err("dictionary not implemented (P2)".to_string())
}