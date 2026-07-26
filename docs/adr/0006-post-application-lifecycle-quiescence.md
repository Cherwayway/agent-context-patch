# ADR-0006: Post-application lifecycle quiescence

- Status: accepted
- Date: 2026-07-26
- Decision owners: repository maintainer and user
- Extends: ADR-0004 and ADR-0005

## Context

The Lifecycle Coordinator originally inspected each non-terminal proposal once
in filename order. An exact automatic plan could apply late in that pass after
an earlier approval-waiting proposal had already been classified against the
old target bytes. The call then returned `settled`, although its own write had
made the earlier proposal stale. Repeating the same call immediately returned
`blocked / target_state_changed`.

The defect is broader than two proposals sharing one file: an approved config
change can also alter the policy or domain facts used to evaluate another
proposal. Correctness therefore cannot depend on filename order or a
same-target special case.

## Decision

### 1. Keep one external Coordinator interface

The existing seam remains:

~~~js
reconcileWorkspaceProposalLifecycles({ workspaceRoot })
~~~

No pass counter, dependency graph, semantic ordering, or new public action is
added. Callers continue to receive one content-safe outcome per inspected
proposal and `inspectedCount === outcomes.length`. When the call applied work
and then completed a no-new-application observation pass, it also returns
`postApplicationVerified: true`.

### 2. Reconcile a stable proposal cohort to post-application quiescence

The coordinator captures one stable candidate-file cohort after acquiring its
lifecycle lock. It then:

1. reads and validates the current source of every non-terminal candidate;
2. performs the existing exact lifecycle actions;
3. retains the latest outcome for each candidate;
4. starts another pass whenever a valid action reaches `applied`; and
5. stops after a pass performs no new successful application.

An applied transition remains in the returned outcome set after its proposal
becomes terminal. A still-live sibling is replaced by its newest classification.
Workspace status is derived only from that final outcome set.

The loop is bounded by the stable cohort: every continuing pass terminalizes at
least one previously non-terminal proposal, so one final observation pass is
sufficient after at most one application per candidate.

### 3. Limit the guarantee to Coordinator-owned mutations

Quiescence means that the return value reflects the state after the
coordinator's own successful applications in that call. It does not claim to
freeze targets against unrelated external writers. Existing hashes, locks,
compare-and-swap proposal writes, and fail-closed target inspection continue to
handle concurrent or later changes.

### 4. Preserve semantic ownership

The coordinator may classify a newly stale plan as
`regenerate_required / target_state_changed`. It does not choose proposal
ordering, merge plans, rewrite target meaning, or create a replacement. Those
remain Agent responsibilities.

## Consequences

- One call can no longer report `settled` when its own successful application
  has already made a sibling lifecycle-blocking.
- Results no longer depend on whether the automatic or approval-waiting
  proposal sorts first.
- Unrelated approval-waiting proposals remain non-blocking.
- The Outcome Interface receives complete final sibling evidence and therefore
  cannot publish a false applied-success receipt. It requires
  `postApplicationVerified: true` before accepting any applied transition, so a
  structurally plausible pre-fix result fails closed.
- Runtime work can include more than one proposal scan, but no new filesystem
  or semantic surface is exposed to callers.

## Rejected alternatives

- **Preflight every same-target pair as blocking**: file-level overlap is too
  coarse for shared context files and would disable safe automatic additions
  that are semantically unrelated.
- **Rescan only same-target siblings**: config and domain changes can affect
  proposals without sharing their target path.
- **Run one read-only check after the pass**: this would add a second
  classification implementation or fail to settle newly eligible exact work.
- **Move ordering or merge decisions into the Commit Kernel**: the kernel does
  not own proposal semantics or lifecycle orchestration.
