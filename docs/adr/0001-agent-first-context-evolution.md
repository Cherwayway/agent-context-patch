# ADR-0001: Agent-first context evolution with a thin commit kernel

- Status: accepted
- Date: 2026-07-10
- Decision owners: repository maintainers and user

## Context

The initial scaffold expresses the evolution workflow in Markdown, templates,
two installer scripts, and static demo fixtures. Its product direction is
sound, but scope, write policy, proposal states, installation promises, and
verification are spread across several files. The existing test proves that
tokens exist rather than that the user journey works.

The design must preserve the adaptability of flagship Agents across coding,
PRD, SEO, and non-code workspaces while making automatic writes deterministic,
auditable, and reversible.

## Decision

### 1. Agent-first execution

The Agent owns semantic work:

- decide whether a lesson is reusable;
- judge evidence quality;
- choose wording, domain, and target;
- draft PatchPlans and cleanup proposals.

A thin deterministic Commit Kernel owns only mechanical invariants:

- supported plan shape;
- allowed workspace targets;
- write-policy guards;
- apply-result status;
- plan and file hashes;
- conflict detection;
- staging, commit, rollback, and ApplyAttempt output.

`propose` remains usable without Node. `auto` requires the kernel and explicitly
downgrades to `propose` when the kernel is unavailable. Before every automatic
commit, the kernel re-reads v1 workspace config to verify that `auto` is
explicitly enabled and that checklist targets belong to enabled domains.

### 2. Scope

`workspace` is the only active writable v1 scope. `user-global` is an approved
promotion destination handled by an Agent adapter, never an automatic Commit
Kernel target. `repo`, `team`, and `kit` are not public v1 scopes.

### 3. Write policy

Only two policies exist:

- `propose`: create an evolution record and wait for an exact approval;
- `auto`: automatically apply only low-risk workspace create/update plans after
  all kernel guards pass.

The former `notify` policy is removed because every automatic write must return
an ApplyAttempt and therefore has no distinct behavior. Delete, archive, supersede,
migration, instruction-file, domain-activation, and promotion operations always
require human approval.

### 4. Approval and application

`$evolve approve` remains one public Agent action. Internally it:

1. presents an immutable PatchPlan;
2. records a Decision bound to `planHash`;
3. enters `approved`;
4. passes the approved hash to the Commit Kernel as authorization outside the
   PatchPlan, avoiding a self-referential hash;
5. revalidates targets and hashes;
6. commits the plan;
7. appends the returned ApplyAttempt to the proposal;
8. enters `applied` only after success.

A conflict or failure leaves the proposal approved with a failed ApplyAttempt.
A changed plan requires new approval. V1 does not add a separate public
`$evolve apply` command. Decision Log and Apply Attempt entries are deliberately
outside `planHash`; the Agent writes them to the proposal around the kernel
call. If that audit write fails, it reports and retries the audit gap instead
of creating a separate receipt source of truth.

The persisted PatchPlan contains complete replacement content and
workspace-relative targets. The Agent injects the absolute `workspaceRoot` only
for the runtime call; `workspaceRoot` is excluded from `planHash` so private
machine paths are neither persisted nor part of the approval artifact.

### 5. Installation

Installation is Agent-orchestrated. The Agent detects the environment, resolves
current Agent skill locations, and prepares semantic instruction patches. A
deterministic Bootstrap module plans and applies only file operations.

PowerShell and Bash are real platform adapters. They share the same plan fields,
conflict rules, and contract tests. They never merge existing `AGENTS.md` or
`CLAUDE.md` automatically.

The skill and optional Commit Kernel install user-level by default. The short
guidance fragment and `.agent-context/` install workspace-local by default. A
global trigger is explicit opt-in.

### 6. Runtime capability

Node is not required to install the templates, read context, or use `propose`.
Native PowerShell/Bash Bootstrap remains available without Node. Node is the
single Commit Kernel implementation for `auto`; no second PowerShell or Bash
commit implementation is maintained.

### 7. Versioning and migration

V1 config declares `schema_version: 1`. Unversioned context is `legacy_v0` and
read-only. Migration requires a reviewed MigrationPlan, an exact approval,
workspace-local backup, and an ApplyAttempt. Migration never fabricates missing
historical decisions or receipts.

### 8. Domain activation

Agents may detect domain candidates automatically, but activation is part of a
reviewed InitPlan. `config.enabled_domains` is the only activation source of
truth. Profiles are summaries and checklists are materialized views. `auto`
cannot activate or deactivate domains.

### 9. Context health

Every proposed addition first performs replace-before-add analysis. Quantity is
a review trigger, not a deletion rule. Cleanup proposals use two qualitative
dimensions:

- authority: which evidence wins a conflict;
- retention value: whether the rule remains current, specific, reusable, and
  worth its context cost.

Overlapping or conflicting changes downgrade `auto` to `propose`. Semantic
merge, rewrite, supersede, and archive actions require approval. Budget ceilings
block automatic accumulation but never truncate context.

### 10. Information topology

One proposal Markdown file is the evolution aggregate. It owns the observed
failure, evidence, proposed patch, context priority, append-only Decision Log,
Apply Attempts, supersession, and rejection notes.

There is no separate `mistakes/` or `receipts/` source of truth. Reports are
derived and archives are inactive. Ordinary tasks read only the context index,
profile, and relevant enabled checklists. Per-run `contextRead` is not appended
to the active profile.

### 11. Evidence privacy

Persist verification pointers and short summaries before excerpts. Store
workspace-relative paths. Do not persist raw conversations, full logs, secrets,
credentials, customer data, or unnecessary personal details. User-global
promotion removes workspace-specific identifiers. The kernel may block obvious
mechanical privacy hazards, including on approved plans, but does not claim
semantic privacy understanding.

### 12. Verification

The repository keeps one `npm test` interface. Its implementation exercises:

- the real demo test;
- valid and invalid v1 records;
- Commit Kernel file outcomes and failure behavior;
- Bootstrap dry-run, apply, idempotency, and preservation;
- platform line-ending/syntax contracts;
- stale placeholders, product names, and version consistency.

CI runs the same interface on Windows and Ubuntu.

## Consequences

- Semantic flexibility stays with the Agent.
- Automatic writes have a small, deterministic test surface.
- Non-code workspaces retain a no-Node proposal path.
- The workspace format becomes versioned and migration-aware.
- Some previous config keys, scopes, and directories are intentionally removed.
- Installation has two coordinated outputs: deterministic file operations and
  a separately reviewed semantic guidance patch.

## Rejected Alternatives

- **Pure Agent-native automatic writes**: too weak for hashes, conflicts,
  lifecycle consistency, and rollback.
- **Fully executable protocol core**: would encode project semantics and reduce
  adaptability.
- **Three write policies**: `notify` adds interface without distinct safe
  behavior.
- **Repo/workspace/team/kit scopes in v1**: no real storage adapters justify the
  extra seams.
- **Separate approve/apply commands**: exposes transaction ordering to users.
- **PowerShell and Bash commit kernels**: duplicates safety-critical policy.
- **Hard context truncation**: quantity cannot determine semantic priority.
- **Separate mistake and receipt stores**: splits one evolution aggregate into
  competing truths.
