# Decisions

Important technical and product decisions, with pointers to their authoritative
source. This is an index, not a second copy of the specs.

| ID | Decision | Status | Source |
|---|---|---|---|
| D-001 | Tauri 2 shell + TypeScript/React frontend; NSIS installer on Windows | locked | `.docs/02` §1, `.docs/09` §1 |
| D-002 | Readium web toolkit is the reader engine | locked | `.docs/02` §1, `desktop/src/reader/` |
| D-003 | Full schema-1 data compatibility with the Android app; field names/enums frozen | locked | `.docs/05` §1–§4, `desktop/src/model/types.ts` |
| D-004 | Rust is a thin OS bridge; TypeScript owns Folio layout and data model | locked | `.docs/02` §2, `desktop/src/lib/libraryPaths.ts`, `src-tauri/src/appdir.rs` |
| D-005 | Plain JSON files through `FileStore`; no application database | locked | `.docs/02` §4, `desktop/src/lib/fileStore.ts` |
| D-006 | Drive sync is newest-wins with per-id merges; deletions never propagate; manifest last | locked | `.docs/05` §6, `desktop/src/sync/` |
| D-007 | No telemetry/analytics; restricted CSP; Drive REST is the only network use | locked | `.docs/09` §8, `desktop/src-tauri/tauri.conf.json` |
| D-008 | Product/design specs stay in `.docs/`; execution history lives in `docs/development/` | adopted 2026-10-29 | [I-20261029-01](../plans/implementations/I-20261029-01-development-knowledge-system.md) |
| D-009 | Backups are v2, validated before mutation, replaced via staged swap + rollback; merge is document-aware, never path-aware | adopted 2026-10-30 | [D-20261030-01](D-20261030-01-backup-restore-transaction.md) |

## Adding a decision

Create `D-###-<slug>.md` only when the decision is not already captured in
`.docs/`. Include context, decision, alternatives considered, consequences, and
links to affected tasks/records. Add a row above. If a decision supersedes an
earlier one, keep the old row and mark it `superseded by D-###`; move the old
record to [`../archive/`](../archive/README.md) only when appropriate.

Product-level decisions should still be reflected in `.docs/` rather than living
only here.
