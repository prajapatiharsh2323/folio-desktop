# OpenCode prompt — baseline audit (read-only)

You are the senior engineer responsible for auditing Folio, a desktop EPUB/PDF reading application. Read `AGENTS.md`, `quality/README.md`, and the relevant `.opencode/skills/*/SKILL.md` files first.

Perform a READ-ONLY baseline audit. Do not modify application source, dependencies, lockfiles, settings, user data, or generated artifacts.

1. Inspect the actual repository and compare it with `quality/analysis/INITIAL-ARCHITECTURE.md` and the supplied project export if present.
2. Identify exact package scripts, framework/library versions, Tauri commands/capabilities, test infrastructure and build targets.
3. Map route → screen → state/store → repository/native command → rendering flow for each major feature.
4. Trace reader lifecycle for EPUB and PDF independently: open, progress, navigation, resume, close/destroy, event subscriptions, cancellation.
5. Trace persistence for documents, metadata, progress, annotations, preferences, reading log, collections and backup/restore.
6. Audit overlay/focus/keyboard ownership and the shared visual primitives/tokens.
7. Run safe read-only checks and existing tests using commands discovered from package scripts. Do not run destructive restore/delete/import tests against real user data.
8. Use the audit matrix. Reproduce issues in a disposable test profile and synthetic fixtures.
9. Create evidence-backed entries in `quality/reports/ISSUE-REGISTER.md`; update `BASELINE.md`, `TASKS.md`, and add detailed issue reports as needed.

For every finding include severity, confidence, exact reproduction, expected/actual, source locations, evidence and proposed regression test. Label unverified hypotheses clearly. Do not call a code smell a user-facing bug. Do not fix anything in this phase.

At the end provide:
- architecture and feature-flow map;
- exact baseline command/results;
- confirmed defects ranked P0→P3;
- suspected risks separately;
- missing tests and blind spots;
- next 3 smallest safe tasks.
