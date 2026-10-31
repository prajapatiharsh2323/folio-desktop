# Verification Results

Evidence for completed checks. Record what ran, where it ran, and the outcome;
do not claim unrun checks.

| ID | Date | Scope | Environment | Outcome | Record |
|---|---|---|---|---|---|
| R-20261029-01 | 2026-10-29 | Knowledge-base bootstrap | Linux VM, Node 24, existing `node_modules` | Pass (frontend checks only) | [`R-20261029-01-knowledge-bootstrap.md`](R-20261029-01-knowledge-bootstrap.md) |
| R-20261031-02 | 2026-10-31 | FT-005 perf-harness + method + Linux baseline | Linux/x64, Node 24, jsdom DOMParser | Harness done; budget verdicts pending Windows | [`R-20261031-02-performance-method.md`](R-20261031-02-performance-method.md) (+ `perf-20261031-linux.json`) |

## Convention

Name results `R-YYYYMMDD-NN-<slug>.md`. Include exact commands, working
directory, tool versions, pass/fail counts, warnings, and links to the
implementation/session. Note explicitly when a check was skipped because the
host cannot run it (for example `cargo`/Tauri on Linux).
