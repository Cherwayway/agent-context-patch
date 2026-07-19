# Changelog

All notable changes to Agent Context Patch are recorded here. The project uses
semantic versions for the Kit independently from the Workspace Schema version.

## [Unreleased]

## [0.5.1] - 2026-07-19

### Added

- A production Evolution Outcome Interface that validates legal
  `detect / propose / apply` families, consumes exact Lifecycle Coordinator
  evidence, strips unsafe detail, and formats one ephemeral task receipt.
- Unit and real-Coordinator integration coverage for applied, no-candidate,
  approval, blocked, invalid, and privacy-sensitive outcomes.
- Fresh-Agent positive and negative acceptance for the high-signal delivery
  checkpoint and silent one-off behavior.

### Changed

- Codex and Claude now share the same post-verification high-signal triggers,
  three-stage receipt contract, and no-trigger silence policy.
- `$evolve after-failure` now finalizes delivery through the Outcome Interface
  instead of hand-formatting success or blocker receipts.
- Prepared Kit Version 0.5.1 without changing Workspace Schema 1, adding a
  public command, or creating a durable receipt source.

## [0.5.0] - 2026-07-19

### Added

- A deterministic Lifecycle Coordinator that reconciles interrupted automatic
  and exact-approved proposal lifecycles without expanding the Commit Kernel.
- Production proposal parsing and validation shared by runtime reconciliation
  and repository verification.
- Content-safe target-state inspection, proposal source-hash CAS writes, and a
  workspace lifecycle lock for deterministic audit repair, including bounded
  exact-source retry after transient replacement failures.

### Changed

- An approved proposal with no successful apply may now become `superseded`
  after a real stale-target conflict only when its named replacement proposal
  exists and validates.
- `$evolve after-failure`, `approve`, `review-context`, and `weekly` now
  reconcile unfinished proposal lifecycles before creating or reporting more
  work. Workspace Schema remains 1.
- Current approval-only proposals remain non-blocking, while lifecycle resume
  and proposal validation share one static `policy_auto` eligibility predicate.

## [0.4.0] - 2026-07-12

### Changed

- New workspaces now default to `context_write_policy: auto`; existing
  workspace policy remains untouched by install and Kit update paths.
- Codex and Claude adapters now invoke `$evolve after-failure` autonomously,
  complete eligible low-risk patches in the same turn, and return one compact
  non-blocking receipt instead of asking for routine approval.
- `$evolve approve` is now documented as the safety-exception path, while the
  fake JavaScript demo exercises the `policy_auto` lifecycle.
- Prepared Kit Version 0.4.0 without changing Workspace Schema 1 or claiming
  post-success user-triggered undo.

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
