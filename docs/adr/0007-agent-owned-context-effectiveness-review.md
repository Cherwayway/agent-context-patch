# ADR-0007: Agent-owned context effectiveness review

- Status: Accepted
- Date: 2026-08-11
- Extends: ADR-0001, ADR-0005, and ADR-0006
- Feedback: GitHub issue #20

## Context

The v1 lifecycle proves that an authorized context patch was proposed, applied,
audited, and reported safely. It does not prove that the resulting rule later
changed Agent behavior or continued to earn its Active Context cost.

Personal dogfooding produced one bounded positive example: a later Agent read an
applied isolated-verification rule, used a temporary environment, and preserved
the worktree and lockfile. The same audit could not attribute most active rules
to relevant-task opportunities, changed actions, repeated failures, or
irrelevant default loading. Mechanical application evidence is therefore
stronger than semantic effectiveness evidence.

This signal currently comes from one workspace. The Iteration Standard does not
permit a new telemetry store, daemon, or deterministic meaning classifier from
that evidence alone.

## Decision

Context effectiveness remains Agent-owned semantic judgment. The Kit deepens
the existing `$evolve weekly` and `$evolve review-context` workflows instead of
adding a command, runtime module, or Workspace Schema migration.

### Stable rule identity

New Active Context rules carry a compact Markdown comment immediately above the
rule. Existing rules receive one only through a human-reviewed semantic change:

~~~md
<!-- acp-rule: 2026-08-11-isolated-verification#1; source: 2026-08-11-isolated-verification; subsumes: none -->
- When important verification lacks a dependency, use an isolated temporary
  environment and preserve the worktree and lockfiles.
~~~

The rule ID is the source proposal ID plus a one-based rule ordinal. A semantic
replacement receives a new rule ID and names the replaced IDs in `subsumes`.
The source proposal remains the evidence and lifecycle audit source of truth.
Existing unmarked rules remain valid and gain IDs only through a new approved
rewrite, merge, or cleanup plan; no bulk migration is implied.

The comment is inert Markdown for older readers, so this convention remains
Workspace Schema 1 compatible.

### Bounded task-local observations

When an available, content-safe task record can be evaluated, the Agent may
derive one observation for a named rule with:

- rule ID and an opaque or workspace-relative evidence pointer;
- applicability: `relevant`, `not_applicable`, or `unknown`;
- influence: `material_use`, `loaded_only`, `relevant_but_missed`, or `unknown`;
- an observable result summary and whether the same preventable failure
  recurred; and
- confidence plus privacy outcomes.

`material_use` requires evidence that the rule changed planning, execution, or
verification, not merely that a context file was read. `not_applicable` is not
negative evidence. Missing task coverage is `unknown`, never zero use.

These observations are semantic, bounded, and on demand. The Kit does not scan
tasks in the background, emit a per-task receipt by default, or create a raw
usage ledger. A weekly report may retain only aggregate counts, the last
content-safe material-use pointer, explicit unknown coverage, and short result
summaries. Reports remain derived views rather than lifecycle truth.

### Review decisions

For reviewed rules, `$evolve weekly` or `$evolve review-context` uses these
evidence states:

- `material_use`: a relevant task shows a changed action and observable result;
- `loaded_only`: the rule was available or read, but changed behavior is not
  established;
- `relevant_but_missed`: the rule applied, but the Agent did not follow it or
  the preventable failure recurred;
- `not_applicable`: the bounded task offered no opportunity to use the rule;
- `unknown`: retained evidence cannot support another state.

The corresponding recommendations are `retain`, `observe`, `narrow_route`,
`rewrite_candidate`, and `cleanup_candidate`. They are Agent judgments, not
mechanical scores. Any merge, demotion, replacement, or archive remains an
exact human-approved semantic operation.

The following signals schedule a semantic review independently of the line
budget:

- repeated failure after rule activation;
- repeated `loaded_only` or irrelevant default loading;
- rapid Active Context addition since the last bounded review;
- a long sequence of automatic adds without rewrite, cleanup, or effectiveness
  review; or
- many undifferentiated `high` retention declarations with little known
  effectiveness coverage.

They do not authorize deletion or cause the Commit Kernel to infer meaning.

### Paired acceptance

High-value rule changes should include fresh-Agent paired cases when practical:

- identical sanitized task facts and equal result schema;
- one fresh Agent without the candidate rule and one with it;
- an external harness that checks the selected action against an observable
  fixture outcome instead of accepting a claim that the rule was used; and
- an unrelated or over-specific negative task that must remain unconstrained.

Only structured results, canonical input digests, and sanitized summaries are
retained. Full Agent traces and task content are not.

## Consequences

- The Kit can distinguish mechanical application from semantic effectiveness
  without introducing telemetry or a second lifecycle store.
- Stable IDs can accumulate incrementally without migrating existing
  workspaces.
- Reports can state opportunities, material hits, recurrence, last material
  use, irrelevant loading, and unknown coverage for the bounded evidence they
  actually reviewed.
- A low observed hit rate cannot by itself prove low retention value, because
  opportunity coverage may be sparse or unknown.
- Future evidence from multiple workspaces may justify a durable observation
  adapter or schema extension, but this ADR does not create one.

## Rejected alternatives

- **A persistent per-task usage ledger:** creates a second durable fact stream
  and privacy pressure before cross-workspace need is established.
- **Outcome receipts on every task:** violates the silent no-trigger path and
  confuses evolution delivery with effectiveness evidence.
- **Commit Kernel effectiveness scoring:** places project meaning in a
  deterministic safety module.
- **Automatic cleanup from hit rate:** treats absent opportunity as disuse and
  bypasses approval for semantic removal.
- **Immediate Workspace Schema 2 migration:** imposes compatibility and backup
  cost without evidence that inline lineage and derived reports are
  insufficient.
