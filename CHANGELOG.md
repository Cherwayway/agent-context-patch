# Changelog

All notable changes to Agent Context Patch are recorded here. The project uses
semantic versions for the Kit independently from the Workspace Schema version.

## [0.8.1] - 2026-10-09

- Fix `weekly` catalog freshness after a Kit upgrade: use the running Kit
  version for both the health comparison and byte count, as `status` does.
  Historical workspace creation metadata remains unchanged. Real stale hooks
  still trigger a stale-catalog warning.
- Workspace Schema remains 2. Upgrade through `$evolve update`; no migration
  or new manual action is required beyond starting a fresh Agent task.

## [Unreleased]

## [0.8.0] - 2026-10-09

Workspace Schema remains 2; no migration or creation-version rewrite is needed.

- Normal Schema 2 writers share a lock before reading/planning; atomic per-file
  replacement and handled-error rollback include audits and catalogs. Concurrent
  successful consultations no longer lose counts. Apply archives expired STATE.
- Selection requires repo disambiguation, prioritizes global gates, reports
  incomplete reads (exit 1), and supports source-bound continuation pages.
  Unknown ids fail; oversized rules never bypass the body-byte budget. JSON
  output is a routing manifest, not a body read.
- Catalogs expose every repo/op scope once, preserve surrounding CRLF bytes,
  and skip render-time-only rewrites. Status/weekly report freshness, pending
  expiry, audit consistency, recent growth and separate predecessor use.
- Smaller skill entry; explicit update/migration guidance moved to a reference.
  Optional local material-use observations store safe references and rule hashes,
  without prompts, telemetry or claims of causal improvement.

Upgrade with `$evolve update` from the immutable Release, approve its exact
Bootstrap plan hash, then start fresh Codex/Claude tasks. Adapt select callers to
supply actual repos and consume every page; exit 1 is no longer safe to ignore.
The existing preceding-stable recovery protocol is retained and tested. No
workspace edits or memory migration are included in a Kit update.

Limits: matching beyond the repo filter remains OR; selection bytes cover body
text and separators, not CLI framing/manifests. Locks fail on contention and
require serial retry. Hand edits/init/migrate need a quiescent workspace.
Handled errors roll back; abrupt termination/power loss is not crash-atomic and
requires inspecting the leftover lock. Incomplete rollback reports failed paths
and keeps the lock. Use counters/observations remain self-reports.

## [0.7.0] - 2026-09-14

Workspace Schema 2. A read-first rewrite: the always-on context is a
generated catalog inside the instruction file, rule bodies are selected per
task, writes are one gated `apply`, and real use is recorded.

### Added

- A generated `acp-catalog` managed block in the workspace instruction file
  (`AGENTS.md` by default): one hook line per active rule grouped by
  `<repo> · <op>`, gates first, then a `STATE (auto-expires)` section. Hard
  budget of 8 KB; everything outside the block is never touched.
- One rule per file under `.agent-context/rules/<id>.md` with YAML
  frontmatter (`hook` at most 160 bytes, `kind` gate/advice/fact,
  `applies_to` repos/paths/ops/skills, `supersedes`, `source`, `created`,
  use counters) and a body of at most 1500 bytes.
- `STATE.yml`: dated working state with a required expiry (default TTL 14
  days, maximum 90, `never` rejected), archived automatically to
  `archive/state.yml`.
- `evolve select --signature '<json>'`: returns matching rule bodies from a
  content-safe task signature (repos, paths, ops, skills, ids). Repos filter;
  any intersecting dimension matches; global gates are always included;
  output is capped at 12 KB with gates first.
- `evolve apply --proposal '<json>' [--approved]`: one call that validates
  the envelope, requires `fix_status: verified`, runs the privacy scan,
  enforces byte limits, blocks a hook similar to an active one
  (`similar_rule_exists`, token Jaccard at or above 0.5), blocks a catalog
  over budget (`catalog_budget_exceeded`), then writes atomically under
  `.agent-context/.lock`, records `proposals/<id>.md` with a unified diff,
  archives expired state, and re-renders the catalog. Operations: `add`,
  `supersede`, `retire`, `state_set`, `state_clear`, `profile`.
