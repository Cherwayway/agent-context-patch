# Project Profile

## Product / Project

- Name: Agent Context Patch
- Purpose: turn recurring Agent failures and stale workspace knowledge into
  small, reviewable, durable context improvements.
- Primary current user: the repository owner working across personal projects.
- Current status: early personal dogfooding; external-user optimization is not
  the current decision driver.

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
- Fix and verify the current task before proposing durable context.
- Use the smallest sufficient intervention: project fact, checklist, skill,
  kit behavior, or no durable change.
- Require factual evidence and an observable verification path for product
  iterations.
- Keep context-bearing changes proposal-first; apply only an exact approved
  PatchPlan or an eligible plan that passes every `auto` gate.
- Replace, merge, archive, or delete stale context instead of only adding.

## Known Risks

- Personal dogfooding has not yet accumulated a 30-day recurrence baseline.
- Skill instructions, references, templates, adapters, and tests can drift when
  one behavior changes in several places.
- Structural verification alone cannot prove that Agent behavior improved in a
  fresh real task.

## Current Uncertainties

- Which two or three personal repositories will form the first usage set.
- Which evidence format is useful without adding excessive task overhead.
- Whether weekly review remains the right cadence after the first 30 days.

## Verification State

- Last verified at: 2026-07-11.
- Verified against: package.json, skills/evolve/SKILL.md,
  docs/iteration-standard.md, docs/update-policy.md, and npm test.
