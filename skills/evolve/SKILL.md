---
name: evolve
description: Turn verified failures, repeated corrections, and stale workspace context into automatically applied low-risk workspace patches, with review reserved for safety exceptions, or explicitly check and safely update the installed Kit.
---

# Evolve

Use this skill when current work exposes a lesson that is likely to prevent a
future mistake. Fix and verify the current task first. Do not invoke it for a
one-off detail that has no recurring value.

Agent Context Patch is agent-first:

- The agent understands the project, judges evidence, chooses wording, and
  prepares semantic changes.
- The deterministic commit kernel validates the plan envelope, paths, policy,
  hashes, conflicts, and application. The Lifecycle Coordinator owns
  deterministic proposal reconciliation and audit continuation. The Outcome
  Interface validates and formats the ephemeral delivery result; the agent owns
  detection, proposal meaning, and semantic lifecycle decisions. Neither
  deterministic module judges project meaning or edits proposal prose.
- `auto` is the default write policy for new workspaces. It requires the Node
  kernel; if the kernel is unavailable, preserve the exact proposal, report
  the reason, and use the approval path instead of pretending the patch was
  applied.

Read references/protocol-v1.md for the normative v1 contract.

## Context loading

For normal project work, load only:

1. .agent-context/PROJECT_CONTEXT_INDEX.md
2. .agent-context/PROJECT_PROFILE.md
3. the relevant checklist for a domain enabled in config.yml

Do not load proposals, reports, or archive by default. Read config.yml and the
relevant reference only when evolving context.

## Lifecycle reconciliation

For `$evolve after-failure`, `$evolve approve`, `$evolve review-context`, and
`$evolve weekly`, invoke the installed runtime's dedicated coordinator before
creating, approving, or reporting more proposal work. Invoke it again after a
new eligible auto proposal or an exact approval is persisted so the coordinator
owns the apply-and-audit continuation:

~~~js
import { reconcileWorkspaceProposalLifecycles } from "./runtime/lifecycle.mjs";

const reconciliation = await reconcileWorkspaceProposalLifecycles({
  workspaceRoot,
});
~~~

Resolve the module path from the installed Skill; the example path is relative
to this file, not the user's current directory. This is not a new public
command. Do not run it from `init`, `update`, installation, Agent startup, a
daemon, or a background scan.

Handle its content-safe outcomes as follows:

- `resume_exact_auto` or `resume_exact_authorized`: report the resulting state;
  do not append another Decision for an already-approved plan.
- `regenerate_required`: re-read current sources and semantically rebuild the
  history-free proposal; deterministic code must not choose new wording.
- `superseding_proposal_required`: create a replacement proposal, write that
  exact proposal ID in the old Supersession section, then reconcile again. The
  coordinator alone verifies the cross-proposal edge before changing the old
  status to superseded.
- `audit_recovery_required`: stop. Matching after hashes do not prove that this
  proposal applied; never invent the missing Attempt or silently reapply.
- `manual_recovery_required`: stop automatic work and report the one
  machine-readable reason.
- `approval_required`: continue only through the existing informed approval
  path.
- `settled`: no additional lifecycle action is needed for that proposal.

If the lifecycle lock remains after a crash, verify that no coordinator is
active before manually removing only
`.agent-context/.lifecycle-coordinator.lock`. Never delete it based on age.

## Delivery checkpoint

After the current fix is verified, run one delivery checkpoint only when at
least one high-signal event occurred:

- `failed_verification_later_passed`
- `explicit_user_correction`
- `independent_qa_defect`
- `stale_context`
- `first_fix_failed_then_passed`

The Agent decides the semantic `detect` and `propose` stages. If a proposal was
created or an existing proposal was reconciled, pass the exact content-safe
Lifecycle Coordinator result as mechanical evidence; never synthesize the
`apply` stage. Finalize the task-level result through the installed Skill's
separate Outcome Interface:

~~~js
import { finalizeEvolutionOutcome } from "./runtime/outcome.mjs";

const outcome = finalizeEvolutionOutcome({
  detect,
  propose,
  proposalId,
  reconciliation,
});
~~~

Omit `proposalId` and `reconciliation` for `no_candidate` or a semantic blocker.
Resolve the module path from the installed Skill. Print only `outcome.receipt.text`:
it covers `detect`, `propose`, and `apply`; every non-success stage includes one
stable machine-readable reason. Applied results may also include only a
content-safe proposal ID and sorted workspace-relative targets. Do not add
lesson prose, PatchPlan content, target content, secrets, conversation data, or
absolute paths to the receipt.

