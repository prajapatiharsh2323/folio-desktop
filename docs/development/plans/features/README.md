# Feature Specifications

The canonical product and design specifications live in [`.docs/`](../../../../.docs/README.md).
This index maps them to implementation areas; it intentionally does not restate
their content.

## Spec index

| ID | Document | Purpose |
|---|---|---|
| SPEC-01 | [Overview and scope](../../../../.docs/01-overview-and-scope.md) | Goals, non-goals, parity matrix |
| SPEC-02 | [Architecture and stack](../../../../.docs/02-architecture-and-stack.md) | Process split, Rust commands, FileStore, storage, import, tests |
| SPEC-03 | [UI/UX spec](../../../../.docs/03-ui-ux-spec.md) | Tokens, layouts, motion, accessibility |
| SPEC-04 | [Reader spec](../../../../.docs/04-reader-spec.md) | Engine, themes, annotations, progress, performance |
| SPEC-05 | [Data model and compatibility](../../../../.docs/05-data-model-and-compat.md) | Schema-1 types, invariants, backup, Drive contract |
| SPEC-06 | [Features and functional spec](../../../../.docs/06-features-functional-spec.md) | Library, collections, notes, settings, search, dictionary |
| SPEC-07 | [Keyboard and input](../../../../.docs/07-keyboard-and-input.md) | Global/reader/library key maps |
| SPEC-08 | [Prompt pack](../../../../.docs/08-vibe-coding-prompt-pack.md) | Historical phased build prompts |
| SPEC-09 | [Platform decisions](../../../../.docs/09-platform-decisions.md) | OAuth, storage, updates, CI, security, open items |

## Feature-to-code map

| Area | Spec | Main code | Status |
|---|---|---|---|
| Design system + shell | SPEC-03 | `desktop/src/styles/`, `src/components/`, `src/shell/` | Implemented |
| Data model + stores | SPEC-02, SPEC-05 | `src/model/`, `src/store/`, `src/lib/` | Implemented |
| Import pipeline | SPEC-02, SPEC-06 | `src/import/` | Implemented |
| Reader | SPEC-04 | `src/reader/`, `src/screens/ReaderScreen.tsx` | Implemented |
| Annotations + notes | SPEC-04, SPEC-06 | `src/components/`, `src/screens/NotesScreen.tsx` | Implemented |
| Search | SPEC-06 | `src/search/` | Implemented |
| Collections | SPEC-06 | `src/screens/CollectionsScreen.tsx`, `src/store/` | Implemented |
| Settings + backup | SPEC-06 | `src/screens/SettingsScreen.tsx` | Implemented |
| Drive sync | SPEC-05 §6, SPEC-09 | `src/sync/`, `src-tauri/src/oauth.rs` | Implemented; E2E blocked (FT-003) |
| Dictionary | SPEC-06 §5 | `src/dict/`, `src-tauri/src/commands/dict.rs` | Implemented; pack asset missing (FT-004) |
| Platform integration | SPEC-07, SPEC-09 | `src-tauri/`, `src/lib/` | Mostly done; jump list open (FT-001) |

Open work and blockers are tracked in [`../../TASKS.md`](../../TASKS.md).
