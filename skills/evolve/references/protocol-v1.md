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
The Coordinator-owned `runtime/lifecycle-contract.mjs` is the single read-only
source for Coordinator outcome shapes, transition validity, and settled-state
derivation; the Coordinator and Evolution Outcome module both consume it. The
Outcome module owns only cross-stage validation, content-safe normalization,
unsafe-detail removal, and receipt formatting. The kernel and outcome module
must not classify project meaning; the kernel must not mutate the proposal
aggregate or claim to validate its lifecycle.

The Context Compiler owns only deterministic, read-only selection of existing
Active Context from co-located routing metadata and a structured task
signature. It may derive bounded attention from valid non-terminal proposal
frontmatter, but its bounded scanner never parses or emits proposal body,
judges proposal truth, performs lifecycle reconciliation, or writes the
workspace. The Agent owns the task signature and every semantic decision
prompted by attention.

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
- Evolution Outcome: an ephemeral, content-safe delivery result covering the
  Agent-owned detect/propose stages and mechanically evidenced apply stage.
- Active Context: short, current guidance eligible for ordinary work.
- Context Compiler: the read-only runtime that renders complete core plus
  selected task packs, or falls back to the complete legacy read set.
- Context block: a core or routed pack co-located with its Markdown guidance.
- Catalog: an ephemeral description derived from context block metadata, never
  a separate persisted truth source.
- Selected: a pack matched by hard task signals, safety policy, or an explicit
  exact request. Selection does not prove model loading or material use.
- Proposal attention: a bounded, non-authoritative pointer from valid
  non-terminal proposal frontmatter to selected context or rule IDs.
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

The legacy full default read set is the index, profile, and task-relevant
enabled checklists. A compatible adapter may instead give the model one
ephemeral Context Compiler payload containing task-relevant core and unmarked
content plus selected packs. Task-signature domains identify the relevant
enabled checklists; an empty list conservatively reads all enabled checklists
and treats every enabled domain as eligible during matching. Proposal body,
reports, and archive remain opt-in reads.

The host-side catalog scan covers every enabled checklist so context block IDs
remain workspace-global and exact requested packs can be resolved without a
second registry. Ordinary hard matching is limited to the task-relevant read
set. An exact request expands the read to the requested pack's source checklist;
high-risk selection includes all safety packs in the task-relevant set. The
legacy byte baseline expands with an exact request but otherwise remains the
same task-relevant full read set.

## Progressive context compilation

Invoke the deep runtime API with one workspace root and a content-safe task
signature:

~~~text
compileWorkspaceContext({ workspaceRoot, taskSignature })
~~~

The signature has this exact shape:

~~~json
{
  "schemaVersion": 1,
  "operations": [],
  "paths": [],
  "tools": [],
  "skills": [],
  "domains": [],
  "risk": "normal",
  "requestedPacks": []
}
~~~

`risk` is `normal` or `high`. Paths are workspace-relative. The signature does
not contain the raw prompt, conversation, source content, secrets, or absolute
user paths.

The result contract is:

~~~text
schemaVersion: 1
status: compiled | fallback | blocked
mode: progressive | legacy_full | none
reason: bounded machine-readable reason
content: complete model-visible UTF-8 payload
catalog: derived bounded catalog
selectedPackIds: ordered context pack IDs
selections: content-safe selection explanations
attention: zero to three bounded proposal pointers
metrics:
  fullContextBytes
  modelVisibleBytes
  savedBytes
  reductionBasisPoints
warnings: bounded content-safe warnings
~~~

A compatible consumer must expose only `content` to the model; the remaining
fields are host-side diagnostics. `content` already includes the rendered
catalog and attention needed by the Agent. Metrics compare UTF-8 bundle bytes;
they must not subtract catalog or attention bytes and do not prove token savings
without compatible host injection.

### Context block contract

A block is enclosed in paired Markdown comments. The opening comment contains
strict single-line JSON:

~~~md
<!-- acp-context: {"schemaVersion":1,"id":"workspace-safety","kind":"core","description":"Safety and authority invariants."} -->
## Safety

