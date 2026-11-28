# OpenCode prompt — controlled remediation

Read `AGENTS.md`, `quality/TASKS.md`, the issue report, and relevant skill(s). Work ONLY on the selected issue ID(s): [INSERT IDS].

Before editing:
- Verify the issue still reproduces on current HEAD.
- Inspect all callers, state ownership, persistence and lifecycle.
- State the root cause with code evidence.
- Define a minimal fix and regression test.
- Identify data/schema/platform risks.

Implementation:
- Make the smallest cohesive change.
- Preserve public types, stored data, locator formats and backup compatibility unless the issue explicitly requires a reviewed migration.
- Keep EPUB and PDF capability-specific behavior correct.
- Avoid broad redesign, dependency additions and unrelated cleanup.
- Add/update tests that fail before the fix and pass after it.
- Handle cancellation, unmount, stale async results, listener cleanup and errors where relevant.

Verification:
- Run focused tests, relevant suite, typecheck/lint/build using actual package scripts.
- Repeat the exact reproduction on the same fixture/settings.
- Test adjacent regression paths and both formats where applicable.
- Capture before/after screenshots for UI work at identical viewport/theme.
- Update issue status and `TASKS.md`.

Do not claim completion if any check was skipped. Report exact commands, outcomes, files changed, residual risks and manual checks still needed.
