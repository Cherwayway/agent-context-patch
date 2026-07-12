# Iteration Standard

This project iterates to reduce repeated Agent failures and context waste
without weakening write-authority, privacy, or recovery guarantees. Feature
count and context size are not success metrics.

## The loop

1. Observe a privacy-minimized Feedback Signal from real use.
2. Reproduce it or establish that its impact justifies immediate action.
3. Find the earliest broken stage in the product loop.
4. State one small improvement hypothesis and its expected observable result.
5. Implement and verify the smallest change that can test that hypothesis.
6. Publish an immutable Release and observe whether the signal improves.
7. Keep, revise, or revert the change from fresh evidence.

Feedback is collected deliberately through the repository issue form. The kit
does not collect behavioral telemetry, conversations, source code, full logs,
or workspace paths.

## When work enters an iteration

| Signal | Minimum evidence | Response |
| --- | --- | --- |
| Write-authority bypass, privacy exposure, data loss, or failed rollback | One credible case | Stop affected writes and prepare a focused fix immediately. |
| A reproducible failure in install, init, propose, approve, apply, update, or migrate | One reproducible case | Fix the broken core path before adding capability. |
| Rejected or heavily rewritten proposals, repeated mistakes after an applied patch, or persistent context waste | Two independent workspaces or three recurrences | Test a semantic or context-placement improvement. |
| New domain, adapter, or convenience feature | Two concrete workspace needs | Keep it experimental until the common need is demonstrated. |
| An idea without an observed use case | No evidence | Record it outside the committed roadmap; do not expand the core yet. |

A security or privacy fix may ship before broad reproduction, but it must gain a
targeted regression test. New core abstractions require evidence from more than
one workspace.

## Choosing the direction

Improve the earliest stage that is failing:

1. **Discovery and upgrade**: users cannot reach a known-good Kit Version.
2. **Capture**: the Agent misses a reusable lesson or drafts poor proposals.
3. **Commit**: a valid authorized plan cannot be applied safely.
4. **Reuse**: a fresh task repeats a lesson that was already applied.
5. **Context health**: reuse works, but conflict, staleness, or noise grows.
6. **Expansion**: only after the preceding stages hold across real workspaces.

If several stages fail, fix the earliest one first. Prefer replacement,
simplification, and removal before adding a new command, state, or module.

## Change contract

Every product iteration must record, in an issue or pull request:

- the Feedback Signal and a sanitized reproduction;
- the primary hypothesis and observable success condition;
- the smallest intended change and explicit non-goals;
- affected safety, privacy, compatibility, and rollback boundaries;
- the verification performed; and
- the target Kit Version and release note.

Use lightweight gates proportional to the change:

- Mechanical changes run the repository verification suite.
- Semantic changes add a fresh-context positive case and a case that should not
  become durable context.
- Upgrade changes prove prior stable version to candidate, failed replacement
  to rollback, and a second run with no unintended changes.
- Workspace Schema changes use a separately approved migration path and exact
  backups.

Where practical, one Release should test one primary product hypothesis. A
release cadence never overrides evidence or safety.

## Monitoring the result

During active development, maintainers review new Feedback Signals at least
once per week and after every Release. Record whether the original outcome was
fixed, unchanged, regressed, or still unknown. Reopen the hypothesis when a
fresh task repeats the failure; revert or disable a change when it creates a
write-authority, privacy, corruption, or recovery regression.

The iteration is validated only when the intended outcome improves in fresh
use. Shipping code or increasing proposal acceptance alone is not proof.
