# Protocol v1

This is the normative protocol for schema_version 1.

## Responsibilities

The agent owns semantic work:

- understand the workspace and current sources
- decide whether a lesson is reusable
- judge evidence quality
- detect domains
- choose scope, targets, wording, and cleanup
- generate PatchPlans

The commit kernel owns mechanical commit invariants:

- validate the plan envelope, policy, and target paths
- recompute plan_hash and require an exact match
- recheck supplied beforeHash values and calculate after hashes
- detect conflicts and enforce idempotency
- stage, apply, and roll back a multi-file patch
- return content-free status, reason, and per-target operation hashes
- stop auto when a privacy heuristic is suspicious

The agent owns semantic proposal lifecycle decisions and replacement-plan
generation. The Lifecycle Coordinator owns only deterministic reconciliation:
validating proposal aggregates, comparing exact target hashes, resuming an
unchanged authorized plan through the kernel, and writing audit transitions.
The kernel must not classify project meaning, mutate the proposal aggregate, or
claim to validate its lifecycle.

## Terms

- Observation: a factual signal from current work.
- Evidence: a minimal, verifiable pointer or summary supporting an observation.
- Proposal: the internal audit aggregate that owns one context evolution
  lifecycle. It is not a default user approval inbox.
- Decision: an automatic `policy_auto` result, approval, or rejection of one
  immutable PatchPlan.
- PatchPlan: the persisted, complete target contents, operations, hashes, policy
  result, privacy result, health gate, and context delta proposed for
  application.
- Apply Attempt: an append-only result for one plan application.
- Lifecycle Reconciliation: a deterministic pass that settles or reports
  unfinished proposal lifecycles without changing PatchPlan meaning.
- Active Context: short, current guidance loaded by ordinary work.
- Report: a rebuildable view over proposals and active context.
- Archive: inactive history loaded only when explicitly requested.

## Storage topology

~~~text
.agent-context/
  config.yml
  PROJECT_CONTEXT_INDEX.md
  PROJECT_PROFILE.md
  checklists/
  proposals/
  reports/
  archive/
~~~

There is no mistakes or receipts directory. A proposal contains the observation,
decision history, and apply attempts. Reports are derived. Archive is inactive.

The default read set is the index, profile, and task-relevant enabled
checklists. Proposals, reports, and archive are opt-in reads.

## Scope

- workspace: the only active context scope.
- user-global: allowed only with operation user_global_promotion. It is a
  sanitized candidate for an agent adapter, always needs human approval, and
  cannot be applied by workspace auto or the workspace commit kernel.

Repo, team, kit, and project are not v1 schema scopes. A Git repository may be
the workspace root, but is not a second context layer.

## Lifecycle

Legal transitions:

~~~text
pending_current_fix -> proposed
proposed            -> approved | rejected
approved            -> applied
approved            -> superseded  # unapplied stale conflict plus valid replacement only
applied             -> superseded
rejected            -> archived
superseded          -> archived
~~~

Archived is terminal. A failed, conflicted, or rolled-back apply attempt leaves
the proposal approved. current_fix_status must be verified before applied.

Auto records decision: policy_auto before it attempts application. It follows
the same approved-to-applied transition as manual approval. When all auto gates
pass, the Agent completes this transition in the current command before its
final response; it does not wait for another user turn.

An approved proposal that never applied may enter superseded only when its
final Attempt is a real stale-target conflict (`before_hash_mismatch`,
`target_exists`, or `target_missing`), no Attempt ever applied, and its
Supersession section names a different valid replacement proposal that exists.
The single-proposal contract validates the history; Lifecycle Reconciliation
validates replacement existence before changing status.

## Lifecycle reconciliation

Before `$evolve after-failure`, `$evolve approve`, `$evolve review-context`, or
`$evolve weekly` creates, approves, or reports more proposal work, invoke:

~~~js
reconcileWorkspaceProposalLifecycles({ workspaceRoot })
~~~

The coordinator reads only proposal Markdown and exact PatchPlan targets. It
ignores README, temporary, and terminal proposal files. It classifies all
targets for one plan together:

- all before hashes: the exact automatic or already-approved plan may resume;
- all after hashes with no applied Attempt: report `audit_recovery_required`
  and do not infer who wrote the bytes;
- mixed before/after: report `manual_recovery_required`;
- changed before any history: report `regenerate_required`; the Agent may
  rewrite that history-free proposal semantically;
- changed after audit history: report `superseding_proposal_required`; the
  Agent creates a replacement and names it in the old Supersession section.

Reconciliation returns only IDs, statuses, machine-readable actions/reasons,
and workspace-relative targets. It never returns target or PatchPlan content or
an absolute path. It never generates wording, replaces a stale plan, creates a
new proposal, or claims to repair an unknown audit gap.

Proposal audit writes use `.agent-context/.lifecycle-coordinator.lock`, a
source-hash compare-and-swap check, a same-directory temporary file, and atomic
replacement. A lock is never deleted based on age. After verifying no
coordinator is active, remove that exact lock manually if a crashed process left
it behind. Reconciliation creates no receipt sidecar and never runs as a daemon,
startup hook, installer scan, or update scan.

## PatchPlan

A workspace proposal persists one complete, JSON-serializable PatchPlan under
Proposed Patch. It contains:

