# Changelog

All notable changes to Agent Context Patch are recorded here. The project uses
semantic versions for the Kit independently from the Workspace Schema version.

## [Unreleased]

## [0.3.1] - 2026-07-11

### Added

- An on-demand personal multi-repository dogfooding Playbook that keeps daily
  use workspace-first, defines a lightweight weekly review, and requires real
  evidence before promotion into user-global guidance or Kit behavior.
- A Schema 1 dogfood workspace for this repository and verification that the
  installed Skill keeps the Playbook available without adding a new command.

## [0.3.0] - 2026-07-11

### Added

- A lightweight iteration standard driven by privacy-minimized Feedback
  Signals and fresh-context outcomes.
- A fixed-Release, explicit, reversible update policy.
- A structured GitHub form for reproducible product feedback.
- `$evolve update` plus PowerShell and Bash update dry-run/apply adapters with
  exact approval, complete backups, verification, and rollback.
- Kit/Workspace Schema compatibility that accepts historical valid Kit
  provenance instead of locking Schema 1 to one release version.
- GitHub-enforced immutable Releases and a one-time v0.2.0 upgrade handoff.

## [0.2.0] - 2026-07-11

### Added

- Agent-first context evolution through `init`, `after-failure`, `approve`,
  `review-context`, and `weekly`.
- A thin deterministic Commit Kernel for approved workspace writes, hashes,
  policy guards, conflict detection, and rollback.
- Workspace Schema 1, explicit legacy migration, evidence privacy rules, and
  replace-before-add context cleanup.
- Cross-platform Bootstrap adapters and Windows/Ubuntu verification.
