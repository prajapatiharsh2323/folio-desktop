# Bug Investigations

Index of bug investigations.

| ID | Date | Area | Status | Report |
|---|---|---|---|---|
| A-BUG-20261031-01 | 2026-10-31 | Jump-list `PKEY_Title` PROPVARIANT — startup heap corruption | fixed | [`A-BUG-20261031-01-jumplist-startup-crash.md`](A-BUG-20261031-01-jumplist-startup-crash.md) |

## Convention

Name reports `A-BUG-YYYYMMDD-NN-<slug>.md` and include:

- reproduction steps and environment;
- expected vs actual behavior;
- root cause or current hypothesis;
- affected files/invariants (schema-1, manifest ordering, sync, paths);
- fix plan and verification result;
- final status: `fixed`, `unresolved`, `deferred`, `rejected`, or `superseded`.

Link the fixing implementation record and the verifying result. If the bug
touches schema-1 data or sync, read `.docs/05` before changing code.
