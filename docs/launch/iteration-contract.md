# Discoverability Launch Iteration Contract

- Status: seven-day experiment in progress since 2026-07-29T16:36:11Z
- Target Kit Version: 0.5.4
- Workspace Schema: unchanged at 1
- GitHub issue: [#15](https://github.com/Cherwayway/agent-context-patch/issues/15)

## Feedback Signal and sanitized reproduction

The rolling GitHub Traffic window on 2026-07-29 reported 37 views from one
unique visitor and 83 clones from 36 unique cloners. The only referrer was
`github.com`; exact-name search found the repository, while broad intent
queries did not place it in the first 100 results. Current stars, forks, issue
activity, and known visitors could be traced to the team. The repository had no
public external backlink or platform-native Claude plugin discovery path.

The sanitized source snapshot and commands are recorded in
`docs/research/2026-07-29-github-discoverability-diagnosis.md`. Clone counts are
diagnostic only because CI, bots, IDEs, and Agent installs can clone without a
human repository visit.

## Primary hypothesis and observable condition

Hypothesis: the earliest broken stage is acquisition, followed by an unclear
boundary with Claude Code Auto Memory and a high-friction install path. A
platform-native adapter, an observable fail-to-reuse demo, and three distinct
distribution paths should produce independently evidenced movement through
visit, activation, real evolution, and later reuse.

The seven-day condition is machine-readable in `docs/launch/experiment.json`:
30 GitHub-adjusted external unique visitors, three independently confirmed
valid activations, three real evolutions, and at least one later reuse record.

## Smallest change and non-goals

The iteration adds only:

- one Claude Code marketplace adapter that delegates installation to the
  existing immutable-Release contract;
- one Auto Memory comparison in English and Chinese;
- one executed 74-second demo plus a short link-preview cut;
- one structured seven-day experiment and privacy-minimized snapshot/evidence
  tool; and
- channel-specific launch copy and landing paths.

Non-goals: no new runtime command, background process, telemetry, hosted
service, automatic global instruction edit, Workspace Schema change, or claim
that clone traffic represents people.

## Boundaries and rollback

- Safety: the plugin is a discovery/install adapter only. It preserves
  immutable Release resolution, checksum and identity verification, dry-run,
  exact-plan approval, and the existing Bootstrap boundary.
- Privacy: evidence uses opaque participant IDs and boolean outcomes. It stores
  no raw conversation, complete log, contact detail, customer data, secret, or
  private absolute workspace path.
- Compatibility: Kit Version becomes 0.5.4; Workspace Schema remains 1. The
  runtime and prior stable update path are unchanged.
- Rollback: remove the marketplace/launch surfaces and stop distribution. No
  installed workspace data or schema migration needs reversal. A published
  Release remains immutable and would be superseded by a later version.

## Verification

Completed on 2026-07-29:

- `npm test`: 204 tests, 184 passed, 20 expected platform skips, zero failed,
  including a CRLF checkout regression for Kit Version synchronization;
- deterministic plugin resolution smoke test plus official Claude marketplace
  and strict plugin validation: passed;
- executed demo generation: nine frames / 74 seconds plus four frames / eight
  seconds, with the expected failing test and repaired passing test enforced;
- offline evidence/snapshot outcomes and both interval boundaries: passed;
- authenticated Day 0 snapshot: one reported unique visitor, zero
  GitHub-adjusted external visitors, experiment `not_started`;
- `npm run version:check`: Kit Version 0.5.4 synchronized; and
- independent Standards and Spec reviews against fixed point `a0bcec3`: clean.

## Release note

Kit Version 0.5.4 adds a Claude Code discovery adapter, executed terminal demo,
Auto Memory comparison, and a privacy-minimized seven-day acquisition and
activation experiment without changing Workspace Schema 1 or runtime write
authority.

## External execution gates

The maintainer approved external distribution. The first live channel is the
[Codex Show and tell discussion](https://github.com/openai/codex/discussions/35991),
published at 2026-07-29T16:36:11Z with the terminal demo landing path. That
timestamp starts the seven-day experiment; Anthropic marketplace submission
and direct design-partner invitations remain separate channel actions. Channel
actions are appended to `docs/launch/distribution-log.jsonl`; participant
results are appended as new evidence records and historical records are never
rewritten.