The valid state families are:

- `no_candidate / not_needed / not_attempted`
- `skipped / blocked / not_attempted`
- `candidate / blocked / not_attempted`
- `candidate / created / applied | approval_required | blocked`
- `skipped(existing_proposal) / not_needed(existing_proposal) / applied |
  approval_required | blocked`

Any other combination is invalid and must fail closed. In particular, the
Outcome Interface cannot report `applied` without the exact proposal ID and a
verified applied audit from settled reconciliation. If finalization itself
rejects the inputs, report only `invalid_evolution_outcome`; do not hand-format
a success receipt.

If there is no high-signal trigger, stay silent: do not create a proposal or
durable context write merely to emit an outcome. `detect: skipped` is available
only when an explicit diagnostic result is required. The outcome and receipt
are ephemeral task results; proposal aggregates remain the durable audit source.

## Hard invariants

- Never let evolution delay repair of the current task.
- Never apply a proposal until current_fix_status is verified.
- Workspace is the only active context scope in v1.
- User-global is valid only for a manually approved promotion proposal; the
  workspace kernel cannot apply it.
- Supported write policies are propose and auto. New workspaces default to
  auto; an existing workspace's explicit config remains authoritative.
- Deletion, cleanup, migration, domain activation, instruction-file changes,
  and user-global promotion always require human approval.
- Approval covers one immutable PatchPlan and its plan_hash. Changed targets
  require a new plan and new approval.
- The proposal aggregate itself is never a PatchPlan target. Decision and
  Apply Attempt writes stay outside the kernel transaction.
- Never infer `applied` from target content. Exact before hashes permit resume;
  after hashes without an applied Attempt require audit recovery.
- Never hand-format a detect-to-apply success. The Outcome Interface requires
  settled Lifecycle Coordinator evidence and strips unsafe detail.
- Every non-migration kernel call requires a complete current v1 config.
  Future schemas remain read-only; legacy migration requires exact backups for
  every changed existing file in the same approved transaction.
- Archive targets are create-only history. Approval can add a new snapshot but
  cannot rewrite an existing archive file.
- A workspace proposal persists the complete JSON PatchPlan. Its target_files,
  frontmatter plan_hash, Decision Log hashes, and Apply Attempt hashes must
  agree with that plan.
- PatchPlan semanticOperation must equal proposal frontmatter operation. Auto
  is possible only for semanticOperation add.
- Approval and application are separate internal states. Eligible auto plans
  do not require a user decision; `$evolve approve` handles only the exception
  path that requires one.
- Active context changes use replace-before-add. Never append a rule before
  checking for duplication, overlap, conflict, or a better replacement.
- Evidence is pointer-first and summary-first. Never persist secrets, raw
  conversations, complete logs, customer data, or unnecessary absolute paths.
- Kit updates run only when the user invokes $evolve update. They never poll in
  the background, emit telemetry, silently replace the installed skill, edit a
  workspace, or authorize a workspace-schema migration.

## Commands

### $evolve init

Initialize or refresh the current workspace:

1. Resolve the workspace root; a Git repository is one possible workspace, not
   a separate scope.
2. If config.yml has no schema_version, read references/legacy-migration.md and
   remain read-only until a migration proposal is approved.
   If it claims v1 but fails the complete config envelope, stop as invalid
   rather than materializing missing templates.
3. Inspect source-of-truth files and mark uncertainties rather than guessing.
4. Detect candidate domains with evidence, confidence, and uncertainties.
5. Build one InitPlan containing candidate domains, active files, exact patches,
   and context impact. Split safe Active Context additions from approval-only
   config or domain changes.
6. Apply every eligible auto addition immediately. Request one concise decision
   only when the plan also changes config or enabled domains; the user never
   needs to copy a plan hash.
7. Store only approved enabled_domains in config.yml. Materialize checklists
   only for enabled domains; detected candidates remain temporary plan data.
8. Give one compact receipt for applied changes and list only unresolved safety
   exceptions. Do not dump the full InitPlan unless the user asks.

Auto cannot enable or disable domains.

### $evolve after-failure

Run autonomously after a correction, failed verification, repeated mistake,
missed context read, or stale-context discovery. The user does not need to
invoke this command manually:

1. Repair the current issue and verify it when possible.
2. Reconcile unfinished proposal lifecycles before creating another aggregate;
   handle every blocking outcome using the rules above.
