# Changelog

All notable changes to Agent Context Patch are recorded here. The project uses
semantic versions for the Kit independently from the Workspace Schema version.

## [Unreleased]

### Added

- A Schema-1-compatible `acp-rule` lineage convention for new or
  human-reviewed Active Context rules, with source-proposal and subsumption
  identity.
- Bounded Agent-owned effectiveness states for material use, loaded-only
  evidence, relevant misses, non-applicability, and unknown coverage.
- Fresh-Agent semantic-review and paired rule-impact acceptance, including an
  unrelated negative case and canonical input-digest binding.

### Changed

- `$evolve weekly` and `$evolve review-context` now use explicitly available,
  content-safe task evidence to schedule retention, routing, rewrite, or cleanup
  review without telemetry, a raw usage ledger, or automatic deletion.
- Prepared the next Kit patch without changing Workspace Schema 1, adding a
  public command, or moving project meaning into the deterministic runtime.

## [0.5.4] - 2026-07-29

### Added

- A Claude Code marketplace adapter that discovers the immutable-Release
  installer without silently editing a workspace.
- A seven-day discoverability experiment with channel-specific landing paths,
  privacy-minimized evidence records, daily GitHub snapshots, and a real
  fail-to-pass terminal demo asset.
- A focused comparison with Claude Code Auto Memory in English and Chinese.
- A deterministic release-preparation command that binds the named archive and
  SHA-256 checksum to one exact commit.

### Changed

- Prepared Kit Version 0.5.4 without changing Workspace Schema 1 or the runtime
  write-authority boundary.
- Made `package.json` the source of truth for synchronized public Kit Version
  surfaces.

## [0.5.3] - 2026-07-26

### Added

- An Agent-owned behavior-shape review contract that compares responsibility,
  trigger, execution path, intended effect, and observable verification across
  different implementation nouns.
- A reusable cross-domain review fixture plus positive and negative
  fresh-context acceptance: one repeated execution-path family consolidates,
  while superficially similar accessibility, privacy, idempotency, and timing
  failures remain separate.

### Changed

- `$evolve after-failure` reads only related applied-proposal summaries when
  Active Context suggests a recurring responsibility or failure shape.
- `$evolve review-context` now uses summary-first shortlisting before deep
  proposal reads and requires subsumption evidence, preserved domain details,
  counterexamples, behavior loss, and net active-context change.
- `$evolve weekly` may surface semantic-generalization candidates but cannot
  merge them. Semantic replacement remains approval-required, with no new
  runtime heuristic, public command, background scan, or Workspace Schema
  change.

## [0.5.2] - 2026-07-26

### Fixed

- Lifecycle reconciliation now performs bounded post-application passes so one
  call cannot report `settled` when its own exact application has already made
  an earlier sibling proposal stale.
- Coordinator results are independent of proposal filename order while
  unrelated approval-waiting proposals remain non-blocking.
- The real Coordinator-to-Outcome path now verifies that a post-application
  sibling blocker cannot produce an applied-success receipt.
- Applied Coordinator results now carry explicit post-application verification,
  which the Outcome Interface requires before it can publish success.

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
