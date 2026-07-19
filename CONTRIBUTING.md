# Contributing

Agent Context Patch is intentionally small. Contributions should deepen the
mistake-to-context loop without encoding project semantics in deterministic
modules.

## Start Here

Read:

1. `CONTEXT.md` for the domain language and module seams.
2. `docs/adr/0001-agent-first-context-evolution.md` plus later superseding ADRs,
   especially `docs/adr/0003-auto-first-low-risk-context.md` and
   `docs/adr/0004-lifecycle-reconciliation-around-commit-kernel.md`.
3. The relevant `skills/evolve/references/` file.

Do not add a second source of truth for proposal lifecycle, write policy, domain
activation, or receipts.

## Module Discipline

- Agent instructions own semantic judgment.
- The Commit Kernel owns only deterministic commit safety.
- The Lifecycle Coordinator owns only deterministic proposal reconciliation and
  uses the Commit Kernel rather than absorbing it.
- Bootstrap owns deterministic install file operations.
- PowerShell/Bash and Codex/Claude are adapters at real seams.
- Tests cross public interfaces and verify observable behavior.

Do not create a new adapter abstraction until a second real adapter exists. A
new deep-module seam needs an accepted ADR and multiple concrete workflow
callers.

## Domain Packs

New built-in domain packs must include:

- detection guidance and evidence examples;
- checks;
- what not to memorize;
- cleanup rules;
- checklist materialization guidance.

Detection does not equal activation. A pack should become built-in only after
the pattern proves reusable across workspaces; project-specific guidance can
remain a workspace checklist.

## Context And Privacy Rules

- Fix and verify the current task before long-term context.
- Replace before add.
- Never use quantity alone to delete context.
- Never encourage silent instruction, migration, domain, or promotion writes.
- Store evidence pointers and summaries, not raw conversations or full logs.
- Never store secrets, customer data, production credentials, or unnecessary
  personal information in fixtures, proposals, reports, or archives.

## Verification

Run the single public gate:

```bash
npm test
```

Add behavior-focused tests when changing a public seam. Keep Windows and Ubuntu
adapters covered by the same contract.
