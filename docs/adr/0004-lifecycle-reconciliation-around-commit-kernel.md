# ADR-0004: Lifecycle reconciliation around the Commit Kernel

- Status: accepted
- Date: 2026-07-19
- Decision owners: repository maintainer and user
- Extends: ADR-0001 and ADR-0003

## Context

The Commit Kernel correctly fails closed on stale hashes, but proposal audit
state is deliberately outside its transaction. Issue #5 exposed the missing
coordinator around that boundary:

- an eligible `auto` proposal could survive an interrupted Agent turn as
  `proposed`, with no Decision or Apply Attempt;
- an exact-approved proposal could remain `approved` after a target changed;
- Schema 1 required `superseded` to have a successful applied history, so a
  never-applied stale approval had no honest terminal transition;
- a target that happened to equal the plan's `afterHash` could not safely be
  attributed to this proposal when the applied Attempt was missing.

The repair must close lifecycle gaps without moving semantic judgment into
deterministic code, creating a second receipt store, or expanding the Commit
Kernel into a proposal editor.

## Decision

### 1. Add one separate Lifecycle Coordinator

`skills/evolve/runtime/lifecycle.mjs` exposes one Agent-facing runtime seam:

~~~js
reconcileWorkspaceProposalLifecycles({ workspaceRoot })
~~~

The coordinator scans valid workspace proposal aggregates and returns only
proposal IDs, statuses, machine-readable actions/reasons, and relative targets.
It returns no proposal prose, target content, plan content, or absolute path.

The Commit Kernel interface remains unchanged. It still accepts an exact
runtime PatchPlan plus optional external authorization and returns a
content-free ApplyAttempt. The coordinator calls that seam; it does not absorb
it.

### 2. Classify live target relation before lifecycle mutation

The Kernel and coordinator share path preparation and hash semantics. For one
complete PatchPlan, target state is classified as:

- `before`: every target still matches its operation's `beforeHash` or is still
  absent for a create;
- `after`: every target matches the plan's computed `afterHash`;
- `mixed`: targets are split between before and after states;
- `changed`: at least one target matches neither state.

Only `before` can resume exact work. `after` without an applied Attempt becomes
`audit_recovery_required`; the coordinator never fabricates provenance.
`mixed` requires manual recovery. A changed proposal with no audit history is
left untouched for Agent-owned semantic regeneration.

### 3. Resume exact authorization, not semantic intent

An interrupted eligible automatic proposal may receive its `policy_auto`
Decision and continue through the Kernel. An existing exact human approval is
durable across Agent turns while the persisted plan still validates and every
target remains at `beforeHash`.

A current proposal that requires human approval is already in its intended
waiting state. The coordinator reports `approval_required`, but treats that
outcome as non-blocking so unrelated failure handling, review, and reporting
can continue.

The coordinator never rewrites PatchPlan content, changes targets, re-evaluates
project meaning, or generates a replacement. Those remain Agent
responsibilities.

### 4. Permit one narrow never-applied supersession path

Schema 1 also permits:

~~~text
approved -> superseded
~~~

only when all of the following are true:

1. the proposal has an exact approval or `policy_auto` Decision;
2. no Apply Attempt ever succeeded;
3. the final Attempt is `conflict` with `before_hash_mismatch`, `target_exists`,
   or `target_missing`;
4. the `Supersession` section names one different valid proposal;
5. that replacement proposal exists and is not rejected, archived, or itself
   superseded;
6. live targets are not ambiguously `after` or `mixed`; once a valid replacement
   is named, an all-before state does not revive the old plan.

The single-document validator can prove the history shape. The coordinator
proves replacement existence before changing status. Until then the proposal
remains `approved`.

### 5. Promote proposal validation into production

The proposal parser and validator move from a test-only helper into
`skills/evolve/runtime/proposal.mjs`. Repository fixtures re-export and test
that production implementation, preventing a runtime/test contract fork.

### 6. Serialize proposal audit writes independently

Proposal audit writes remain outside `planHash` and outside the Commit Kernel.
The coordinator protects them with:

- `.agent-context/.lifecycle-coordinator.lock`, containing an ownership token;
- no age-based stale-lock deletion;
- source-hash compare-and-swap checks before replacement;
- a same-directory exclusive temporary file and atomic rename;
- regular-file, symlink, and UTF-8 checks;
- validation of the complete resulting proposal before write.

If atomic replacement reports a transient failure, the coordinator retries the
same validated audit source once in the same process. If replacement completed
but its acknowledgement was lost, the retry recognizes the exact desired source
hash as an idempotent success. It never creates a second Decision or Attempt.

A crash may leave the lifecycle lock. After confirming no coordinator is
active, an operator may remove that exact workspace-relative file manually.
There is no sidecar receipt or alternate source of truth.

### 7. Reconcile from existing commands only

`$evolve after-failure`, `$evolve approve`, `$evolve review-context`, and
`$evolve weekly` invoke reconciliation before creating, approving, or reporting
more proposal work. There is no new public command, startup scan, installer
scan, update scan, daemon, telemetry, or background polling.

This ships as Kit Version 0.5.0. Workspace Schema remains 1 because existing
valid aggregates remain valid and no workspace migration is required.

## Consequences

- Interrupted exact work becomes recoverable and idempotent across Agent turns.
- Human approval remains useful without authorizing changed content.
- A stale never-applied approval can terminate honestly instead of remaining
  permanently approved or claiming a false apply.
- Audit uncertainty stays visible; matching bytes alone never establish who
  wrote them.
- The runtime gains proposal mutation code, so lifecycle locking, CAS behavior,
  and output privacy require dedicated tests.
- Agents still perform semantic regeneration and replacement creation.

## Rejected Alternatives

- **Expand the Commit Kernel to own proposals**: mixes proposal/audit mutation
  with target commit and creates self-referential transaction pressure.
- **Infer applied from matching `afterHash`**: cannot establish provenance and
  can fabricate audit history.
- **Automatically rewrite stale PatchPlans**: deterministic code cannot decide
  current project meaning or preserve the user's approved intent.
- **Add a new stale status**: the existing `superseded` meaning is sufficient
  once its never-applied conflict path is stated narrowly.
- **Add a receipt sidecar or journal**: creates a competing source of truth.
- **Run a background reconciler**: expands authority and operating complexity
  without evidence that a daemon is needed.
