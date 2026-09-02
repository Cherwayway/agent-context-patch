# Runtime Modules

This optional Node 20+ runtime contains four deep deterministic
responsibilities. The Context Compiler renders task-local Active Context
without writing the workspace. The Commit Kernel owns the
`PatchPlan -> ApplyAttempt` seam. The Lifecycle Coordinator settles unfinished
proposal audit around that seam.
Its internal `lifecycle-contract.mjs` is the single read-only source for
Coordinator outcome shapes, transitions, and settled-state derivation. The
Evolution Outcome module consumes that contract and formats the ephemeral
detect-to-apply delivery result. None decides what project context means.

## Context Compiler API

Import the compiler directly from its deep module:

~~~js
import { compileWorkspaceContext } from "./context-compiler.mjs";

const result = await compileWorkspaceContext({
  workspaceRoot: process.cwd(),
  taskSignature: {
    schemaVersion: 1,
    operations: ["review"],
    paths: ["src/example.mjs"],
    tools: [],
    skills: [],
    domains: ["coding"],
    risk: "normal",
    requestedPacks: [],
  },
});
~~~

The signature contains structured, content-safe hints only. Paths are
workspace-relative; do not pass a raw prompt, conversation, source content,
secret, or absolute user path. `domains` identifies the task-relevant enabled
checklists; an empty list conservatively reads every enabled checklist and uses
every enabled domain during matching. The host-side catalog scan covers every
enabled checklist to enforce workspace-global block IDs. Ordinary hard matching
stays within the task-relevant set. Exact requests expand the read to the source
checklist; high-risk selection includes all task-relevant safety packs.

The returned object has this exact top-level contract:

~~~text
schemaVersion: 1
status: compiled | fallback | blocked
mode: progressive | legacy_full | none
reason
content
catalog
selectedPackIds
selections
attention
metrics:
  fullContextBytes
  modelVisibleBytes
  savedBytes
  reductionBasisPoints
warnings
~~~

A compatible consumer must expose only `content` to the model; every other field
is host-side diagnostics. `content` contains task-relevant core and unmarked
guidance, the rendered bounded catalog and attention surface, and the packs
selected by deterministic hard signals or exact request. Metrics compare UTF-8
bundle bytes; catalog and attention bytes are not excluded from
`modelVisibleBytes`.

Active Markdown uses paired comments with strict single-line JSON:

~~~md
<!-- acp-context: {"schemaVersion":1,"id":"workspace-safety","kind":"core","description":"Safety and authority invariants."} -->
## Safety
- Verify current sources before using point-in-time project facts.
<!-- /acp-context -->
~~~

Core metadata contains `schemaVersion`, `id`, `kind: "core"`, and
`description`. A pack additionally carries `priority: "normal" | "safety"`
and a non-empty `match` object. Supported selectors are `operations`,
`pathPrefixes`, `pathBasenames`, `tools`, `skills`, `domains`, and `risks`.
Within one selector values are OR; across selectors that are present the match
is AND. The catalog is derived from these same blocks and is never written as a
separate file. Progressive compilation accepts at most 64 context blocks;
overflow returns the complete legacy read set without a rendered catalog.

Normal packs are selected by hard matches or exact `requestedPacks`; high-risk
tasks also select task-relevant safety packs. The compiler keeps content
outside blocks and core blocks from the task-relevant read set. Missing or
invalid markers, duplicate IDs, unknown explicit pack requests, unsafe path
state, or missing high-risk safety coverage cause
fallback to the complete legacy default read set. At normal risk, attention
overflow keeps the first three deterministic items plus a warning. At high risk,
overflow, any non-terminal proposal without an explicit edge, or an incomplete
bounded proposal scan forces complete fallback. It never returns a partial best
guess. If any enabled checklist is missing, unreadable, invalid UTF-8, or has
unsafe topology, the result is `blocked / none`. Credential-shaped routing
metadata also blocks with empty content instead of entering fallback output.

Proposal attention comes only from valid workspace proposal frontmatter with
status `pending_current_fix`, `proposed`, or `approved` and exact
`attention_targets`. The bounded prefix scanner parses only frontmatter and
never emits proposal body. It returns at most three content-safe pointers,
invokes no Lifecycle Reconciliation, and performs no write. Existing proposals
are not backfilled and edges are never inferred. Attention always requires
current-source verification and is never treated as Active Context or approval.

