# Audits and Verification

| Directory                       | Use                                        |
| ------------------------------- | ------------------------------------------ |
| [`ui-ux/`](ui-ux/README.md)     | UI/UX and accessibility audit reports      |
| [`bugs/`](bugs/README.md)       | Bug investigations and root-cause findings |
| [`results/`](results/README.md) | Verification and regression results        |

## Lifecycle

```
Audit → Findings → Plan → Implementation → Verification → Closure
```

Each finding gets a stable ID and a status: `fixed`, `unresolved`, `deferred`,
`rejected`, or `superseded`. Link the implementing plan/record and the verifying
result. Preserve the original report and add a closure note instead of rewriting
history.

IDs:

- `A-UI-YYYYMMDD-NN` — finding ID _inside_ an audit report.
- `A-YYYYMMDD-NN` — audit report file (e.g. `A-20261031-01-accessibility.md`).
- `A-BUG-YYYYMMDD-NN` — bug investigation.
- `R-YYYYMMDD-NN` — verification result.

Audits recorded so far: the accessibility core pass
([`A-20261031-01`](ui-ux/A-20261031-01-accessibility.md)), the perf-budget
harness/method with a Linux baseline
([`R-20261031-02`](results/R-20261031-02-performance-method.md)), the
Windows 11 production gate + NSIS build
([`R-20261120-01`](results/R-20261120-01-windows-production-build.md)), and
the reader-upgrade Windows gate with the jump-list probe and WebDriver smoke
([`R-20261122-01`](results/R-20261122-01-windows-gate-reader-upgrade.md)), and
the FT-062 Windows gate + latest NSIS build
([`R-20261122-02`](results/R-20261122-02-windows-gate-ft062.md)).
Remaining: the in-webview perf runtime measurements on a desktop session
(procedure defined in the R- record), the unresolved Windows-runtime
accessibility items from the accessibility pass, and the updater runbook
(the WebDriver smoke now covers the import → read → resume half).