- schemaVersion, planId, and proposalId
- semanticOperation equal to proposal frontmatter operation
- requestedPolicy, policy as the effective policy, and policyReason
- risk and currentFixStatus
- privacy and contextHealth results
- contextDelta
- ordered operations with type, target, beforeHash, and complete post-apply
  content

The persisted object does not contain workspaceRoot or planHash. Canonicalize it
by recursively sorting object keys, preserving array order, and serializing
compact JSON. plan_hash is the lowercase SHA-256 of those UTF-8 bytes.

At runtime, add absolute workspaceRoot and planHash. computePlanHash excludes
exactly those two runtime-only fields, so persisted content can reproduce the
same hash.

target_files must equal the ordered operation targets. The proposal aggregate
is never a PatchPlan target. Mutable status, Decision Log, and Apply Attempts
are outside the hash and cannot create self-reference.

semanticOperation is part of canonical hashing. It preserves whether identical
file-level create/update operations mean add, cleanup, migration, or a domain
change.

Every Decision and Apply Attempt hash in the aggregate must equal frontmatter
plan_hash and the recomputed PatchPlan hash. After audit history exists, a
changed target, content, policy result, or context delta requires a new
superseding proposal. The same aggregate may safely retry only the same plan.

Manual application uses this seam:

~~~text
applyPatchPlan(plan, { approvedPlanHash })
~~~

approvedPlanHash is external to plan so the hash cannot include its own
approval. $evolve approve <proposal-id> reads plan_hash from that proposal and
must first recompute it from persisted JSON, then pass the exact same value. A
mismatch stops before writing.

## User-global promotion

Before an adapter resolves its actual target, a user-global promotion is only a
sanitized candidate. It has empty target_files, null plan_hash, a frontmatter
candidate_hash, no workspace PatchPlan, no approved Decision, and cannot enter
the workspace kernel.

Hash the canonical candidate JSON with the same canonicalization as PatchPlan.
candidateContent is a JSON string, including an intentional final newline when
present. candidate_hash is for comparison, not approval. Keep the proposal
proposed. The selected adapter later resolves the target, creates an
adapter-owned exact plan, and requests approval there. The workspace validator
must not pretend that candidate_hash proves an applicable workspace plan.

## Auto gates

New workspaces created from the current template declare `auto`. Existing
workspace config remains authoritative and is never silently changed by an
install or Kit update. `propose` remains a supported explicit cautious mode.

Auto is permitted only when all conditions hold:

- the complete live config declares auto
- the Node commit kernel is available
- status is proposed and current_fix_status is verified
- scope is workspace and PatchPlan semanticOperation is add
- every target is PROJECT_CONTEXT_INDEX.md, PROJECT_PROFILE.md, or a checklist
  for a domain currently enabled in config.yml
- no target is a proposal, report, archive, config, agent instruction, global
  file, migration, or inactive checklist
- the addition has no semantic overlap, conflict, replacement, deletion, move,
  domain activation, or domain deactivation
- active context and pending proposal counts are below block_auto thresholds
- before_hashes still match
- context health reports autoAllowed
- the mechanical privacy gate passes and no likely secret is present

Otherwise effective policy is propose. Human approval is always required for
every other semanticOperation, including cleanup, removal, migration, domain
changes, instruction files, user-global promotion, changing an existing
workspace from propose to auto, or otherwise expanding write authority.

## Apply result

All context targets are preflighted and staged as one transaction before
replacement. The kernel does not edit the proposal aggregate. Its raw result
contains status, optional content-free reason, plan ID, proposal ID, plan hash,
and per-target operations with before and after hashes. It has no timestamp.

Before invoking the kernel, the Agent or Lifecycle Coordinator persists the
exact Decision and status approved. After the kernel returns, the coordinator
maps status to result, adds attempted_at, adds applied_at only for success,
derives a content-free error_summary from reason, and immediately appends the
Apply Attempt. An applied result moves status to applied. Conflict, write
failure, or rollback leaves status approved. A partial write must be rolled
back. If rollback itself fails, record the affected targets and stop; never
report applied.

This audit writeback is a real boundary. If the decision write fails, do not
apply. If attempt writeback fails after context application, report
`audit_write_pending`, retain the returned attempt, and retry the aggregate
write. A later reconciliation that sees target `afterHash` without the applied
Attempt reports `audit_recovery_required`; it does not silently reapply or
invent the missing record. Do not create another receipt file or claim the
lifecycle is complete.

After a successful automatic application, the Agent emits one compact,
non-blocking receipt with the lesson, proposal ID, and affected targets. The
default response does not include the full PatchPlan or plan hash and requests
no user action. A failed or downgraded path reports one blocking reason and asks
only for a decision that the protocol actually requires.

A mechanical likely-secret match is a hard rejection until redacted. Human
approval cannot override this safety failure.

## Active context health

Before preparing an add, compare it to active context:

- no match: add may be appropriate
- same meaning: add evidence, not another active rule
- partial overlap: tighten, merge, or rewrite
- conflict: supersede through human approval
- lower-value lesson: keep it in the proposal history
- old material is only an example: archive the example and retain a short rule

Quantity thresholds schedule review and block auto. Semantic authority and
retention value determine the proposed cleanup. No threshold authorizes
automatic truncation or deletion.