- Verify current sources before using point-in-time project facts.
<!-- /acp-context -->
~~~

Core metadata contains exactly `schemaVersion`, `id`, `kind: "core"`, and
`description`. Pack metadata also contains `priority: "normal" | "safety"` and
one non-empty `match` object. Supported match selectors are `operations`,
`pathPrefixes`, `pathBasenames`, `tools`, `skills`, `domains`, and `risks`.
Within one present selector, any listed value may match; across present
selectors, every selector must match. Selector semantics are deterministic and
must not be replaced by model judgment, embeddings, or free-text keyword
ranking.

Core blocks and content outside marked blocks in the task-relevant read set are
always included. Normal packs are included when their hard selectors match or
their exact ID appears in
`requestedPacks`. A high-risk task additionally includes every safety-priority
pack in the task-relevant read set. Pack IDs are unique within the workspace.
The catalog is reconstructed from these same blocks for every compilation; no
catalog file is written. Progressive compilation accepts at most 64 context
blocks. Overflow returns the complete legacy read set without a rendered
catalog.

### Rule marker and attention identity contract

A newly written Active Context rule uses one exact canonical single-line
marker immediately above the rule:

~~~md
<!-- acp-rule: <source>#<positive ordinal>; source: <source>; subsumes: none -->
~~~

`source` is the source proposal ID, and the stable canonical logical identity
is `<source>#<positive ordinal>`. A replacement may put a comma-separated list
of canonical rule IDs in `subsumes`. New writes must use this form.

For reader compatibility only, the compiler also accepts the historical exact
single-line spelling:

~~~md
<!-- acp-rule: id=<source>-<positive ordinal> source=<source> subsumes=<rule-id-list-or-none> -->
~~~

It normalizes both marker spellings, and both
`rule:<source>#<positive ordinal>` and
`rule:<source>-<positive ordinal>` attention edges, to the canonical logical
identity. It does not migrate or rewrite historical markers. A rule found in
enabled Active Context is known even when its pack is not selected for the
current task; it is irrelevant to that compilation, not dangling.

A malformed, bounded-unclosed, or duplicate logical `acp-rule` identity is
routing ambiguity and forces the complete legacy read set at every risk level.
An oversized marker, an incomplete bounded marker scan, or credential-shaped
`acp-rule` metadata instead returns `blocked / none` with empty content, so
uninspected or unsafe bytes are not echoed through fallback. One compilation
accepts at most 512 marker candidates across the complete enabled Active
Context catalog. `acp-rule` detection is deliberately lexical and does not
interpret Markdown fences or indentation: marker-like examples remain metadata
candidates and must use a non-exact placeholder spelling.

No usable `acp-context` routing marker, malformed or overlapping context
markers, duplicate context IDs, unsupported metadata, unsafe or ambiguous
paths, an unknown explicitly requested pack, a
high-risk task without usable safety coverage, or another routing ambiguity
must never cause partial omission. The result falls back to the complete legacy
full read set. At normal risk, excess relevant attention is represented by the
first three deterministic items plus a bounded warning. At high risk, attention
overflow, unrouted non-terminal proposals, or an incomplete bounded proposal
scan forces complete fallback plus a manual-inspection hint. At normal risk, a
globally incomplete bounded proposal scan suppresses every attention pointer
while leaving the independently compiled context projection available, because
the scanner cannot prove global proposal-ID uniqueness. If any enabled
checklist is missing, unreadable, invalid UTF-8, or has unsafe topology, even
the global catalog scan cannot be performed and the compiler returns
`blocked / none` with no invented context. Credential-shaped routing metadata
also blocks with empty content instead of being echoed through fallback.

### Proposal attention contract

Schema 1 proposal frontmatter may optionally contain:

~~~yaml
attention_targets:
  - context:<context-block-id>
  - rule:<stable-acp-rule-id>
~~~

