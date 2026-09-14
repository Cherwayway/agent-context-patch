# ADR-0010: Read-First Catalog and Workspace Schema 2

- Status: Accepted
- Date: 2026-09-14
- Supersedes: ADR-0004 (lifecycle reconciliation), ADR-0006 (post-application
  quiescence), ADR-0007 (effectiveness review), ADR-0009 (progressive context
  compilation). Narrows ADR-0005: the three-stage receipt line survives; the
  Outcome Interface module does not.
- Keeps: ADR-0001 (Agent-first semantics, deterministic file safety), ADR-0002
  (immutable releases and explicit upgrades), ADR-0003 (auto-first low-risk
  writes), ADR-0008 (source snapshots).

## Context

Schema 1 optimized the write side. A lesson became a proposal aggregate with
a PatchPlan, a Decision Log, and Apply Attempts; a Lifecycle Coordinator
reconciled unfinished aggregates; a Context Compiler selected marked packs
from a task signature and fell back to the complete read set on any
ambiguity. Each piece was individually defensible. Together they produced a
workspace that was expensive to write to and almost never read.

Measured in the dogfood workspace (this repository's owner, five repositories,
119 applied proposals over two months):

- The compiler returned `legacy_full` 100% of the time. No checklist was ever
  organized into valid `acp-context` packs, because doing so was a reviewed
  semantic narrowing with no mechanical help, so the routing layer never
  routed anything.
- All 119 proposals were `add`. Replace-before-add was an instruction, not a
  gate; nothing ever superseded or retired a rule, and the checklists grew
  monotonically.
- Rules were read in roughly 20% of sessions. The read path required a
  decision (open the index, open the profile, open the right checklist) that
  a task under pressure did not make. Claude Code's own auto-memory, which
  needs no decision because it is injected, was read far more often and
  drifted into a competing store of workspace facts.

The conclusion is that context reach, not context correctness, was the
binding constraint. A rule that is not in front of the agent is not context.

## Decision

### 1. The catalog is the always-on context and lives in the instruction file

