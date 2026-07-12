# Commit Kernel Runtime

This optional Node 20+ module is the deterministic `PatchPlan -> ApplyAttempt`
seam. It commits exact file content; it does not decide what project context
means.

## API

~~~js
import {
  applyPatchPlan,
  computePlanHash,
  sha256Text,
} from "./index.mjs";

const plan = {
  schemaVersion: 1,
  planId: "plan-example",
  proposalId: "proposal-example",
  workspaceRoot: process.cwd(),
  requestedPolicy: "auto",
  policy: "auto",
  policyReason: "all_auto_gates_passed",
  risk: "low",
  semanticOperation: "add",
  currentFixStatus: "verified",
  privacy: { safe: true },
  contextHealth: { autoAllowed: true },
  contextDelta: { activeLinesBefore: 120, activeLinesAfter: 124 },
  operations: [
    {
      type: "update",
      target: ".agent-context/PROJECT_PROFILE.md",
      beforeHash: sha256Text(previousContent),
      content: nextContent,
    },
  ],
};

plan.planHash = computePlanHash(plan);
const attempt = await applyPatchPlan(plan);
~~~

`computePlanHash` covers every JSON-serializable plan field except `planHash`
and runtime-only `workspaceRoot`, including the required policy result and
context delta. This lets the proposal persist a portable complete plan without
embedding a user-machine absolute path.
Create operations use `beforeHash: null`; update operations require the exact
lowercase SHA-256 of the current file.

For a human-approved plan, pass authorization outside the hashed object:

~~~js
const attempt = await applyPatchPlan(plan, {
  approvedPlanHash: plan.planHash,
});
~~~

The exact hash may authorize approval-only v1 targets or high-risk operations.
It never bypasses the verified-current-fix, complete-current-config, schema,
topology, path, migration-backup, or mechanical privacy safety gates. Proposal
aggregates are never kernel targets, even after exact approval.

## Result contract

The returned object contains:

- `schemaVersion`, `status`, `planId`, `proposalId`, and `planHash`;
- optional machine-readable `reason`;
- relative operation targets with before/after hashes;
- no patch content and no absolute workspace path.

Statuses are `applied`, `conflict`, `failed`, or `rolled_back`. The caller maps
the result into the proposal's Apply Attempts shape, adds the attempt timestamp,
and reports any audit writeback failure as `audit_write_pending`. The runtime
never creates a receipt directory.

## Safety boundary

Every non-migration call requires workspace `.agent-context/config.yml` to pass
the same complete v1 parser and validator used by repository verification. A
future schema remains read-only. Every proposed `config.yml` replacement must
also be a complete valid v1 envelope.

Without external approval, `auto` additionally requires that live config to
declare `context_write_policy: auto`. New workspace templates declare this by
default; the kernel never changes an existing policy. It accepts only low-risk,
verified,
privacy-declared, context-health-eligible writes to the active index, profile,
or checklists whose basename is present in `config.enabled_domains`, and only
when `semanticOperation` is `add`. It rejects traversal, symlink escape, stale
hashes, duplicate targets, config/archive/report targets, obvious credentials,
private keys, and user-home absolute paths. Proposal targets are rejected for
both automatic and approved plans.

Every archive target is create-only. Exact approval can create a new archived
snapshot but cannot rewrite existing history.

An approved `migration` accepts only a legacy-v0 source. Each updated existing
file must have byte-identical content in one matching
`.agent-context/archive/migrations/<migration-id>/...` create operation, and
the same transaction must produce a complete valid v1 config. Future or
malformed v1 schemas cannot enter this path.

All file targets are preflighted before staged replacements begin. If a later
replacement fails, earlier replacements are rolled back where possible. A
failed rollback is reported and is never presented as applied.

The runtime serializes cooperative writers with the reserved file
`.agent-context/.commit-kernel.lock` and rechecks targets after acquiring it.
A concurrent caller receives `conflict / commit_locked`. A process crash may
leave a stale lock; the runtime never deletes one based only on age. After
verifying that no kernel process is active for that workspace, remove that
exact workspace-relative lock manually and rerun the plan. A lock-release
ownership failure is returned explicitly as `lock_release_failed`.
