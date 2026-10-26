//! Dictionary pack bridge (06 §5, 02 §2).
//!
//! The pack is a SQLite file produced once by `mobile/tools/build_dict.py`
//! (FreeDict eng-hin, GPL-2.0). Rust only reads it — no Folio data-model logic.
//! Because the tool's table/column names are an implementation detail, we
//! introspect the schema and support the common FreeDict layouts:
//!
//!   entries(headword, pos, meaning, example)
//!   dict(word, definition)                 (etc.)
//!
//! The frontend normalises the headword (src/dict/normalise.ts); Rust also
//! tries the mobile inflection strips in the documented order so a lookup for
//! "running" still finds "run".

use crate::appdir;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const PACK_FILE: &str = "folio-eng-hin.sqlite";
const PACK_DIR: &str = "dict";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DictSense {
    pub pos: Option<String>,
    pub meaning: String,
    pub example: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DictEntry {
    pub headword: String,
    pub pos: Option<String>,
    pub senses: Vec<DictSense>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DictStatus {
    pub installed: bool,
    pub path: String,
    pub entries: Option<i64>,
    pub sha256: Option<String>,
}

pub fn pack_path() -> Option<PathBuf> {
    appdir::app_dir().map(|d| d.join(PACK_DIR).join(PACK_FILE))
}

/// Install a pack from an arbitrary source path (bundled resource or test
/// fixture), verifying the expected sha256 when provided. Atomic replace.
pub fn install_pack(source: &Path, expected_sha256: Option<&str>) -> Result<PathBuf, String> {
    let target = pack_path().ok_or_else(|| "app dir not initialised".to_string())?;
    if !source.is_file() {
        return Err(format!("dictionary source not found: {}", source.display()));
    }
    let actual = sha256_file(source)?;
    if let Some(expected) = expected_sha256 {
        if !actual.eq_ignore_ascii_case(expected.trim()) {
            return Err(format!(
                "dictionary checksum mismatch (expected {expected}, got {actual})"
            ));
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("sqlite.tmp");
    fs::copy(source, &tmp).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(target)
}

/// Copy the bundled pack from `resource_dir/dict/` on first run, verifying
/// `folio-eng-hin.sha256` next to it when present.
pub fn ensure_installed(resource_dir: Option<&Path>) -> Result<bool, String> {
    let Some(target) = pack_path() else {
        return Ok(false);
    };
    if target.is_file() {
        return Ok(false);
    }
    let Some(resource_dir) = resource_dir else {
        return Ok(false);
    };
    let source = resource_dir.join(PACK_DIR).join(PACK_FILE);
    if !source.is_file() {
        return Ok(false);
    }
    let sha_path = source.with_extension("sha256");
    let expected = fs::read_to_string(&sha_path)
        .ok()
        .map(|s| s.split_whitespace().next().unwrap_or("").to_string())
        .filter(|s| !s.is_empty());
    install_pack(&source, expected.as_deref())?;
    Ok(true)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
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

fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("dictionary open failed: {e}"))?;
    Ok(conn)
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn find_table(conn: &Connection) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut tables = Vec::new();
    for name in names {
        tables.push(name.map_err(|e| e.to_string())?);
    }

    // Prefer a table that has a recognisable headword column.
    for table in &tables {
        if columns(conn, table)?.iter().any(|c| is_headword(c)) {
            return Ok(Some(table.clone()));
        }
    }
    Ok(tables.into_iter().next())
}

fn columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", quote_ident(table)))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn is_headword(col: &str) -> bool {
    matches!(
        col.to_ascii_lowercase().as_str(),
        "headword" | "word" | "lemma" | "term" | "entry" | "key" | "head"
    )
}

fn find_col<'a>(cols: &'a [String], names: &[&str]) -> Option<&'a str> {
    let lower: Vec<(String, &'a str)> = cols
        .iter()
        .map(|c| (c.to_ascii_lowercase(), c.as_str()))
        .collect();
    for wanted in names {
        if let Some((_, original)) = lower.iter().find(|(l, _)| l == wanted) {
            return Some(original);
        }
    }
    None
}

/// Mobile `DictionaryNormalizer` order: lowercase, then -s, -es, -ed, -ing,
/// -er, -est strips. Also handles the common `-ies`/`-ied` → `y` forms.
pub fn lookup_candidates(term: &str) -> Vec<String> {
    fn add(out: &mut Vec<String>, s: String) {
        if !s.is_empty() && s.chars().count() >= 2 && !out.contains(&s) {
            out.push(s);
        }
    }

    let base = term
        .trim()
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '\'')
        .to_lowercase();
    if base.is_empty() {
        return Vec::new();
    }
    let mut out = vec![base.clone()];
    if base.ends_with("ies") && base.len() > 4 {
        add(&mut out, format!("{}y", &base[..base.len() - 3]));
    }
    if base.ends_with("ied") && base.len() > 4 {
        add(&mut out, format!("{}y", &base[..base.len() - 3]));
    }
    for suffix in ["s", "es", "ed", "ing", "er", "est"] {
        if base.ends_with(suffix) && base.len() > suffix.len() + 2 {
            add(&mut out, base[..base.len() - suffix.len()].to_string());
        }
    }
    // doubled consonant before -ing/-ed ("running" → "runn" → "run")
    let doubled = out.iter().find_map(|c| {
        let mut chars = c.chars().rev();
        let last = chars.next()?;
        let prev = chars.next()?;
        (last == prev && last.is_ascii_alphabetic()).then(|| c[..c.len() - 1].to_string())
    });
    if let Some(stem) = doubled {
        add(&mut out, stem);
    }
    out
}