- `evolve consult --consulted a,b --missed c`: writes `consulted`,
  `last_consulted`, and `missed` counters into rule frontmatter. This is the
  first mechanical "was the rule used" record.
- `evolve weekly`: a rebuildable report of most consulted, relevant but
  missed, never consulted in 30 days, similar hook pairs at or above 0.35,
  state expiring within 3 days, migrated drafts still flagged
  `needs_rewrite`, and Claude memory files not yet migrated.
- `evolve memory-sync --memory-dir <dir>`: regenerates Claude Code's
  per-project `MEMORY.md` as a generated view that keeps only `user`-type
  memories and points to the catalog for rules and state; `feedback` and
  `project` memory files are reported as migration candidates.
- `evolve migrate-v1`: a one-shot, lossy in-place conversion of a Schema 1
  workspace to Schema 2 (see Migration below).
- `evolve init`, `status`, `catalog [--write]`, `expire`, `receipt`, and a
  programmatic API from `runtime/index.mjs`.
- `docs/adr/0010-read-first-catalog-and-schema-2.md`,
  `skills/evolve/references/protocol-v2.md`, and runtime tests under
  `tests/runtime/`.

### Changed

- Workspace Schema is now 2. `config.yml` carries `schema_version: 2`,
  `kit_version`, `write_policy` (`auto` or `propose`), `agents_file`,
  `budgets`, and `state`. `context_write_policy` is renamed `write_policy`.
- The delivery checkpoint triggers are unchanged. The Agent now authors one
  proposal JSON and calls `apply`; the applied receipt line is returned by the
  runtime and is never hand-formatted. No-candidate receipts are formatted by
  `evolve receipt`.
- Replace-before-add is mechanical: overlap is detected by hook similarity
  and by the catalog budget rather than by Agent judgment alone. `--approved`
  bypasses only those two gates.
- `propose` policy returns `approval_required` from `apply` instead of
  creating a pending proposal file; approval is the same call with
  `--approved`.
- The Codex and Claude adapter fragments now describe the catalog, `select`,
  `apply`, receipts, and `consult`.
- `PROFILE.md` replaces `PROJECT_PROFILE.md` and holds verified facts only.
- Kit updates through `$evolve update` are unchanged.

### Removed

- Schema 1 files and concepts: `PROJECT_CONTEXT_INDEX.md`,
  `PROJECT_PROFILE.md`, `checklists/<domain>.md`, `acp-rule` HTML-comment
  markers, `acp-context` packs, domain packs (`prd`, `seo`), and
  `enabled_domains`.
- PatchPlan JSON proposals with Decision Log and Apply Attempts, the
  Lifecycle Coordinator and its lock, the Commit Kernel module, the Outcome
  Interface (`finalizeEvolutionOutcome`), and the Context Compiler
  (`compileWorkspaceContext`) with its `legacy_full` fallback and byte
  metrics.
- `$evolve after-failure`, `$evolve approve`, and `$evolve review-context` as
  named commands; their work is `apply`, `apply --approved`, and `weekly`
  plus `apply`.
- The references `protocol-v1.md`, `config-schema.md`, `proposal-schema.md`,
  `legacy-migration.md`, `domain-packs.md`, `domain-*.md`,
  `context-budget.md`, `cleanup-policy.md`, `privacy.md`, and
  `personal-dogfooding.zh-CN.md`; their surviving content is in
  `protocol-v2.md` and `SKILL.md`.
- ADR-0009 (progressive context compilation) is superseded by ADR-0010.
- There is no backward-compatibility read path for Schema 1.

### Migration

- Run `node <installed-skill>/runtime/cli.mjs migrate-v1 --workspace <dir>`
  once per Schema 1 workspace. Every checklist bullet and profile "Active
  Working Rules" bullet becomes a draft rule with `needs_rewrite: true`
  (hook = first sentence, `applies_to` inferred from keywords, body = original
  text truncated). Old proposals move to `archive/proposals-v1/`, checklists
  to `archive/checklists-v1/`, the profile to `archive/PROJECT_PROFILE-v1.md`;
  `PROJECT_CONTEXT_INDEX.md` is removed; `config.yml` is rewritten with the
  previous write policy preserved; the catalog is rendered.
- The conversion is lossy and accepted as such. The catalog will usually be
  over budget immediately afterwards; do a one-time rewrite and merge pass
  (target at most 60 rules) before expecting new adds to succeed.
