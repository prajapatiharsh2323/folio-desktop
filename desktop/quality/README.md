# Quality workspace

## Files
- `analysis/INITIAL-ARCHITECTURE.md` — source-export-derived map.
- `analysis/INITIAL-RISK-REGISTER.md` — hypotheses to validate.
- `analysis/AUDIT-MATRIX.md` — full-system audit coverage.
- `plans/REMEDIATION-ROADMAP.md` — staged execution.
- `reports/BASELINE-AUDIT.md` — full baseline audit narrative and feature-flow map.
- `reports/ISSUE-REGISTER.md` — confirmed and suspected issues.
- `reports/BASELINE.md` — commands and baseline results.
- `reports/issues/*.md` — detailed confirmed issue reports (template format).
- `reports/SUSPECTED-RISKS.md` — probable/unverified hypotheses with confirming tests.
- `reports/TEST-MATRIX.md` — filled regression matrix and batch verification commands.
- `TASKS.md` — current work queue and session handoff.
- `templates/ISSUE-TEMPLATE.md` — issue format.
- `templates/TEST-MATRIX.md` — regression matrix.
- `prompts/` — copy/paste OpenCode prompts.

## Severity
- **P0 Critical:** data loss/corruption, app cannot launch, unrecoverable library failure, security boundary failure.
- **P1 High:** core reading/import/navigation/annotation/resume broken for a meaningful user path.
- **P2 Medium:** significant UX inconsistency, frequent workflow failure, rendering defect with workaround.
- **P3 Low:** minor visual, copy, or edge-case issue.

## Confidence
- **Confirmed:** reproduced or demonstrated by a reliable test.
- **Probable:** strong code evidence, but not yet reproduced.
- **Unverified:** plausible risk requiring investigation.

Keep confidence separate from severity.
