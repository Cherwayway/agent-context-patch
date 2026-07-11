---
name: evolve
description: Turn verified failures, repeated corrections, and stale workspace context into reviewable context patches without letting active context grow unchecked, or explicitly check and safely update the installed Kit.
---

# Evolve

Use this skill when current work exposes a lesson that is likely to prevent a
future mistake. Fix and verify the current task first. Do not invoke it for a
one-off detail that has no recurring value.

Agent Context Patch is agent-first:

- The agent understands the project, judges evidence, chooses wording, and
  proposes semantic changes.
- The deterministic commit kernel validates the plan envelope, paths, policy,
  hashes, conflicts, and application. The agent owns lifecycle logging. The
  kernel never judges project meaning or edits proposal prose.
- The basic propose flow works without Node. Auto requires the Node kernel; if
  it is unavailable, report the reason and use propose.

Read references/protocol-v1.md for the normative v1 contract.

## Context loading

For normal project work, load only:

1. .agent-context/PROJECT_CONTEXT_INDEX.md
2. .agent-context/PROJECT_PROFILE.md
3. the relevant checklist for a domain enabled in config.yml

Do not load proposals, reports, or archive by default. Read config.yml and the
relevant reference only when evolving context.

## Hard invariants

- Never let evolution delay repair of the current task.
- Never apply a proposal until current_fix_status is verified.
- Workspace is the only active context scope in v1.
- User-global is valid only for a manually approved promotion proposal; the
  workspace kernel cannot apply it.
- Supported write policies are propose and auto. Auto is an explicit
  workspace opt-in, not an agent inference.
- Deletion, cleanup, migration, domain activation, instruction-file changes,
  and user-global promotion always require human approval.
- Approval covers one immutable PatchPlan and its plan_hash. Changed targets
  require a new plan and new approval.
- The proposal aggregate itself is never a PatchPlan target. Decision and
  Apply Attempt writes stay outside the kernel transaction.
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
- Approval and application are separate internal states even though
  $evolve approve is the single public command.
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
5. Show one InitPlan containing proposed enabled domains, active files, exact
   patches, and context impact.
6. Apply the approved plan. Store only enabled_domains in config.yml; detected
   candidates are temporary plan data.
7. Materialize checklists only for approved enabled domains. A custom
   workspace checklist may be proposed when no pack fits.
8. Report created, changed, skipped, and unresolved items.

Auto cannot enable or disable domains.

### $evolve after-failure

Run after a correction, failed verification, repeated mistake, missed context
read, or stale-context discovery:

1. Repair the current issue and verify it when possible.
2. Decide whether the lesson is reusable. If not, stop after the repair.
3. Compare it with active context using replace-before-add.
4. Create one evidence-backed proposal aggregate in proposals/.
5. Use pending_current_fix while repair is not verified; otherwise use
   proposed.
6. Keep evidence as workspace-relative pointers and short result summaries.
7. Evaluate authority, retention value, privacy, and the net active-context
   change.
8. For a workspace proposal, persist the full JSON PatchPlan under Proposed
   Patch and compute plan_hash from its canonical JSON.
9. Apply only through the policy and lifecycle below.

### $evolve approve

This is the only public approval/application entry point:

1. Parse the four-tilde JSON block under Proposed Patch / PatchPlan JSON.
   Reject prose-only or partial patch descriptions.
2. Recompute canonical JSON SHA-256 and require it to equal frontmatter
   plan_hash. Require target_files to equal the operation targets and every
   existing Decision/Apply hash to equal the same value. Require
   semanticOperation to equal frontmatter operation.
3. Show the complete target contents, operations, before hashes, policy result,
   context delta, and plan_hash.
4. Obtain explicit approval of that exact hash unless the proposal is eligible
   for auto.
5. Persist a Decision Log entry and status approved. If this write fails, stop
   before calling the kernel.
6. Recheck policy, paths, privacy, budgets, and before hashes.
7. Add runtime-only absolute workspaceRoot and planHash, then call
   applyPatchPlan(plan, {approvedPlanHash}). Approval stays outside the hashed
   plan and must match plan_hash exactly.
8. Let the kernel transaction update only the context targets and return its
   raw status, reason, and per-target hash operations.
9. Map that result to an Apply Attempt, add the attempt timestamp and a
   content-free error summary, then append it immediately. On success set
   status to applied; on conflict, failure, or rollback keep status approved.
10. If audit writeback fails, report audit_write_pending and retry it. Do not
   create a separate receipt or claim lifecycle completion.

If a target changes before any decision or attempt, replace the plan and
recompute its hash. After audit history exists, create a superseding proposal
instead; one aggregate never mixes hashes from multiple plans.
Without the kernel, propose mode may apply the exact human-approved patch, but
must still record hashes and the result.

A user-global promotion has no workspace PatchPlan before an adapter resolves
its real target. Store only a sanitized candidate hash, keep status proposed,
and defer exact approval to the adapter plan. Never send it to the workspace
kernel.

### $evolve review-context

Review active context against current sources. Use
references/cleanup-policy.md and references/context-budget.md.

- Rank authority separately from retention value.
- Detect stale, duplicated, conflicting, vague, or over-specific rules.
- Prefer tighten, merge, rewrite, supersede, or archive over another append.
- Produce an exact cleanup proposal with what behavior would be lost and the
  net context change.
- Require human approval for every semantic removal or replacement.

Thresholds trigger review and block auto; they never authorize truncation.

### $evolve weekly

Write a compact derived report in reports/ covering:

1. recurring signals and verification status
2. applied improvements
3. proposal triage
4. stale, redundant, or conflicting active context
5. recommended patches and cleanup
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

Read context_write_policy from config.yml:

- propose: create and show proposals; change active context only after approval.
- auto: use the same lifecycle without a human decision only when every
  low-risk auto gate in references/protocol-v1.md passes.

If an auto gate fails, keep the proposal and report:

~~~yaml
requested_policy: auto
effective_policy: propose
reason: <machine-readable-reason>
~~~

The agent or kernel must not weaken a failed gate.

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
