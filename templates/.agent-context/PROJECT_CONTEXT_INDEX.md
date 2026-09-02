# Project Context Index

<!-- acp-context: {"schemaVersion":1,"id":"context-index","kind":"core","description":"Workspace context authority, loading, and safety rules."} -->
This file routes agents to short, current workspace context. Prefer current
workspace sources over chat history.

## Context Loading

When the installed instruction adapter activates the read-only Context
Compiler, give it a structured task signature and load only its returned
`content`. Core and unmarked guidance remains visible; task packs are selected
by hard signals or exact requests; high-risk tasks also load task-relevant
safety packs.

On `legacy_full` fallback, load the complete default read set:

- PROJECT_PROFILE.md: verified project facts, active rules, risks, and current
  uncertainties.
- checklists/<enabled-domain>.md: read only when the domain is listed in
  config.yml and relevant to the current task.

Read config.yml when initializing, evolving, or reviewing context. It is the
only truth source for enabled domains and write policy.

## On-Demand History

- proposals/: internal evolution aggregates with evidence, decisions, and apply
  attempts; eligible auto records are not user approval tasks.
- reports/: rebuildable weekly and context-health views.
- archive/: inactive or superseded context and migration backups.

Do not load these directories by default. The compiler may inspect only bounded
valid non-terminal proposal frontmatter with explicit `attention_targets`; its
scanner parses only frontmatter and emits no proposal body. Attention must be
verified against current sources. Existing proposals are not backfilled and
edges are never inferred. There is no separate mistakes, receipts, catalog, or
usage-ledger store.

## Read Rules

- Verify profile claims against current sources when they affect the task.
- Treat current code, tests, formal specs, and ADRs as authoritative for current
  state; treat explicit approved user decisions as authoritative for future
  intent.
- Use only structured content-safe task signals for routing; never pass the raw
  prompt or an absolute user path to the compiler.
- If routing is missing, malformed, ambiguous, or lacks high-risk safety
  coverage, use the complete legacy read set rather than a partial result.
- On `status: blocked`, stop and report the bounded reason; do not continue with
  empty or reconstructed guidance.
- Treat proposal attention as a pointer for current-source verification, not as
  Active Context, approval, or truth.
- Never follow archived context unless historical background is requested.

## Context Health

Run $evolve review-context when active rules are stale, vague, duplicated,
conflicting, or obscured by examples; when a domain changes; or when a configured
threshold is crossed. Thresholds schedule review and block auto. They never
authorize deletion.
<!-- /acp-context -->
