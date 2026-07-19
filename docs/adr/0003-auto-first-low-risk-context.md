# ADR-0003: Auto-first low-risk workspace context

- Status: accepted
- Date: 2026-07-12
- Decision owners: repository maintainer and user
- Supersedes: the default-policy and default-interaction parts of ADR-0001

## Context

Personal dogfooding exposed a failure in the proposal-first default. The Agent
usually mentioned a useful proposal in its final response, but the long-term
context remained unchanged unless the user read the details and returned for a
second approval turn. As Agents become more capable, users delegate more and
inspect routine narration less, so this approval queue creates missed context
improvements rather than meaningful supervision.

The Commit Kernel already supports deterministic automatic application for a
small class of low-risk workspace additions. The product default and Agent
adapters did not use that path by default.

## Decision

### 1. New workspaces default to auto

The Schema 1 template declares `context_write_policy: auto`. Schema 1 continues
to accept both `auto` and `propose`; this changes the Kit default, not the
Workspace Schema.

Bootstrap and Kit updates preserve every existing workspace config. An
existing `propose` workspace remains `propose` until its owner explicitly
changes that config. The repository dogfood workspace changes to `auto` through
the user decision that produced this ADR.

### 2. Proposal is an audit record, not the default user inbox

The Agent still creates the exact proposal aggregate, policy decision, and
Apply Attempt required by Protocol v1. When every auto gate passes, it completes
that lifecycle and calls the Commit Kernel in the current turn. It does not ask
for approval, tell the user to invoke another command, or wait for a reply.

`$evolve after-failure` is therefore a complete automatic execution path for
eligible changes. `$evolve approve` remains the exception path for plans that
are allowed only after a human decision.

### 3. Routine output is one non-blocking receipt

After a successful automatic application, the Agent reports one compact,
non-blocking receipt. The user does not need to act. Full target content, the
PatchPlan, and its hash remain available on request and in the proposal
aggregate, but they are not dumped into the normal final response. ADR-0005
later standardizes this as the content-safe three-stage Evolution Outcome and
removes lesson prose from the receipt.

When an auto gate fails, the Agent reports one blocking reason and requests
only the decision required for that exceptional operation.

### 4. Safety gates do not change

Automatic application remains limited to verified, low-risk, privacy-safe,
conflict-free workspace `add` operations targeting Active Context. Config,
domain activation, cleanup or removal, migration, instruction files,
user-global promotion, Kit update, and other authority-expanding changes still
require exact approval. Privacy hard failures remain non-overridable.

### 5. Post-success revert is not claimed by this decision

The current Kernel can roll back a partially failed transaction but does not
retain a durable preimage after success. This change does not describe that as
later user-triggered undo. A future post-success revert feature requires its
own durable inverse record, conflict semantics, tests, and architectural
decision. Its absence does not block using the existing narrow auto path.

### 6. Kit versioning

This behavioral default ships as Kit Version 0.4.0 while Workspace Schema stays
at version 1. Existing Schema 1 workspaces remain valid and are never rewritten
merely to refresh Kit provenance or policy.

## Consequences

- The common low-risk path finishes in one Agent turn with no user decision.
- Human attention moves to exceptional, higher-authority changes.
- Proposal evidence and deterministic commit safety remain intact.
- Existing cautious workspaces retain their policy across install and update.
- The product must test both the auto-first fresh-workspace path and preserved
  explicit `propose` behavior.
- The product must not promise post-success undo until that capability exists.

## Rejected alternatives

- **Change only the template config**: adapters could still stop at narration
  instead of calling the Kernel.
- **Remove proposals from auto**: loses the single audit source and makes later
  review less reliable.
- **Automatically apply every semantic operation**: exceeds the currently
  verified rollback and authority model.
- **Require users to copy a plan hash**: exposes an internal integrity token as
  routine interaction without adding safety.