fn pick_columns(cols: &[String]) -> Option<(String, Option<String>, String, Option<String>)> {
    let head = find_col(
        cols,
        &["headword", "word", "lemma", "term", "entry", "key", "head"],
    )?;
    let pos = find_col(
        cols,
        &[
            "pos",
            "part_of_speech",
            "partofspeech",
            "part_of_speech_tag",
            "type",
            "tag",
        ],
    );
    let meaning = find_col(
        cols,
        &[
            "meaning",
            "definition",
            "gloss",
            "translation",
            "hindi",
            "sense",
            "body",
            "value",
            "data",
            "definition_en",
            "english",
        ],
    )?;
    let example = find_col(cols, &["example", "example_en", "usage", "sentence"]);
    Some((
        head.to_string(),
        pos.map(str::to_string),
        meaning.to_string(),
        example.map(str::to_string),
    ))
}

fn query_exact(
    conn: &Connection,
    table: &str,
    cols: &(String, Option<String>, String, Option<String>),
    term: &str,
    prefix: bool,
) -> Result<Vec<DictEntry>, String> {
    let (head, pos, meaning, example) = cols;
    let head_expr = format!("CAST({} AS TEXT)", quote_ident(head));
    let pos_expr = pos
        .as_ref()
        .map(|c| format!("CAST({} AS TEXT)", quote_ident(c)))
        .unwrap_or_else(|| "NULL".to_string());
    let example_expr = example
        .as_ref()
        .map(|c| format!("CAST({} AS TEXT)", quote_ident(c)))
        .unwrap_or_else(|| "NULL".to_string());
    let where_clause = if prefix {
        format!("lower({head_expr}) LIKE ?1 || '%'")
    } else {
        format!("lower({head_expr}) = ?1")
    };
    let sql = format!(
        "SELECT {head_expr}, {pos_expr}, CAST({meaning} AS TEXT), {example_expr} \
         FROM {table} \
         WHERE {where_clause} \
         ORDER BY {head_expr} LIMIT 200",
        head_expr = head_expr,
        pos_expr = pos_expr,
        meaning = quote_ident(meaning),
        example_expr = example_expr,
        table = quote_ident(table),
        where_clause = where_clause,
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([term], |row| {
            let headword: Option<String> = row.get(0).ok();
            let pos: Option<String> = row.get(1).ok();
            let meaning: Option<String> = row.get(2).ok();
            let example: Option<String> = row.get(3).ok();
            Ok((headword, pos, meaning, example))
        })
        .map_err(|e| e.to_string())?;

    let mut grouped: BTreeMap<String, DictEntry> = BTreeMap::new();
    for row in rows {
        let (headword, pos, meaning, example) = row.map_err(|e| e.to_string())?;
        let Some(headword) = headword.filter(|h| !h.trim().is_empty()) else {
            continue;
        };
        let Some(meaning) = meaning.filter(|m| !m.trim().is_empty()) else {
            continue;
        };
        let pos = pos.filter(|p| !p.trim().is_empty());
        let entry = grouped
            .entry(headword.clone())
            .or_insert_with(|| DictEntry {
                headword,
                pos: pos.clone(),
                senses: Vec::new(),
            });
        entry.senses.push(DictSense {
            pos,
            meaning: meaning.trim().to_string(),
            example: example.filter(|e| !e.trim().is_empty()),
        });
    }
    Ok(grouped.into_values().collect())
}

/// Look up `term`, trying the normalised form first, then the inflection
/// candidates, exact matches before prefixes.
pub fn query_pack(path: &Path, term: &str) -> Result<Vec<DictEntry>, String> {
    let conn = open_db(path)?;
    let table = find_table(&conn)?.ok_or_else(|| "dictionary pack has no tables".to_string())?;
    let cols = columns(&conn, &table)?;
    let picked = pick_columns(&cols).ok_or_else(|| {
        format!(
            "dictionary pack schema not recognised (table {table}, columns: {})",
            cols.join(", ")
        )
    })?;

    for candidate in lookup_candidates(term) {
        let exact = query_exact(&conn, &table, &picked, &candidate, false)?;
        if !exact.is_empty() {
            return Ok(exact);
        }
        if candidate.chars().count() >= 2 {
            let prefix = query_exact(&conn, &table, &picked, &candidate, true)?;
            if !prefix.is_empty() {
                return Ok(prefix.into_iter().take(10).collect());
            }
        }
    }
    Ok(Vec::new())
}

/// Explicit db path query (kept for parity with the original command surface).
#[tauri::command]
pub fn dict_sqlite_query(db_path: String, query: String) -> Result<Vec<DictEntry>, String> {
    let path = crate::guard::guard_user_path(&db_path).map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("DICTIONARY_MISSING".to_string());
    }
    query_pack(&path, &query)
}

