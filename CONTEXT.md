# Agent Context Patch Domain Context

## Purpose

Agent Context Patch turns reusable, evidence-backed lessons into small
workspace context that every later task actually sees. It fixes the current
task first, puts the read side in the instruction file so no read decision is
needed, and never treats context growth as success by itself.

## Ubiquitous Language

- **Workspace**: the only writable scope. It may be a Git repo, a multi-repo
  directory, or a non-code folder. Its context lives under `.agent-context/`.
- **Workspace Schema**: the versioned compatibility contract for durable
  workspace context. Kit 0.7.0 reads and writes Schema 2 only.
- **Instruction file**: the file the agents already read (`AGENTS.md` by
  default, imported by `CLAUDE.md`). It carries the catalog block; nothing
  else in it is ever edited by the runtime.
- **Catalog**: the generated managed block in the instruction file between
  `<!-- acp-catalog: ... -->` and `<!-- /acp-catalog -->`: one hook per active
  rule grouped by `<repo> · <op>`, then STATE. It is derived from `rules/` and
  `STATE.yml`, never a source of truth, and bounded by `catalog_bytes`.
- **Rule**: one file, `rules/<id>.md`, with frontmatter and a body of at most
  1500 bytes. It is a lesson that should still hold next quarter.
- **Hook**: the rule's one-line summary (at most 160 bytes), written as
  "situation + action" so it is usable without the body. Hooks are what the
  catalog shows and what the similarity gate compares.
- **Kind**: `gate` (must be satisfied before an action; selected even when
  global), `advice` (improves an outcome), `fact` (a verified property).
- **applies_to**: the rule's scope: `repos`, `paths` (globs), `ops`, `skills`.
  A rule with no scope is global.
- **STATE**: dated working state in `STATE.yml`. Every entry has an expiry
  (default 14 days, at most 90, never `never`) and one line of text. Expired
  entries leave the catalog and are archived automatically.
- **Profile**: `PROFILE.md`, verified workspace facts only. Replaced whole by
  a `profile` operation that carries the current content hash.
- **Task signature**: content-safe structured input to `select`: `repos`,
  `paths`, `ops`, `skills`, explicit `ids`. It never contains the prompt.
- **Select**: the read-side command that returns the bodies of rules matching
  a task signature, gates first, capped by `select_bytes`.
- **Consult**: the writeback of real use: `consulted`, `last_consulted`, and
  `missed` counters in rule frontmatter. "Consulted" means the rule influenced
  the work; "missed" means it was relevant but found too late.
- **Proposal**: the JSON input to `apply`: id, trigger, `fix_status`,
  evidence, optional observed and root cause, and 1 to 20 operations.
- **Operation**: `add`, `supersede`, `retire`, `state_set`, `state_clear`, or
  `profile`.
- **Gate**: a mechanical check inside `apply`. The reason codes are fixed:
  `invalid_proposal`, `invalid_rule`, `invalid_state`, `privacy_hazard`,
  `current_fix_not_verified`, `similar_rule_exists`,
  `catalog_budget_exceeded`, `profile_changed`, `no_effective_change`,
  `policy_requires_approval`, `workspace_locked`, `proposal_exists`,
  `commit_failed`.
- **Proposal audit**: `proposals/<id>.md`, written in the same call as the
  change: frontmatter with hashes and targets, short narrative sections, and a
  unified diff. Never full file contents.
- **Receipt**: the one line printed after the checkpoint.
  `Evolution outcome: detect=...; propose=...; apply=...` for evolution and
  `Context use: consulted=...` for consultation. The applied receipt is
  produced by the runtime and never hand-formatted.
- **Delivery checkpoint**: the post-verification, high-signal-only point
  where an Agent authors one proposal and calls `apply`, or stays silent.
- **Weekly report**: `reports/weekly-<date>.md`, a rebuildable view built from
  consult counters, hook similarity, and state expiry. It recommends; it never
  removes.
- **Memory bridge**: `memory-sync`, which regenerates Claude Code's
  per-project `MEMORY.md` as a view that keeps only `user`-type memories and
  reports `feedback` and `project` memories as migration candidates.
- **Migration (`migrate-v1`)**: the one-shot, lossy conversion of a Schema 1
  workspace. Its output is draft rules flagged `needs_rewrite` plus an
  `archive/` of the original files.
- **Kit Version**: the semantic version of one Agent Context Patch
  distribution. It identifies product behavior and is independent of the
  Workspace Schema.
- **Release**: an immutable, published distribution of exactly one Kit
  Version. A development branch or moving source snapshot is not a Release.
- **Upgrade Plan**: the exact, reviewable proposal for replacing one installed
  Kit Version with another. Its approval does not authorize a Workspace Schema
  migration.
