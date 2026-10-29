# Improvements and Backlog

Proposals that are not yet scheduled as tasks. Promote an item to
[`../TASKS.md`](../TASKS.md) when it is accepted for active work.

| ID | Proposal | Status | Notes |
|---|---|---|---|
| P-001 | Manual, explicitly authorized Git checkpoints to the existing remote | adopted as policy 2026-10-29 | See [`../README.md`](../README.md#checkpoints-and-temporary-vms). No automation. |
| P-002 | Reproducible toolchain bootstrap for temporary VMs | proposed | Document/install the pinned Node/pnpm/Rust versions and verify the Linux-safe checks before work starts. Must not assume `pnpm` exists. |
| P-003 | Off-VM automated checkpoint | proposed; not implemented | Requires a user-owned runner or CI job outside the VM. Any implementation must define write permissions, frequency, branch/ref behavior, secret handling, and failure/loud-notification behavior. A job running only inside the VM does not satisfy durability. |

## Promotion rule

Before adding a proposal, check `.docs/09` §10 and `REMAINING.md`; do not
duplicate an existing open item. Include the problem, proposed change, risk, and
verification approach. Do not implement P-003 without explicit authorization.