/// Look up a term in the installed pack.
#[tauri::command]
pub fn dict_lookup(term: String) -> Result<Vec<DictEntry>, String> {
    let path = pack_path().ok_or_else(|| "DICTIONARY_MISSING".to_string())?;
    if !path.is_file() {
        return Err("DICTIONARY_MISSING".to_string());
    }
    query_pack(&path, &term)
}

/// Install state for Settings → About and the meaning card.
#[tauri::command]
pub fn dict_status() -> Result<DictStatus, String> {
    let Some(path) = pack_path() else {
        return Ok(DictStatus {
            installed: false,
            path: String::new(),
            entries: None,
            sha256: None,
        });
    };
    let installed = path.is_file();
    let entries = if installed {
        open_db(&path).ok().and_then(|conn| {
            find_table(&conn).ok().flatten().and_then(|t| {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM {}", quote_ident(&t)),
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .ok()
            })
        })
    } else {
        None
    };
    let sha256 = if installed {
        sha256_file(&path).ok()
    } else {
        None
    };
    Ok(DictStatus {
        installed,
        path: path.to_string_lossy().to_string(),
        entries,
        sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_pack(tag: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "folio-dict-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("pack.sqlite");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE entries (headword TEXT, pos TEXT, meaning TEXT, example TEXT);\
             INSERT INTO entries VALUES ('run','verb','दौड़ना','I run daily');\
             INSERT INTO entries VALUES ('run','noun','दौड़',NULL);\
             INSERT INTO entries VALUES ('running','verb','दौड़ता हुआ',NULL);\
             INSERT INTO entries VALUES ('book','noun','किताब',NULL);",
        )
        .unwrap();
        (dir, db)
    }

    #[test]
    fn groups_senses_by_headword() {
        let (dir, db) = temp_pack("senses");
        let out = query_pack(&db, "run").unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].headword, "run");
        assert_eq!(out[0].senses.len(), 2);
        assert_eq!(out[0].senses[0].meaning, "दौड़ना");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn finds_inflected_forms() {
        let (dir, db) = temp_pack("inflect");
        assert_eq!(query_pack(&db, "runs").unwrap()[0].headword, "run");
        assert_eq!(query_pack(&db, "RUNNING").unwrap()[0].headword, "running");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn prefix_fallback_and_empty() {
        let (dir, db) = temp_pack("prefix");
        assert_eq!(query_pack(&db, "boo").unwrap()[0].headword, "book");
        assert!(query_pack(&db, "zzzz").unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn candidates_follow_mobile_order() {
        let c = lookup_candidates(" Running! ");
        assert_eq!(c[0], "running");
        assert!(c.contains(&"runn".to_string()));
        assert!(c.contains(&"run".to_string()));
        assert_eq!(lookup_candidates("stories")[0], "stories");
        assert!(lookup_candidates("stories").contains(&"story".to_string()));
    }

    #[test]
    fn install_verifies_sha() {
        let (dir, db) = temp_pack("install");
        let good = sha256_file(&db).unwrap();
        // Install into the process app dir (set by other tests is racy), so
        // exercise the checksum branch only.
        assert!(install_pack(&db, Some("deadbeef")).is_err());
        assert_eq!(sha256_file(&db).unwrap(), good);
        let _ = fs::remove_dir_all(dir);
    }
}
