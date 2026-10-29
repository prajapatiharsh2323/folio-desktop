# Audits and Verification

| Directory | Use |
|---|---|
| [`ui-ux/`](ui-ux/README.md) | UI/UX and accessibility audit reports |
| [`bugs/`](bugs/README.md) | Bug investigations and root-cause findings |
| [`results/`](results/README.md) | Verification and regression results |

## Lifecycle

```
Audit → Findings → Plan → Implementation → Verification → Closure
```

Each finding gets a stable ID and a status: `fixed`, `unresolved`, `deferred`,
`rejected`, or `superseded`. Link the implementing plan/record and the verifying
result. Preserve the original report and add a closure note instead of rewriting
history.

IDs:

- `A-UI-YYYYMMDD-NN` — UI/UX finding.
- `A-BUG-YYYYMMDD-NN` — bug investigation.
- `R-YYYYMMDD-NN` — verification result.

No audit findings have been recorded yet. The open audit tasks are FT-005
(performance) and FT-006 (accessibility) in [`../TASKS.md`](../TASKS.md).
