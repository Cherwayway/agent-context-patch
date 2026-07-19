# V1 Verification Matrix

This matrix maps the accepted decisions in
`docs/adr/0001-agent-first-context-evolution.md` and
`docs/adr/0003-auto-first-low-risk-context.md`, plus the lifecycle extension in
`docs/adr/0004-lifecycle-reconciliation-around-commit-kernel.md`, to durable
repository evidence.
It distinguishes executable guarantees from semantic Agent responsibilities so
future changes do not turn documentation claims into untested promises.

| Decision | V1 contract | Durable evidence |
|---|---|---|
| Agent-first architecture | Agents decide meaning; the kernel commits exact plans only. | `skills/evolve/SKILL.md`, `skills/evolve/runtime/index.mjs`, kernel behavior tests |
| Scope | Workspace is the only active write scope; user-global is a sanitized, approved handoff. | proposal fixtures and validator; `references/protocol-v1.md` |
| Write policy | Only `propose` and `auto`; new workspaces default to auto, existing config is preserved, and every automatic write still requires one complete live v1 config plus all target, domain, risk, health, and privacy gates. | default-policy contract; shared production config validator; installer preservation tests; kernel live-config and auto-gate tests |
| Approval lifecycle | Eligible auto plans complete in the current Agent turn with a `policy_auto` Decision and one non-blocking receipt. `$evolve approve` handles exceptions and binds a complete persisted PatchPlan, including its semantic operation, to the exact external `planHash`. | auto-default Kernel outcome; applied `policy_auto` demo aggregate; fresh-Agent acceptance record; recomputed proposal/Decision/Attempt and exact-approval tests |
| Lifecycle reconciliation | Unfinished exact auto or approved plans resume only from all-before state; all-after without an applied audit, mixed state, and semantic target drift fail closed. A never-applied stale approval terminates only after a recognized conflict and a valid named replacement exists. | production proposal validator; lifecycle coordinator and target-inspection behavior tests; lock, idempotency, stale replacement, and content-safe result assertions |
| Installation | Agent resolves semantics; Bootstrap plans deterministic files, validates the complete config envelope without Node, and never edits instructions. | shared PowerShell/Bash invalid/valid config, dry-run/apply/idempotency, and guidance-preservation tests |
| Runtime capability | Bootstrap and propose do not require Node; the default auto path uses the Node kernel or explicitly downgrades with one blocking reason. | native installer adapters; skill and adapter auto-default contract; kernel tests |
| Migration | Legacy context is read-only until a reviewed migration creates byte-identical backups and applies exact v1 updates; future schemas remain read-only. | legacy, invalid, missing-config, and future-schema tests; approved backup-and-migrate plus missing-backup kernel tests |
| Domain activation | Detection is temporary; `config.enabled_domains` is the only activation truth. | empty template checklist contract; config validator; enabled coding demo |
| Context health | Replace before add; numbers schedule review and block auto but never choose content to delete. | budget fixtures; cleanup/context-budget references; kernel health gate |
| Information topology | One proposal owns evidence, decisions, and attempts but is never a kernel target; reports are derived; archive is inactive and create-only. | proposal target rejection; complete terminal-state validator; archive-update rejection; template topology test; no mistake/receipt stores |
| Placement | Skill/kernel default user-level; context/guidance workspace-local; global trigger opt-in. | install guide, adapters, and skill-target installer tests |
| Evidence privacy | Evidence is pointer-first and summary-first; secrets, full logs, customer data, and user-home paths are prohibited. | config/proposal privacy contracts; kernel credential, key, and path tests |

## Semantic review boundaries

The test suite deliberately does not encode project meaning. A capable Agent
must still judge reuse value, evidence authority, semantic overlap, retention
value, domain fit, wording, and whether a user-global candidate is sufficiently
generalized. These decisions remain reviewable in the proposal aggregate.

Proposal audit is also an explicit boundary: Decision Log and Apply Attempts do
not enter `planHash`. The Agent or Lifecycle Coordinator records either
`policy_auto` or exact approval before calling the kernel and persists the
returned content-free ApplyAttempt afterward. An audit writeback failure is
reported as `audit_write_pending`; a later all-after state becomes explicit
audit recovery rather than inferred application. Neither path creates a second
receipt source of truth.

## Required gate

Run:

```text
npm test
```

The same command runs on Windows and Ubuntu. Before release, also inspect the
actual diff, run `git diff --check`, and exercise the Bash apply path on a Unix
environment when it was not executed by the local test job.
