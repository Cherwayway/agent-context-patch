# Contributing

Agent Context Patch is intentionally small. Contributions should deepen the
mistake-to-context loop without encoding project semantics in deterministic
modules.

## Start Here

Read:

1. `CONTEXT.md` for the domain language and module seams.
2. `docs/adr/0001-agent-first-context-evolution.md` plus later superseding ADRs,
   especially `docs/adr/0003-auto-first-low-risk-context.md`,
   `docs/adr/0005-observable-evolution-outcomes.md` for the receipt line, and
   `docs/adr/0010-read-first-catalog-and-schema-2.md` for the catalog,
   Workspace Schema 2, and the single gated `apply`.
3. `skills/evolve/references/protocol-v2.md`, the normative format reference.

Do not add a second source of truth for the workspace layout, the apply gates,
write policy, or receipts. Where a document and the runtime disagree, the
runtime is the bug.

## Module Discipline

- Agent instructions own semantic judgment: what happened, whether it is
  reusable, and how the hook and body are worded.
- `runtime/workspace.mjs` owns the Schema 2 contract: loading and validating
  `config.yml`, `rules/<id>.md`, and `STATE.yml`. Any invalid file invalidates
  the whole workspace; nothing is skipped silently.
- `runtime/apply.mjs` is the only writer of rules, state, profile, and audit
  records. It runs the mechanical gates, commits atomically under
  `.agent-context/.lock` with rollback, and writes one audit record with a
  unified diff.
- `runtime/catalog.mjs` renders the managed `acp-catalog` block and replaces it
  inside the instruction file without touching anything else.
- `runtime/select.mjs` is the read side: task-signature normalization and rule
  selection.
- `runtime/consult.mjs`, `runtime/weekly.mjs`, `runtime/memory-bridge.mjs`,
  `runtime/migrate-v1.mjs`, and `runtime/init.mjs` are single-purpose leaf
  utilities on top of those four.
- Bootstrap owns deterministic install file operations. It never edits an
  instruction file and never converts a workspace.
- PowerShell/Bash and Codex/Claude are adapters at real seams.
- Tests cross public interfaces and verify observable file outcomes.

Do not create a new adapter abstraction until a second real adapter exists. A
new deep-module seam needs an accepted ADR and multiple concrete workflow
callers.

## Fixtures

A checked-in workspace (`.agent-context/` at the repository root or under
`demos/`) is a Schema 2 fixture and must stay loadable by
`runtime/workspace.mjs`. After editing a fixture rule or state entry, re-render
its catalog with `node skills/evolve/runtime/cli.mjs catalog --write
--workspace <dir>`; the repository contract test re-renders every fixture and
fails on a stale block. Keep every fixture within its catalog budget.

## Context And Privacy Rules

- Fix and verify the current task before long-term context.
- Replace before add: supersede or retire instead of rewording a blocked hook.
- Never use quantity alone to delete context; `weekly` recommends, `apply`
  changes.
- Never encourage silent instruction-file, migration, or promotion writes.
- Store evidence pointers and summaries, not raw conversations or full logs.
- Never store secrets, customer data, production credentials, absolute user
  paths, or unnecessary personal information in fixtures, proposals, reports,
  or archives.

## Verification

Run the single public gate:

```bash
npm test
```

Runtime tests live in `tests/runtime/` (one file per module plus the CLI);
installer, demo, release, and repository-contract tests live in
`tests/verification/`. Add behavior-focused tests when changing a public seam.
Keep Windows and Ubuntu adapters covered by the same contract.