- **Feedback Signal**: a privacy-minimized, reproducible observation from real
  use that can justify or evaluate an iteration. Raw conversations, full logs,
  and untested ideas are not Feedback Signals.
- **Source Snapshot**: an ephemeral, workspace-external, read-only tree bound
  to an exact remote Git ref and commit. It is task evidence, not context.

## Deep Modules And Seams

- `$evolve` is the Agent-facing interface. Its CLI is
  `node <installed-skill>/runtime/cli.mjs <command>` with `init`, `status`,
  `catalog`, `select`, `apply`, `consult`, `expire`, `weekly`, `memory-sync`,
  `migrate-v1`, and `receipt`; `$evolve update` is the Kit update entry point.
- `$source-snapshot` is the independent pre-task interface for pinning current
  remote Git source. It has no context-write authority.
- `runtime/workspace.mjs` is the Schema 2 contract: config, rule, and state
  validation, and `loadWorkspace`. Any invalid file invalidates the workspace.
- `runtime/catalog.mjs` renders the block and replaces it inside the
  instruction file without touching anything else.
- `runtime/select.mjs` implements signature normalization and selection.
- `runtime/apply.mjs` is the only writer of rules, state, profile, and audit.
  It plans the exact writes without I/O, then commits under
  `.agent-context/.lock` with rollback.
- `runtime/consult.mjs`, `runtime/weekly.mjs`, `runtime/memory-bridge.mjs`,
  `runtime/migrate-v1.mjs`, and `runtime/init.mjs` are single-purpose.
- The Bootstrap module (PowerShell and Bash) plans and applies deterministic
  skill and template file operations. It never edits an instruction file and
  never converts a workspace.
- Codex and Claude guidance fragments are the two Agent adapters. They are
  identical apart from the instruction file name.
- `npm test` is the repository verification interface. Tests exercise
  observable file outcomes across these seams.

## Hard Invariants

1. Repair and verify the current task before applying long-term context.
2. The runtime writes only under `.agent-context/` and inside the managed
   catalog block of the instruction file.
3. The catalog is derived. Hand edits to `rules/` are allowed but must be
   followed by `catalog --write`; hand edits to the block are not.
4. Every `apply` requires `fix_status: verified` and a clean privacy scan.
   `--approved` cannot bypass either.
5. Replace before add is mechanical: a similar hook or an over-budget catalog
   blocks an add until something is superseded or retired.
6. An apply is all-or-nothing: files, audit, and catalog are written under a
   lock, and every written file is restored on failure.
7. Applied is never inferred. The applied receipt comes from `apply`.
8. STATE entries always expire; nothing dated is stored as a rule.
9. Evidence is pointer-first and summary-first. Secrets, raw conversation,
   complete logs, customer data, and absolute user paths are never persisted.
10. Ordinary no-trigger work emits no receipt and creates no proposal.
11. At the end of a task that read rule bodies, `consult` is recorded.
12. Existing instruction content and explicit workspace policy are never
    silently overwritten. Schema 1 is converted only by an explicit
    `migrate-v1` run.
13. Kit updates run only on `$evolve update`, never poll in the background,
    and never authorize a workspace-schema migration.
14. Source Snapshot receipts and trees stay outside `.agent-context/`.

## Repository Reading Map

- `docs/adr/0001-agent-first-context-evolution.md`: original architecture.
- `docs/adr/0003-auto-first-low-risk-context.md`: auto-first write default.
- `docs/adr/0005-observable-evolution-outcomes.md`: delivery checkpoint and
  the receipt line.
- `docs/adr/0008-fresh-source-snapshots.md`: pre-task source provenance.
- `docs/adr/0010-read-first-catalog-and-schema-2.md`: the read-first catalog,
  Schema 2, and why the compiler, markers, and lifecycle were removed.
- `docs/v1-verification-matrix.md`: behavior-to-test map.
- `skills/evolve/SKILL.md`: Agent-facing behavior.
- `skills/evolve/references/protocol-v2.md`: normative formats and gates.
- `skills/evolve/runtime/README.md`: module map and programmatic API.
- `skills/source-snapshot/`: independent pre-task Skill and runtime.
- `adapters/`: Codex and Claude instruction fragments.
- `install/`: deterministic Bootstrap platform adapters.
- `scripts/` and `tests/`: repository verification.

## Verification

```text
npm test
```

The gate covers the runtime tests under `tests/runtime/`, Bootstrap
dry-run/apply/idempotency/upgrade, repository hygiene, and supported platform
adapters.

## Non-Goals

- No database, vector store, cloud sync, background daemon, telemetry, or
  general workflow engine.
- No automatic semantic merge of `AGENTS.md` or `CLAUDE.md` outside the
  managed block.
- No model-based router; selection uses hard signals only.
- No deterministic module for deciding what a project lesson means.
- No compatibility read path for Schema 1.
- No user-global write scope; promotion is a manual, reviewed act.