This module makes no model or network call, acquires no commit/lifecycle lock,
emits no telemetry, and persists no catalog, compiled payload, metric, or
receipt. Existing unmarked Schema 1 workspaces use `legacy_full`; there is no
automatic marker migration. v0.6.0 installs no platform or pre-first-model-call
hook. Actual model-context or token savings depend on a compatible host
injecting only `content`; deterministic byte fixtures alone do not establish
them.

## Commit Kernel API

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

## Lifecycle Coordinator API

Import the coordinator directly from its deep module; `index.mjs` intentionally
remains the three-export Commit Kernel interface:

~~~js
import { reconcileWorkspaceProposalLifecycles } from "./lifecycle.mjs";

const result = await reconcileWorkspaceProposalLifecycles({
  workspaceRoot: process.cwd(),
});
~~~

The coordinator scans non-terminal `.agent-context/proposals/*.md` aggregates,
validates them with the production proposal contract, and compares complete
PatchPlan targets with live hashes. It can:

- resume an interrupted exact `auto` plan;
- resume an already-human-approved exact plan while all before hashes match;
- report semantic regeneration, supersession, audit recovery, or manual
  recovery without changing target meaning;
- move a never-applied stale approval to `superseded` only after its final
  Attempt is a recognized stale conflict and its named valid replacement
  proposal exists.

The result contains `status`, `inspectedCount`, and content-safe outcomes with
proposal ID, before/after status, action, machine-readable reason, and relative
targets. A workspace-level failure may add `blockingReason`. No outcome includes
proposal prose, PatchPlan content, target content, or an absolute path.

If reconciliation applies exact work, it re-reads the stable proposal cohort
until a pass performs no new successful application. The final result therefore
reflects target and policy state after the coordinator's own writes, independent
of proposal filename order. It retains one latest outcome per inspected
proposal, including the applied transition for a proposal that became terminal.
Such a result includes `postApplicationVerified: true` only after a successful
application is followed by a pass with no new successful application.

`status: settled` means no unsafe mechanical lifecycle gap remains. It can still
contain `approval_required` outcomes; those proposals are intentionally waiting
for informed human review and do not block unrelated reconciliation, weekly
reporting, or new failure handling.

Matching `afterHash` without an applied Attempt is
`audit_recovery_required`, never inferred application. Mixed before/after state
requires manual recovery. Changed history-free proposals are left to the Agent
for semantic regeneration.

Proposal writes use `.agent-context/.lifecycle-coordinator.lock`, validate the
complete post-write aggregate, compare the source hash twice, write an exclusive
same-directory `.tmp` file, and atomically rename it. A transient replacement
failure retries the exact same audit source once in-process; an uncertain
post-rename error is recognized idempotently from the desired source hash. The
lock is ownership-token based and is never deleted by age. After confirming no
coordinator is active, remove that exact workspace-relative lock manually after
a crash. There is no lifecycle daemon, startup scan, sidecar receipt, or
alternate source of truth.

## Evolution Outcome API

Import the Outcome Interface directly from its deep module. The Agent supplies
semantic `detect` and `propose`; a proposal path supplies the exact Lifecycle
Coordinator result as mechanical evidence:

~~~js
import { finalizeEvolutionOutcome } from "./outcome.mjs";

const outcome = finalizeEvolutionOutcome({
  detect: { status: "candidate", reason: "stale_context" },
  propose: { status: "created", reason: "proposal_created" },
  proposalId: "proposal-example",
  reconciliation,
});
~~~

`lifecycle.mjs` and `outcome.mjs` both consume the Coordinator-owned
`lifecycle-contract.mjs`. Do not restate its action/status transition table in
either caller.

The result contains `schemaVersion`, the three `{ status, reason }` stages,
optional content-safe `proposalId`, optional sorted workspace-relative
`targets`, and one fixed-format `receipt`. It rejects invalid state families and
cannot report `applied` unless settled Coordinator evidence proves one exact
non-terminal-to-applied resume with an applied audit and at least one safe
target. Applied evidence must also carry `postApplicationVerified: true`; this
prevents a pre-fixed-point result from authorizing success. Every inspected
outcome must have the complete content-safe Coordinator shape and a valid
action/status relationship. Missing, malformed, ambiguous, blocked, or
partially consistent evidence becomes a content-safe blocker instead of a
success claim.

The module copies no proposal prose, PatchPlan content, target content,
conversation data, or absolute path. Unsafe lifecycle targets are removed. It
also rejects every relative target segment and other bounded token fields that
resemble credentials, high-entropy values, or encoded conversation detail. It
does not read or write the workspace and creates no receipt file; the proposal
aggregate remains the durable audit source. An ordinary task with no high-signal
trigger does not invoke the
Interface and stays silent.

## Commit Kernel result contract

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
