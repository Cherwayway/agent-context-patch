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
- **Proposal**: the complete evolution aggregate for one lesson. It owns the
  evidence, proposed patch, decision log, and apply attempts.
- **PatchPlan**: the exact, immutable file operations proposed for approval. A
  decision binds to its `planHash`. It persists workspace-relative targets;
  the absolute runtime workspace root is injected only at apply time.
- **Decision**: an approval or rejection of one PatchPlan.
- **ApplyAttempt**: the result of committing an approved PatchPlan, including
  relative targets and before/after hashes but not duplicated patch content.
- **Promotion**: an approved proposal to generalize a workspace lesson into
  user-level guidance. User-global context is never an active v1 write scope.
- **Domain Candidate**: an Agent-detected domain with evidence and confidence.
- **Enabled Domain**: a user-approved domain recorded in config. Only enabled
  domains materialize active checklists.
- **Authority**: which evidence wins when context conflicts.
- **Retention Value**: whether a rule still earns space in Active Context.
- **Legacy Workspace**: an unversioned `.agent-context/` tree. It is read-only
  until an approved migration is applied.

## Deep Modules And Seams

- `$evolve` is the Agent-facing interface for `init`, `after-failure`,
  `approve`, `review-context`, and `weekly`.
- The **Commit Kernel** accepts a PatchPlan plus optional external approval and
  returns an ApplyAttempt. Approval carries the reviewed `planHash` outside the
  plan, avoiding a self-referential hash. The kernel owns path safety, policy
  guards, hashes, conflict detection, staging, and rollback.
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
3. `propose` is the default policy. `auto` requires explicit workspace config
   opt-in and the Node Commit Kernel.
4. Missing kernel capability downgrades `auto` to `propose` explicitly.
5. Delete, archive, supersede, migration, instruction-file, and promotion
   operations always require human approval.
6. `$evolve approve` is one public action, while the implementation records
   separate `approved` and `applied` states.
7. Every apply requires `currentFixStatus: verified`; approval cannot bypass
   verification, supported topology, path, or privacy guards.
8. The proposal aggregate is never a PatchPlan target. Its Decision Log and
   Apply Attempts stay outside the Commit Kernel boundary.
9. A non-migration commit requires one complete, valid v1 workspace config.
   Future schemas remain read-only; a legacy migration must create exact
   workspace-local backups in the same transaction.
10. Bootstrap also validates the complete v1 config envelope without requiring
    Node. Invalid current-looking config is blocked before any template write.
11. Archive content is append-only history: every archive target is
    create-only, including after exact approval.
12. Any target content, operation, policy result, or context-delta change
   invalidates the approved plan hash.
13. Domain detection is semantic and temporary; activation is approved and
   persisted only in `config.enabled_domains`.
14. Replace before add. Overlap or conflict forces a cleanup proposal instead of
   automatic accumulation.
15. Quantity triggers context review; authority and retention value decide what
    should change. Context is never truncated automatically.
16. Persist evidence pointers and summaries, not raw conversations or complete
    logs. Use workspace-relative paths.
17. Existing instructions and legacy context are never silently overwritten.

## Repository Reading Map

- `docs/adr/0001-agent-first-context-evolution.md`: architectural decisions.
- `docs/v1-verification-matrix.md`: decision-to-contract verification map.
- `skills/evolve/SKILL.md`: Agent-facing behavior.
- `skills/evolve/references/`: protocol, privacy, migration, domain, and cleanup
  rules loaded on demand.
- `skills/evolve/runtime/`: optional Node Commit Kernel used by `auto`.
- `templates/.agent-context/`: new-workspace v1 shape.
- `install/`: deterministic Bootstrap platform adapters.
- `scripts/` and `tests/`: repository verification.

## Verification

```text
npm test
```

The full gate must cover the demo, schema fixtures, Commit Kernel behavior,
Bootstrap dry-run/apply/idempotency, repository hygiene, and supported platform
adapters.

## Non-Goals

- No database, vector store, cloud sync, daemon, or general workflow engine.
- No automatic semantic merge of `AGENTS.md` or `CLAUDE.md`.
- No public `repo`, `team`, or `kit` write scopes in v1.
- No deterministic module for deciding what a project lesson means.
- No independent `mistakes/` or `receipts/` source of truth.
