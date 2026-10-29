# Folio Desktop — Development Knowledge Base

This directory is the durable working memory for OpenCode sessions. It is
designed to survive lost conversations, usage-limit interruptions, reinstalls,
and VM destruction. Product/design specifications remain in `.docs/`; this
knowledge base records **how work is progressing, what was decided, and how to
resume**.

## Start here

| If you need… | Read |
|---|---|
| Architecture, commands, invariants, environment gotchas | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) |
| Current priorities, blockers, and statuses | [`TASKS.md`](TASKS.md) |
| Last checkpoint and exact next action | [`CURRENT_SESSION.md`](CURRENT_SESSION.md) |
| A specific past session | [`sessions/`](sessions/README.md) |
| Feature specs and implementation plans | [`plans/`](plans/README.md) |
| UI/UX, bug, and verification reports | [`audits/`](audits/README.md) |
| Why a technical/product choice was made | [`decisions/`](decisions/README.md) |
| Proposed improvements not yet scheduled | [`improvements/`](improvements/README.md) |
| Superseded records | [`archive/`](archive/README.md) |

The root [`AGENTS.md`](../../AGENTS.md) is the mandatory entry point for coding
agents. It defers to this README and `PROJECT_CONTEXT.md` for detail.

## Mandatory operating rules

1. **Read before acting.** Read the root `AGENTS.md`, this README,
   `PROJECT_CONTEXT.md`, `TASKS.md`, and `CURRENT_SESSION.md` before substantial
   work.
2. **Inspect the code first.** Verify paths, behavior, and Git state; do not
   trust old notes or status logs blindly.
3. **Work in verifiable milestones.** Prefer small changes with a clear check
   (typecheck, focused test, build, manual reproduction).
4. **Checkpoint after each meaningful milestone.** Update
   `CURRENT_SESSION.md` with progress, evidence, and the exact next action.
5. **Keep the task board current.** Update `TASKS.md` whenever a task starts,
   becomes blocked, changes priority, or closes.
6. **Record outcomes.** Capture decisions, implementation results, test output,
   blockers, and follow-ups in the appropriate record.
7. **Never wait for a limit to save progress.** Persist state while work is
   green, not after a failure or interruption.
8. **Preserve history.** Append or create new records; archive superseded ones.
   Do not repeatedly overwrite prior reports.
9. **Verify claims.** Re-run the relevant command or inspect the implementation
   before marking work complete.
10. **Protect user work and secrets.** Never discard uncommitted changes, commit
    credentials, or paste tokens/client secrets into docs.
11. **Do not claim remote safety.** Say “pushed” or “backed up” only after the
    command succeeds and the remote is confirmed.
12. **No unauthorized Git operations.** Do not commit, push, change remotes, or
    run destructive commands without explicit approval.

## Recovery procedure

Use this when starting with no prior conversation:

1. Read the root [`AGENTS.md`](../../AGENTS.md).
2. Read this README, [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md),
   [`TASKS.md`](TASKS.md), and [`CURRENT_SESSION.md`](CURRENT_SESSION.md).
3. Inspect Git:
   ```bash
   cd /home/dothp_demo/projects/folio-desktop
   git status --short --branch
   git log --oneline -10
   git diff --stat
   ```
   Treat uncommitted changes as user work until proven otherwise.
4. Open the plans, audits, and session records referenced by the current
   checkpoint and active tasks.
5. Verify the current implementation against those records (read the code, run
   the documented checks). Resolve conflicts in favor of executable sources.
6. Continue from the last **verified** state. Update `CURRENT_SESSION.md` before
   starting a new milestone.

## Checkpoints and temporary VMs

The only durable copy is the Git remote
(`origin` → `github.com/prajapatiharsh2323/folio-desktop`). A process running
only inside a temporary VM cannot preserve work after that VM disappears.

Safe checkpoint sequence (requires explicit user authorization for commit/push):

```bash
cd /home/dothp_demo/projects/folio-desktop
git status --short --branch                 # inspect first
git diff                                    # confirm no secrets or user work
git add <explicit paths>                    # avoid blind `git add -A`
git commit -m "<scoped message>"
git push origin main                        # only after approval
git status --short --branch                 # confirm clean/up to date
git log -1 --oneline                        # record the checkpoint ID
```

Rules:

- Do not commit `.env`, OAuth secrets, tokens, or local machine paths.
- Do not auto-commit, auto-push, rewrite history, or change remotes.
- If no push is authorized, record the exact uncommitted state and next action
  in `CURRENT_SESSION.md`; explain that the work exists only on this VM.
- A backup that runs only inside the VM is not a backup. Any future automation
  must be documented with permissions, frequency, and failure behavior before
  use.

## Structure and identifiers

```
docs/development/
  README.md                  # this file
  PROJECT_CONTEXT.md         # architecture + commands + invariants
  TASKS.md                   # live task board
  CURRENT_SESSION.md         # recovery checkpoint
  sessions/                  # S-YYYYMMDD-NN-<slug>.md
  plans/
    README.md
    features/                # feature specs / intent
    implementations/         # I-YYYYMMDD-NN-<slug>.md
  audits/
    README.md
    ui-ux/                   # UI/UX audit reports
    bugs/                    # bug investigations
    results/                 # R-YYYYMMDD-NN-<slug>.md
  decisions/                 # decision index (D-###)
  improvements/              # improvement backlog (P-###)
  archive/                   # superseded records
```

Identifier conventions:

- `S-YYYYMMDD-NN` — session record.
- `I-YYYYMMDD-NN` — implementation record.
- `A-<area>-YYYYMMDD-NN` — audit finding/report.
- `R-YYYYMMDD-NN` — verification/regression result.
- `D-###` — decision entry.
- `P-###` — improvement proposal.
- Tasks use `FT-###` (feature/task) or `KB-###` (knowledge base).

Use stable IDs in headings and cross-link them. Update the relevant index when
adding a record; do not create a second document for an existing investigation.

## Work lifecycle

```
Audit → Findings → Plan → Implementation → Verification → Closure
```

Record the state of each finding as `fixed`, `unresolved`, `deferred`,
`rejected`, or `superseded`, with the evidence or decision that justifies it.
Keep original reports; add closure notes rather than rewriting history.

## Maintenance

- Keep `CURRENT_SESSION.md` short and current; move narrative detail into a
  session record.
- Keep `TASKS.md` prioritized and limited to active/known work.
- Add an index entry whenever a directory gains a new record.
- Archive records only when they are genuinely superseded, and link the
  replacement.
