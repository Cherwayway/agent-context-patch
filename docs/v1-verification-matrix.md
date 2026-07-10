# V1 Verification Matrix

This matrix maps the accepted decisions in
`docs/adr/0001-agent-first-context-evolution.md` to durable repository evidence.
It distinguishes executable guarantees from semantic Agent responsibilities so
future changes do not turn documentation claims into untested promises.

| Decision | V1 contract | Durable evidence |
|---|---|---|
| Agent-first architecture | Agents decide meaning; the kernel commits exact plans only. | `skills/evolve/SKILL.md`, `skills/evolve/runtime/index.mjs`, kernel behavior tests |
| Scope | Workspace is the only active write scope; user-global is a sanitized, approved handoff. | proposal fixtures and validator; `references/protocol-v1.md` |
| Write policy | Only `propose` and `auto`; auto requires one complete live v1 config, explicit opt-in, and enabled-domain targets. | shared production config validator; config fixtures; kernel live-config, domain, target, risk, health, and approval tests |
| Approval lifecycle | One public `$evolve approve`; authorization binds a complete persisted PatchPlan, including its semantic operation, to the exact external `planHash`. | recomputed proposal/Decision/Attempt field, lifecycle, and hash tests; exact/mismatched approval kernel tests |
| Installation | Agent resolves semantics; Bootstrap plans deterministic files, validates the complete config envelope without Node, and never edits instructions. | shared PowerShell/Bash invalid/valid config, dry-run/apply/idempotency, and guidance-preservation tests |
| Runtime capability | Bootstrap and propose do not require Node; auto uses the Node kernel or explicitly downgrades. | native installer adapters; skill policy output contract |
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
not enter `planHash`. The Agent records approval before calling the kernel and
persists the returned content-free ApplyAttempt afterward. An audit writeback
failure is reported as `audit_write_pending` and retried; it never creates a
second receipt source of truth.

## Required gate

Run:

```text
npm test
```

The same command runs on Windows and Ubuntu. Before release, also inspect the
actual diff, run `git diff --check`, and exercise the Bash apply path on a Unix
environment when it was not executed by the local test job.
