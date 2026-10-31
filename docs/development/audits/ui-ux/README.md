# UI/UX Audits

Index of UI/UX and accessibility audits.

| ID | Date | Scope | Status | Report |
|---|---|---|---|---|
| A-20261031-01 | 2026-10-31 | Accessibility (FT-006): contrast, ARIA, focus, targets | Core pass done — 3 findings fixed (`A-UI-20261031-01…03`), 2 unresolved (Windows runtime), 1 spec note | [`A-20261031-01-accessibility.md`](A-20261031-01-accessibility.md) |

Open scopes: keyboard reachability via a screen reader and the reader-specific
target/OS-scaling checks (need a Windows session; tracked in
[`A-20261031-01`](A-20261031-01-accessibility.md)). Contrast is enforced
continuously by `desktop/tests/contrast.test.ts`.

Planned scope for FT-005 (`.docs/04` §12): cold open ≤ 1.2 s, page turn ≤ 80 ms,
200 highlights ≤ 400 ms.

Record results as `A-YYYYMMDD-NN-<slug>.md` (finding IDs
`A-UI-YYYYMMDD-NN` inside), link the affected task IDs, and
state the environment/build used (Windows build vs Linux frontend-only). Do not
record an audit as passed unless it actually ran on the intended platform.