Every active rule has a one-line `hook` (at most 160 bytes, "situation +
action"). The runtime renders all hooks, grouped by `<repo> · <op>` and
ordered gate, advice, fact, plus dated STATE entries, into a managed block
between `<!-- acp-catalog: ... -->` and `<!-- /acp-catalog -->` in the
workspace instruction file (`AGENTS.md` by default). Codex reads that file
literally; Claude Code imports it. Both agents see the same catalog with no
read decision. Nothing outside the block is ever edited.

The block has a hard budget (8 KB). The budget is enforced at write time:
an `add` that would exceed it is blocked until something is superseded or
retired. This turns "keep context small" from advice into a gate.

### 2. Rule bodies are selected per task from hard signals

`evolve select` takes a content-safe signature (`repos`, `paths`, `ops`,
`skills`, explicit `ids`) and returns the bodies of matching rules: repos act
as a filter, any intersecting dimension matches, rules with no scope are
global and only global gates are selected, output is capped (12 KB) with
gates first. Skills call `select` with a fixed signature when they activate.
There is no fallback mode, because there is no longer a complete read set to
fall back to: the catalog is always present and the body is optional detail.

### 3. One rule per file, no markers

A rule is `.agent-context/rules/<id>.md` with YAML frontmatter and a body of
at most 1500 bytes. There are no HTML-comment markers inside shared Markdown,
no checklists, no domains, and no index file. The catalog is derived from the
rule files and `STATE.yml` and is never a source of truth.

### 4. Dated state is separate from rules and expires

`STATE.yml` holds working state with a required expiry (default 14 days,
maximum 90, `never` rejected). Expired entries leave the catalog and are
archived automatically. This removes the main reason profile and checklist
content went stale: dated facts no longer masquerade as rules.

### 5. Writes are one direct, gated `apply`

A proposal is JSON input, not a file. `evolve apply` validates the envelope,
requires `fix_status: verified`, scans every text for privacy hazards,
enforces byte limits, blocks a hook whose token Jaccard with an active hook is
at or above 0.5 (`similar_rule_exists`), blocks a catalog over budget, checks
the profile hash, then writes atomically under a lock, records one audit file
with a unified diff, and re-renders the catalog. Result statuses are
`applied`, `approval_required`, `blocked`, and `failed`. `--approved`
bypasses only similarity and budget.

The Decision Log, Apply Attempts, Lifecycle Coordinator, Commit Kernel module,
and Outcome Interface are removed. Their guarantees (hash-checked targets,
rollback, no invented `applied`) are kept inside `apply`, which is short
enough to read in one sitting.

### 6. Real use is recorded

`evolve consult --consulted a,b --missed c` increments counters in rule
frontmatter. `weekly` ranks by them and lists never-consulted rules, missed
rules, and similar hook pairs as merge candidates. This replaces ADR-0007's
Agent-narrated effectiveness review with two integers that cost nothing to
collect.

### 7. Claude auto-memory is bridged, not competed with

`memory-sync` regenerates Claude Code's per-project `MEMORY.md` as a
generated view that keeps only `user`-type memories and points to the catalog
for everything else. `feedback` and `project` memories are migration
candidates for `apply`.

### 8. Schema 1 is converted once, lossily

`migrate-v1` turns every checklist bullet and profile rule into a draft rule
flagged `needs_rewrite`, moves history to `archive/`, and renders the catalog.
There is no compatibility read path. The catalog is expected to exceed budget
right after migration; a one-time rewrite pass (target at most 60 rules) is the
accepted cost of leaving the old topology behind.

## Why the compiler, markers, and lifecycle were removed rather than fixed

- The compiler's safety property (fall back to everything on ambiguity) was
  also its failure mode: with nothing marked, ambiguity was the steady state,
  so the compiler was pure overhead. A catalog that is always rendered has no
  ambiguity to fall back from.
- Markers coupled routing metadata to prose in shared files. Every rewrite of
  a checklist risked breaking a marker, and the 0.6.1 patch existed only to
  tolerate marker spellings. One file per rule removes the coupling.
- The lifecycle coordinator existed to recover proposals that were approved
  but not applied, or applied but not audited. With `apply` as a single call
  that writes files and audit together under a lock, those intermediate
  states cannot occur, so the coordinator has nothing to reconcile.
- Replace-before-add as an instruction produced zero replacements in 119
  proposals. As a similarity gate plus a byte budget it cannot be skipped.

## Consequences

- Both agents read the same context with zero read decision; the measured
  read rate is expected to move from about 20% of sessions to every session,
  with `consult` counters as the evidence.
- Context cost is bounded by construction (8 KB catalog, 12 KB selection).
- Writing a lesson is one command; the audit trail is one file per applied
  change with a diff, which is easier to review than a Decision Log.
- Migration is lossy and requires a human-assisted rewrite pass. This is
  accepted because the alternative, carrying Schema 1 readers forward, keeps
  the failure mode that motivated the change.
- The instruction file now contains generated content. The managed block is
  clearly delimited, never edited by hand, and everything outside it is left
  byte-for-byte, but a workspace that forbids generated content in `AGENTS.md`
  can point `agents_file` at another file that the instruction file imports.
- Weekly review is derived from real counters and can be regenerated at any
  time; it recommends and never removes.

## Rejected alternatives

- **Keep Schema 1 and add a hook that injects the compiler output.** Still
  requires marking content to get any reduction, and still leaves a read
  decision at the checklist level.
- **Persist the catalog as a separate file the agent must open.** That is a
  read decision; the dogfood data says it will not be made.
- **A model-based router.** Adds a model call, is not reproducible, and can
  expose the prompt.
- **A compatibility read path for Schema 1.** Keeps two topologies alive and
  lets the old one keep growing.
- **Approval-gated migration with backups and hashes.** The old files are
  archived verbatim; a reviewed PatchPlan for a one-shot lossy conversion
  would add ceremony without adding safety.

## Verification

`tests/runtime/*.test.mjs` cover catalog render and replace, selection
semantics, every apply gate and rollback, consult writeback, expiry, weekly,
the memory bridge, `migrate-v1`, and the CLI exit codes; installer and
hygiene tests are unchanged. The mapping is in
`docs/v1-verification-matrix.md`.