Only valid `pending_current_fix`, `proposed`, and `approved` workspace proposal
frontmatter is eligible. The bounded prefix scanner parses only frontmatter and
never emits proposal body, PatchPlan, Decision Log, or Apply Attempt content. It
invokes no Lifecycle Reconciliation and returns at most three relevant items
with bounded identity and status metadata.

Attention is a reason to verify current sources, not a truth claim, approval,
or Active Context rule. At normal risk, the compiler returns the first three
deterministically ordered matches and a bounded overflow warning. At high risk,
more than three relevant proposals or any non-terminal proposal without an
explicit attention edge forces `legacy_full` plus a bounded manual-inspection
hint rather than silently choosing winners or assuming the unrouted proposal is
irrelevant. An incomplete bounded scan has the same high-risk fallback. At
normal risk a globally incomplete scan suppresses all attention pointers rather
than exposing an identity that an uninspected proposal could duplicate.
Existing proposals are not backfilled and edges are never inferred; at normal
risk, a non-terminal proposal without `attention_targets` produces only a host
warning, not an attention item.

An attention target is dangling only when its context or normalized rule
identity is absent from enabled Active Context. At normal risk, a dangling
target produces a bounded unresolved-edge warning and no pointer for that
target; another unambiguous known target on the same proposal may still
surface. At high risk, any dangling target forces `legacy_full`. A known rule in
an unselected pack is simply irrelevant and does not trigger either behavior.

Duplicate proposal IDs and two aliases for one logical rule in the
same proposal never produce an ambiguous pointer. They make the bounded
attention scan incomplete: normal risk suppresses the ambiguous pointer and
warns, while high risk forces `legacy_full`.

### Compatibility and activation

Context compilation is ephemeral and read-only. It does not call the Commit
Kernel, acquire lifecycle locks, write a catalog or receipt, emit telemetry, or
run from a daemon or background scan. Existing unmarked workspaces remain valid
and use `legacy_full`. Reclassifying existing core or unmarked content into a
routed pack changes its visibility and therefore requires a reviewed semantic
cleanup proposal; there is no bulk migration.

Kit update and Bootstrap never rewrite an existing instruction file or workspace
index. An older workspace therefore does not silently enable progressive
loading when the installed skill changes. A fresh-install workflow may propose
the updated adapter instruction for separate semantic review; existing adapters
also require that separately reviewed patch. The v0.6.1 repair changes only
`acp-rule` identity parsing and proposal-attention resolution; it does not
change the `acp-context` grammar or claim to repair unrelated context-fence or
cross-line behavior.

The Kit installs no platform or pre-first-model-call hook. The compiler itself
makes no model call, and deterministic byte fixtures validate only the API and
bundle comparison. Actual model-context or token savings require a compatible
host to invoke the API and inject only `content`.

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

When an exact plan reaches `applied`, reconciliation repeats over the stable
proposal cohort until one pass performs no new successful application. Each
proposal contributes only its latest outcome, while an applied transition is
retained after that proposal becomes terminal. The returned status therefore
describes state after the coordinator's own writes rather than the order in
which proposal filenames were inspected. If the call applied work, it returns
`postApplicationVerified: true` only after the final pass observes no new
successful application.

A result may be `settled` while listing `approval_required`: ordinary current
approval-only proposals are intentionally waiting for review and do not block
unrelated evolve workflows. Unsafe auto, stale, mixed, malformed, or audit-gap
outcomes remain blocking.

Proposal audit writes use `.agent-context/.lifecycle-coordinator.lock`, a
source-hash compare-and-swap check, a same-directory temporary file, and atomic
replacement. A transient replacement failure retries the same validated audit
source once in the same process, and an uncertain post-rename result is checked
idempotently against the desired source hash. A lock is never deleted based on
age. After verifying no coordinator is active, remove that exact lock manually
if a crashed process left it behind. Reconciliation creates no receipt sidecar
and never runs as a daemon, startup hook, installer scan, or update scan.

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

A mechanical likely-secret match is a hard rejection until redacted. Human
approval cannot override this safety failure.

## Evolution Outcome

After the current fix is verified, run one delivery checkpoint only when at
least one high-signal event occurred:

