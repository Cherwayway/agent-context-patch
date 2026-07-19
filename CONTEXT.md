# Agent Context Patch Domain Context

## Purpose

Agent Context Patch turns reusable, evidence-backed lessons into small,
reviewable workspace context. It fixes the current task first and never treats
context growth as success by itself.

## Ubiquitous Language

- **Workspace**: the only active writable scope in v1. It may be a Git repo, a
  multi-repo directory, or a non-code folder.
- **Active Context**: files ordinary tasks may read by default: the context
  index, project profile, and enabled checklists.
- **Proposal**: the internal evolution aggregate for one lesson. It owns the
  evidence, exact patch, decision log, and apply attempts; it is not a default
  user approval inbox.
- **PatchPlan**: the exact, immutable file operations prepared for application.
  A decision binds to its `planHash`. It persists workspace-relative targets;
  the absolute runtime workspace root is injected only at apply time.
- **Decision**: an automatic policy decision, approval, or rejection of one
  PatchPlan.
- **ApplyAttempt**: the result of committing an authorized PatchPlan, including
  relative targets and before/after hashes but not duplicated patch content.
- **Lifecycle Reconciliation**: a deterministic pass over unfinished proposals
  that compares each immutable PatchPlan with live target hashes, resumes only
  exact safe work, and reports semantic or audit recovery to the Agent.
- **Lifecycle Coordinator**: the deep runtime module that performs Lifecycle
  Reconciliation around, but not inside, the Commit Kernel.
- **Promotion**: an approved proposal to generalize a workspace lesson into
  user-level guidance. User-global context is never an active v1 write scope.
- **Domain Candidate**: an Agent-detected domain with evidence and confidence.
- **Enabled Domain**: a user-approved domain recorded in config. Only enabled
  domains materialize active checklists.
- **Authority**: which evidence wins when context conflicts.
- **Retention Value**: whether a rule still earns space in Active Context.
- **Legacy Workspace**: an unversioned `.agent-context/` tree. It is read-only
  until an approved migration is applied.
- **Kit Version**: the semantic version of one Agent Context Patch
  distribution. It identifies product behavior and is independent of durable
  workspace compatibility.
- **Workspace Schema**: the versioned compatibility contract for durable
  workspace context. It changes only when existing context needs migration,
  not whenever the Kit Version changes.
- **Release**: an immutable, published distribution of exactly one Kit
  Version. A development branch or moving source snapshot is not a Release.
- **Upgrade Plan**: the exact, reviewable proposal for replacing one installed
  Kit Version with another, including exact installed/candidate managed-tree
  identities, replacement scope, and recovery expectations. Its approval does
  not authorize a Workspace Schema migration.
- **Feedback Signal**: a privacy-minimized, reproducible observation from real
  use that can justify or evaluate an iteration. Raw conversations, full logs,
  and untested ideas are not Feedback Signals.

## Deep Modules And Seams

- `$evolve` is the Agent-facing interface for `init`, `after-failure`,
  `approve`, `review-context`, `weekly`, and `update`.
- The **Commit Kernel** accepts a PatchPlan plus optional external approval and
  returns an ApplyAttempt. Approval carries the reviewed `planHash` outside the
  plan, avoiding a self-referential hash. The kernel owns path safety, policy
  guards, hashes, conflict detection, staging, and rollback.
- The **Lifecycle Coordinator** accepts only a workspace root. It validates
  proposal aggregates, classifies live targets as before/after/mixed/changed,
  resumes exact automatic or already-approved plans through the Commit Kernel,
  and writes proposal audit state with a lock plus source-hash CAS. It never
  chooses wording, generates a replacement plan, or infers an applied audit.
- The **Bootstrap module** plans and applies deterministic skill/template file
  operations. PowerShell and Bash are its two platform adapters.
- Codex and Claude guidance files are two Agent adapters. They remain short and
  load the full skill only when needed.
- `npm test` is the repository verification interface. Tests cross public seams
  and must exercise observable file outcomes, not merely search for tokens.

## Hard Invariants

1. Repair and verify the current task before applying long-term context.
2. V1 writes Active Context only inside the approved workspace
   `.agent-context/` root.
3. New workspaces default to `auto`; eligible low-risk additions complete in
   the current Agent turn through the Node Commit Kernel. Existing workspace
   config remains authoritative.
4. Missing kernel capability downgrades `auto` to `propose` explicitly.
5. Delete, archive, supersede, migration, instruction-file, and promotion
   operations always require human approval.
6. `$evolve after-failure` completes eligible auto plans without another user
   turn. `$evolve approve` is the exception path; both paths still record
   separate `approved` and `applied` states.
7. Every apply requires `currentFixStatus: verified`; approval cannot bypass
   verification, supported topology, path, or privacy guards.
8. The proposal aggregate is never a PatchPlan target. Its Decision Log and
   Apply Attempts stay outside the Commit Kernel boundary.
9. Unfinished proposals are reconciled before new proposal work. Exact
   authorization remains reusable only while every target is still at its
   `beforeHash`; a live `afterHash` without an applied Attempt is an audit
   recovery blocker, not proof of application.
10. An approved proposal that never applied may become `superseded` only after
    a real stale-target conflict and only when the named valid replacement
    proposal exists.
11. A non-migration commit requires one complete, valid v1 workspace config.
   Future schemas remain read-only; a legacy migration must create exact
   workspace-local backups in the same transaction.
12. Bootstrap also validates the complete v1 config envelope without requiring
    Node. Invalid current-looking config is blocked before any template write.
13. Archive content is append-only history: every archive target is
    create-only, including after exact approval.
14. Any target content, operation, policy result, or context-delta change
   invalidates the approved plan hash.
15. Domain detection is semantic and temporary; activation is approved and
   persisted only in `config.enabled_domains`.
16. Replace before add. Overlap or conflict forces a cleanup proposal instead of
   automatic accumulation.
17. Quantity triggers context review; authority and retention value decide what
    should change. Context is never truncated automatically.
18. Persist evidence pointers and summaries, not raw conversations or complete
    logs. Use workspace-relative paths.
19. Existing instructions, explicit workspace policy, and legacy context are
    never silently overwritten.

## Repository Reading Map

- `docs/adr/0001-agent-first-context-evolution.md`: original architecture.
- `docs/adr/0003-auto-first-low-risk-context.md`: current default write and
  interaction behavior.
- `docs/adr/0004-lifecycle-reconciliation-around-commit-kernel.md`: unfinished
  proposal recovery and the narrow stale-supersession rule.
- `docs/v1-verification-matrix.md`: decision-to-contract verification map.
- `skills/evolve/SKILL.md`: Agent-facing behavior.
- `skills/evolve/references/`: protocol, privacy, migration, domain, and cleanup
  rules loaded on demand.
- `skills/evolve/runtime/`: optional Node Commit Kernel and Lifecycle
  Coordinator used by `auto` and reconciliation.
- `templates/.agent-context/`: new-workspace v1 shape.
- `install/`: deterministic Bootstrap platform adapters.
- `scripts/` and `tests/`: repository verification.

## Verification

```text
npm test
```

The full gate must cover the demo, schema fixtures, Commit Kernel and Lifecycle
Coordinator behavior, Bootstrap dry-run/apply/idempotency, repository hygiene,
and supported platform adapters.

## Non-Goals

- No database, vector store, cloud sync, background reconciliation daemon, or
  general workflow engine.
- No automatic semantic merge of `AGENTS.md` or `CLAUDE.md`.
- No public `repo`, `team`, or `kit` write scopes in v1.
- No deterministic module for deciding what a project lesson means.
- No independent `mistakes/` or `receipts/` source of truth.
