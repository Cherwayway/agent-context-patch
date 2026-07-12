# Project Profile

## Product / Project

- Name: Agent Context Patch
- Purpose: turn recurring Agent failures and stale workspace knowledge into
  small, durable context improvements that apply automatically when the
  workspace safety gates allow it.
- Primary current user: the repository owner working across personal projects.
- Current status: verified 0.4.0 auto-first candidate under personal dogfooding;
  external-user optimization is not the current decision driver.

## Workspace

- Workspace root: `.`
- Included repositories or document sets: this repository.
- Related external systems: immutable GitHub Releases and GitHub Actions.

## Enabled Domains

Derived from config.yml:

- coding

## Technical Context

- Main languages or formats: JavaScript, Markdown, PowerShell, and Bash.
- Frameworks or tools: Node.js built-in test runner and GitHub Actions.
- Package manager: npm.
- Test command: `npm test`.
- Windows Bootstrap dry-run: `powershell -ExecutionPolicy Bypass -File
  install/install.ps1 -Mode DryRun -WorkspacePath .`

## Important Paths

- Skill protocol: `skills/evolve/SKILL.md`
- Reference schemas and policies: `skills/evolve/references/`
- Personal-use workflow:
  `skills/evolve/references/personal-dogfooding.zh-CN.md`
- Workspace scaffold: `templates/.agent-context/`
- Commit Kernel: `skills/evolve/runtime/`
- Bootstrap adapters: `install/`
- Verification: `tests/verification/` and `scripts/run-verification.mjs`

## Active Working Rules

- Prove the personal workflow in real repositories before generalizing for
  external users.
- Keep the public command interface small; deepen existing commands before
  adding new ones.
- Fix and verify the current task before evolving durable context.
- Use the smallest sufficient intervention: project fact, checklist, skill,
  kit behavior, or no durable change.
- Require factual evidence and an observable verification path for product
  iterations.
- Default new and owner-dogfood workspaces to `auto`; complete an eligible
  low-risk PatchPlan in the current Agent turn and return one compact receipt.
- Treat Proposal as the internal audit aggregate, not as a routine user inbox;
  reserve approval for config, cleanup, domain, migration, instruction,
  promotion, and other authority-expanding changes.
- Replace, merge, archive, or delete stale context instead of only adding.

## Known Risks

- Personal dogfooding has not yet accumulated a 30-day recurrence baseline.
- Skill instructions, references, templates, adapters, and tests can drift when
  one behavior changes in several places.
- Structural verification alone cannot prove that Agent behavior improved in a
  fresh real task.
- The Kernel rolls back failed transactions but does not yet provide durable
  post-success user-triggered undo; product language must not claim otherwise.

## Current Uncertainties

- Which two or three personal repositories will form the first usage set.
- Which evidence format is useful without adding excessive task overhead.
- Whether weekly review remains the right cadence after the first 30 days.

## Verification State

- Last verified at: 2026-07-12.
- Verified against: package.json, skills/evolve/SKILL.md,
  skills/evolve/references/protocol-v1.md,
  docs/adr/0003-auto-first-low-risk-context.md,
  docs/acceptance/2026-07-12-auto-first-fresh-context.md,
  tests/verification/auto-default.test.mjs, and npm test.