- `failed_verification_later_passed`
- `explicit_user_correction`
- `independent_qa_defect`
- `stale_context`
- `first_fix_failed_then_passed`

The Agent supplies semantic `detect` and `propose` results. The production
Outcome Interface accepts those stages plus an optional content-safe proposal
ID and the exact Lifecycle Coordinator result:

~~~text
finalizeEvolutionOutcome({ detect, propose, proposalId?, reconciliation? })
~~~

It returns this task-level contract plus one formatted `receipt`:

~~~text
schemaVersion: 1
detect:  { status, reason }
propose: { status, reason }
apply:   { status, reason }
proposalId?: content-safe identifier
targets?: sorted workspace-relative paths
receipt: { kind, text }
~~~

Statuses are:

- detect: `candidate | no_candidate | skipped`
- propose: `created | not_needed | blocked`
- apply: `applied | approval_required | blocked | not_attempted`

Every reason is one stable, bounded lowercase machine token. Token syntax alone
does not establish privacy: credential-like prefixes/values, long mixed
alphanumeric segments, and conversation-detail markers are rejected from
reasons, proposal IDs, and every relative target segment before receipt
formatting. The valid cross-stage families are:

| Situation | detect | propose | apply |
|---|---|---|---|
| Trigger ran; no reusable lesson | `no_candidate` | `not_needed` | `not_attempted` |
| Trigger cannot be evaluated safely | `skipped` | `blocked` | `not_attempted` |
| Candidate cannot become a valid proposal | `candidate` | `blocked` | `not_attempted` |
| Eligible automatic proposal completes | `candidate` | `created` | `applied` |
| Valid proposal needs a human decision | `candidate` | `created` | `approval_required` |
| Valid proposal hits a mechanical blocker | `candidate` | `created` | `blocked` |
| Existing proposal is reconciled | `skipped(existing_proposal)` | `not_needed(existing_proposal)` | `applied | approval_required | blocked` |

Every other combination fails closed as `invalid_evolution_outcome`. An
`applied` outcome additionally requires a valid proposal ID, settled
reconciliation, one exact Coordinator outcome, a non-terminal-to-applied exact
resume action, reason `applied`, consistent Coordinator accounting, and at
least one safe relative target. Reconciliation containing an applied transition
must also prove it completed its post-application observation pass with
`postApplicationVerified: true`. Every inspected Coordinator outcome must also
have its complete content-safe shape and a valid action/status relationship.
Matching target bytes, a terminal-to-terminal pseudo transition, missing audit
evidence, or one applied proposal inside an otherwise blocked workspace cannot
produce an applied receipt.

The receipt is one line covering `detect`, `propose`, and `apply`; each
non-success status carries its reason. An applied receipt also includes the
content-safe proposal ID and relative targets. Approval reports one concise
exception. A blocker includes one machine reason and a safe next-action token
when known. The receipt contains no lesson prose, proposal prose, PatchPlan or
target content, secret, conversation data, or absolute path.

If there is no high-signal trigger, emit no receipt and create no proposal or
durable context write merely to record a no-op. `skipped` is available for an
explicit diagnostic. Evolution Outcomes are ephemeral task results; proposal
aggregates remain the only durable audit source. There is no receipt sidecar,
new public command, daemon, startup hook, background scan, telemetry, or
Workspace Schema migration.

## Active context health

Before preparing an add, compare it to active context:

- no match: add may be appropriate
- same meaning: add evidence, not another active rule
- partial overlap: tighten, merge, or rewrite
- conflict: supersede through human approval
- lower-value lesson: keep it in the proposal history
- old material is only an example: archive the example and retain a short rule

Moving existing core or unmarked guidance into a pack, changing selectors, or
lowering a pack from safety priority is a semantic routing change. Record which
tasks may lose default visibility and require human approval. Adding routing
metadata is never a reason for an unreviewed bulk rewrite.

Quantity thresholds schedule review and block auto. Semantic authority and
retention value determine the proposed cleanup. No threshold authorizes
automatic truncation or deletion.
