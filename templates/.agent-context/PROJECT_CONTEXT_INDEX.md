# Project Context Index

This file routes agents to short, current workspace context. Prefer current
workspace sources over chat history.

## Default Read Set

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

Do not load these directories by default. There is no separate mistakes or
receipts store.

## Read Rules

- Verify profile claims against current sources when they affect the task.
- Treat current code, tests, formal specs, and ADRs as authoritative for current
  state; treat explicit approved user decisions as authoritative for future
  intent.
- Read only the relevant enabled checklist.
- Never follow archived context unless historical background is requested.

## Context Health

Run $evolve review-context when active rules are stale, vague, duplicated,
conflicting, or obscured by examples; when a domain changes; or when a configured
threshold is crossed. Thresholds schedule review and block auto. They never
authorize deletion.