- Re-apply the adapter fragment to the instruction file through the normal
  semantic patch review; Bootstrap and `$evolve update` do not edit it.
- Optionally run `memory-sync --memory-dir ~/.claude/projects/<slug>/memory`
  and move `feedback`/`project` memories into rules or STATE through `apply`.

## [0.6.1] - 2026-09-02

### Fixed

- Restored rule-target proposal attention for Schema 1 workspaces whose active
  rules use the historical `acp-rule` spelling, while normalizing both marker
  and attention-edge spellings to one canonical rule identity.
- Malformed, oversized, unclosed, duplicate, or credential-shaped rule
  metadata now fails safely. Unsafe, oversized, or incompletely bounded
  metadata blocks without echo; other rule ambiguity falls back to the
  complete context. The 512-candidate inspection bound applies across the
  complete enabled Active Context catalog for one compilation.
- Dangling attention targets now warn at normal risk and force complete
  high-risk fallback. Duplicate proposal IDs and duplicate aliases for one
  rule no longer create ambiguous pointers; known but unselected rules are not
  treated as dangling.
- A globally incomplete bounded proposal scan now suppresses every normal-risk
  attention pointer while retaining the independently compiled context;
  proposal-local duplicate identities suppress only their ambiguous pointer.

### Changed

- New rule markers use only
  `<!-- acp-rule: <source>#<positive ordinal>; source: <source>; subsumes: ... -->`;
  the historical `id=<source>-<ordinal>` form remains reader-only
  compatibility.

### Compatibility

- Workspace Schema remains 1. This release performs no marker migration or
  workspace rewrite, changes no `acp-context` fence behavior, and adds no hook,
  telemetry, or token-savings claim.

## [0.6.0] - 2026-09-01

### Added

- A deterministic, read-only Context Compiler API that renders task-relevant
  core and unmarked guidance, a derived global catalog, hard-signal-selected
  packs, task-relevant safety packs for high-risk tasks, and bounded proposal
  attention into one ephemeral model-visible payload.
- Co-located `acp-context` Markdown blocks, structured content-safe task
  signatures, exact pack requests, complete `legacy_full` fallback, and UTF-8
  payload metrics that include catalog and attention overhead.
- Optional proposal `attention_targets` for exact context/rule edges. The
  bounded scanner parses only valid non-terminal frontmatter, returns at most
  three non-authoritative pointers, never emits proposal body, and never
  reconciles lifecycle.

### Changed

- Compatible consumers may use skill-style progressive disclosure. Malformed
  routing, unknown requested packs, or missing high-risk safety coverage falls
  back to the complete previous default read set instead of dropping guidance.
  Normal-risk attention overflow keeps the first three deterministic pointers
  plus a warning; high-risk overflow, unrouted proposals, or an incomplete
  bounded scan forces complete fallback. The progressive catalog is capped at
  64 blocks, and credential-shaped routing metadata blocks without echoing.
- Prepared Kit Version 0.6.0 without changing Workspace Schema 1, adding a
  daemon, telemetry, or pre-first-model-call platform hook; persisting a catalog
  or usage ledger; migrating existing workspaces; or silently patching existing
  Agent instruction files. Byte fixtures do not claim real token savings or
  improved Agent behavior.

## [0.5.6] - 2026-08-20

### Added

- A standalone `source-snapshot` Skill that resolves an exact full remote Git
  ref, pins the observed commit in a workspace-external bare cache, and creates
  a task-owned read-only snapshot with integrity and cleanup receipts.
- A generated byte-identical `source-snapshot` copy in the Claude marketplace
  plugin, with release and repository checks that fail on distribution drift.
- Cross-platform acceptance coverage for dirty and stale primary checkouts,
  PR-style refs, concurrent cache access, escaping symlinks, submodules,
  nested directories, long paths, and exact blob-byte preservation.

### Changed

- Snapshot materialization now reads raw Git tree and blob objects instead of
  checkout, archive, or platform `tar` paths, preventing line-ending filters
  from changing the source being analyzed.
- Prepared Kit Version 0.5.6 without changing Workspace Schema 1 or coupling
  source provenance to the context-evolution lifecycle.

## [0.5.5] - 2026-08-12

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