3. After verification, run the delivery checkpoint. Decide whether the lesson
   is reusable. If not, finalize `no_candidate / not_needed / not_attempted`
   and print only its compact receipt.
4. Compare it with active context using replace-before-add. Compare the
   responsibility, trigger, reachable execution path, intended effect, and
   observable verification rather than relying on shared nouns. Only when
   related active rules suggest the same responsibility or failure shape, read
   pointer-first summaries for those applied proposals and shortlist the few
   aggregates needed to test subsumption. Do not scan full proposal history
   after every failure.
5. Create one evidence-backed proposal aggregate in proposals/.
6. Use pending_current_fix while repair is not verified; otherwise use
   proposed.
7. Keep evidence as workspace-relative pointers and short result summaries.
8. Evaluate authority, retention value, privacy, and the net active-context
   change.
9. For a workspace proposal, persist the full JSON PatchPlan under Proposed
   Patch and compute plan_hash from its canonical JSON.
10. Evaluate policy and all auto gates. When eligible, invoke Lifecycle
    Reconciliation again. It persists the `policy_auto` Decision, enters
    approved, calls the Commit Kernel with the exact runtime plan, appends the
    Apply Attempt, and enters applied only after success.
11. Finalize the Agent-owned `detect` and `propose` stages with the exact
    reconciliation result through `finalizeEvolutionOutcome`. Print only
    `outcome.receipt.text`; do not request approval, wait for a reply, or print
    the full PatchPlan or plan hash on an applied path.
12. If an auto gate fails, keep the exact proposal and let the Outcome Interface
    report `approval_required` or `blocked` with one machine-readable reason and
    a safe next action when known. Ask for a decision only when the operation is
    an allowed approval-only exception.

### $evolve approve

This is the public exception path for a proposal that cannot use auto:

1. Reconcile unfinished lifecycles. If the requested proposal was resumed to
   applied or superseded, report that result and stop. If it needs regeneration,
   supersession, audit recovery, or manual recovery, resolve that exact outcome
   before requesting approval.
2. Parse the four-tilde JSON block under Proposed Patch / PatchPlan JSON.
   Reject prose-only or partial patch descriptions.
3. Recompute canonical JSON SHA-256 and require it to equal frontmatter
   plan_hash. Require target_files to equal the operation targets and every
   existing Decision/Apply hash to equal the same value. Require
   semanticOperation to equal frontmatter operation.
4. Show a concise semantic summary followed by the complete immutable plan:
   target contents, operations, before hashes, policy result, context delta,
   and plan_hash. High-risk approval must be informed even though it is rare.
5. Obtain explicit approval for the exact current plan. The user may simply
   reply with approval; never require them to copy or repeat the hash.
6. Persist a Decision Log entry and status approved. If this write fails, stop
   before calling the kernel.
7. Invoke Lifecycle Reconciliation again. It rechecks the exact plan, current
   config, paths, mechanical privacy, and before hashes, adds runtime-only
   absolute workspaceRoot and
   planHash, then calls `applyPatchPlan(plan, {approvedPlanHash})`. Approval
   stays outside the hashed plan and must match plan_hash exactly.
8. Let the kernel transaction update only the context targets and return its
   raw status, reason, and per-target hash operations.
9. Let the coordinator map that result to an Apply Attempt, add the attempt
   timestamp and a content-free error summary, then append it immediately. On
   success it sets status to applied; on conflict, failure, or rollback it keeps
   status approved.
10. If audit writeback fails, report audit_write_pending and retry it. Do not
    create a separate receipt or claim lifecycle completion.

If a target changes before any decision or attempt, replace the plan and
recompute its hash. After audit history exists, create a superseding proposal
instead, write the replacement ID in the old Supersession section, and rerun
Lifecycle Reconciliation; one aggregate never mixes hashes from multiple plans.
Without the kernel, propose mode may apply the exact human-approved patch, but
must still record hashes and the result.

A user-global promotion has no workspace PatchPlan before an adapter resolves
its real target. Store only a sanitized candidate hash, keep status proposed,
and defer exact approval to the adapter plan. Never send it to the workspace
kernel.

### $evolve review-context

Review active context against current sources. Use
references/cleanup-policy.md and references/context-budget.md.

- Reconcile unfinished proposal lifecycles before calculating proposal health.
- Rank authority separately from retention value.
- Detect stale, duplicated, conflicting, vague, or over-specific rules.
- Use a summary-first two-stage read: scan Active Context plus proposal IDs and
  short summaries, then deeply inspect only the shortlist that may share the
  same responsibility and behavior failure shape.
