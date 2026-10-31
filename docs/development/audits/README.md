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

- `A-UI-YYYYMMDD-NN` — finding ID *inside* an audit report.
- `A-YYYYMMDD-NN` — audit report file (e.g. `A-20261031-01-accessibility.md`).
- `A-BUG-YYYYMMDD-NN` — bug investigation.
- `R-YYYYMMDD-NN` — verification result.

Audits recorded so far: the accessibility core pass
([`A-20261031-01`](ui-ux/A-20261031-01-accessibility.md)) and the perf-budget
harness/method with a Linux baseline
([`R-20261031-02`](results/R-20261031-02-performance-method.md)). Remaining:
the perf runtime measurements on a Windows session (procedure defined in the
R- record) and the unresolved Windows-runtime accessibility items from the
accessibility pass.
