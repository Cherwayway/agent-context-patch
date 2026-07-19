# ADR-0005: Observable Evolution Outcomes at delivery

- Status: accepted
- Date: 2026-07-19
- Decision owners: repository maintainer and user
- Extends: ADR-0001, ADR-0003, and ADR-0004

## Context

Auto-first application and lifecycle reconciliation made context evolution
mechanically safe, but an Agent could still finish a repaired task without one
consistent user-facing answer to three questions:

1. Was a reusable candidate detected?
2. Did that candidate become a valid proposal?
3. Did the proposal actually apply, require approval, or block?

Hand-written adapter receipts could drift, omit a stage, expose semantic or
private detail, or claim success before proposal audit completed. Adding a
durable receipt store would duplicate proposal truth, while asking
deterministic code to decide lesson meaning would violate the Agent-first
boundary.

## Decision

### 1. Add one separate Evolution Outcome module

`skills/evolve/runtime/outcome.mjs` exposes one Agent-facing Interface:

~~~text
finalizeEvolutionOutcome({ detect, propose, proposalId?, reconciliation? })
~~~

The Agent supplies semantic detection and proposal results. The existing
Lifecycle Coordinator result supplies mechanical apply evidence. A
Coordinator-owned internal lifecycle contract is the single source for outcome
shape, transition validity, and settled-state derivation; Coordinator and
Outcome both consume it. The Outcome module validates the cross-stage
relationship, removes unsafe detail, normalizes targets and reasons, and returns
one ephemeral task result plus a fixed-format receipt.

The Commit Kernel remains the same three-export Interface. The Outcome module
does not read or write files, mutate proposals, classify project meaning, or
create another source of truth.

### 2. Use one three-stage contract

~~~text
schemaVersion: 1
detect:  { status, reason }
propose: { status, reason }
apply:   { status, reason }
proposalId?: content-safe identifier
targets?: sorted workspace-relative paths
receipt: { kind, text }
~~~

Allowed statuses are:

- detect: `candidate | no_candidate | skipped`
- propose: `created | not_needed | blocked`
- apply: `applied | approval_required | blocked | not_attempted`

Every stage carries a machine-readable reason in the object. The receipt shows
all three statuses and includes reasons for non-success stages.

### 3. Fail closed across stages

The allowed families are:

| detect | propose | apply |
|---|---|---|
| `no_candidate` | `not_needed` | `not_attempted` |
| `skipped` | `blocked` | `not_attempted` |
| `candidate` | `blocked` | `not_attempted` |
| `candidate` | `created` | `applied | approval_required | blocked` |
| `skipped(existing_proposal)` | `not_needed(existing_proposal)` | `applied | approval_required | blocked` |

Every other combination is invalid. `applied` requires the exact proposal ID,
settled Coordinator accounting, one matching outcome, an allowed exact resume
from a non-terminal state, an applied audit reason, and at least one safe
workspace-relative target. Every inspected outcome must also have the complete
content-safe Coordinator shape and a valid action/status relationship. A
blocked workspace, matching bytes without audit, malformed accounting, or
partial applied claim cannot produce success.

### 4. Run only at a high-signal delivery checkpoint

After the current fix is verified, Codex and Claude run the checkpoint when any
of these stable signals occurred:

- `failed_verification_later_passed`
- `explicit_user_correction`
- `independent_qa_defect`
- `stale_context`
- `first_fix_failed_then_passed`

An ordinary task with no high-signal event stays silent and creates no proposal
or durable context write merely to report a no-op. `skipped` remains available
for an explicitly requested diagnostic.

### 5. Keep receipts content-safe and ephemeral

The fixed one-line receipt reports all three stages. Applied results may add
only a content-safe proposal ID and relative targets. Approval reports one
concise exception. Blocked results may add one known safe next-action token.

Receipts contain no lesson prose, proposal prose, PatchPlan content, target
content, conversation data, secret, or absolute path. They are not persisted.
Proposal aggregates remain the durable evidence, decision, and apply-audit
record.

This ships as Kit Version 0.6.0. Workspace Schema remains 1 because no durable
workspace shape or migration rule changes.

## Consequences

- High-signal repaired tasks become observable from detection through apply.
- Both Agent adapters share one trigger policy and one receipt contract.
- Deterministic code can prevent impossible success claims without deciding
  whether a lesson is reusable.
- Approval and blocker exceptions stay concise and do not block unrelated work.
- Ordinary one-off work remains quiet.
- The runtime gains another deep module, so its state validation, lifecycle
  evidence mapping, and privacy behavior require dedicated unit and integration
  tests plus fresh-Agent acceptance.

## Rejected Alternatives

- **Let each adapter write its own receipt**: duplicates consistency and privacy
  logic and permits Codex/Claude drift.
- **Persist a receipt file**: creates a second durable truth beside proposal
  audit.
- **Infer detection from lifecycle records**: deterministic code cannot decide
  whether a project lesson is reusable.
- **Treat target bytes as applied evidence**: matching bytes do not prove audit
  provenance.
- **Print a footer on every task**: adds noise and encourages meaningless
  proposals.
- **Add a daemon or new command**: expands authority and operating complexity
  without helping the delivery checkpoint.