- Generalize across different implementation nouns only when one testable
  invariant preserves the included verification guarantees. Record subsumed
  rules and proposal IDs, preserved domain details, exclusions or
  counterexamples, behavior lost, and net active-context change.
- Prefer tighten, merge, rewrite, supersede, or archive over another append.
- Produce an exact cleanup proposal with what behavior would be lost and the
  net context change.
- Require human approval for every semantic removal or replacement.

Thresholds trigger review and block auto; they never authorize truncation.

### $evolve weekly

Reconcile unfinished proposal lifecycles first, then write a compact derived
report in reports/ covering:

1. recurring signals and verification status
2. applied improvements
3. proposal triage
4. stale, redundant, or conflicting active context
5. recommended patches, cleanup, and possible cross-noun generalization
   candidates for `$evolve review-context`; the report never merges them
6. next review priorities

Reports are rebuildable views, not sources of truth, and are not part of the
default context read.

### Personal multi-repository dogfooding

When the user explicitly wants to establish or review their own long-running
use of this kit across repositories, read the experimental owner-dogfood guide
`references/personal-dogfooding.zh-CN.md`. Keep each repository workspace-first,
promote only evidence-backed patterns, and do not turn the review cadence into
mandatory ceremony when no real signal exists.

### $evolve update

This is the only public Kit update entry point. Run it only when the user asks:

1. Resolve the installed evolve skill path and read its manifest without
   scanning workspaces.
2. Query
   https://github.com/Cherwayway/agent-context-patch/releases/latest, resolve
   the latest stable Release to one GitHub-enforced immutable tag and source
   commit, and compare its Kit Version with the installed version. Stop if the
   Release is not marked immutable. If the check is unavailable, report that
   and leave the current install usable. If the installed version is current
   or newer, report that and stop; this command never downgrades an
   installation.
3. Download that exact Release and its published integrity metadata to a local
   temporary directory. Verify the published archive checksum, the GitHub
   Release tag and target commit, and the unpacked skill manifest version.
   Require those identities to agree. Stop on missing metadata or any
   mismatch.
4. Execute the Bootstrap from the unpacked candidate Release in UpdateDryRun
   mode against the resolved installed skill path. The candidate Release is
   the update source; never run the installed Bootstrap as its own source.
5. Show the complete UpdatePlan: installed and target versions, immutable tag
   and commit, artifact checksum, exact installed and candidate managed-tree
   hashes, whole-skill replacement scope, recovery copy, workspace-schema
   impact, rollback behavior, and exact plan hash.
6. Obtain explicit approval of that exact hash. A changed candidate, target,
   or plan requires a new dry-run and new approval.
7. Invoke the same candidate Release Bootstrap in UpdateApply mode with the
   approved hash. Do not merge locally modified skill files or include an
   instruction-file patch or workspace migration in this mechanical update.
8. Report verification and recovery results. On failure, restore the prior
   working skill when possible. If automatic restore fails, retain and report
   the recovery copy; never claim success from an incomplete replacement.
9. On success, report the installed version and tell the user to start a new
   Agent task so the updated skill is loaded.

Version discovery sends no workspace path, context, source code, conversation,
or usage event. GitHub Release notifications are external; this skill provides
no daemon, scheduled check, telemetry, or silent upgrade.

## Policy evaluation

Read context_write_policy from config.yml. `auto` is the default write policy
for newly initialized workspaces:

- auto: complete the same audited lifecycle immediately without a human
  decision when every low-risk gate in references/protocol-v1.md passes.
- propose: an explicit cautious mode, or a preserved setting in an existing
  workspace; create the exact record and wait for approval.

If an auto gate fails, keep the proposal and its machine-readable policy result,
but show the user only one concise exception by default:

~~~yaml
requested_policy: auto
effective_policy: propose
reason: <machine-readable-reason>
~~~

The agent or kernel must not weaken a failed gate. A successful auto path must
end with one non-blocking receipt and no request for user action.

## References

- references/protocol-v1.md
- references/config-schema.md
- references/proposal-schema.md
- references/legacy-migration.md
- references/domain-packs.md
- references/context-budget.md
- references/cleanup-policy.md
- references/privacy.md
- references/personal-dogfooding.zh-CN.md
- references/domain-coding.md
- references/domain-prd.md
- references/domain-seo.md
