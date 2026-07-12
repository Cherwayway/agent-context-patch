# Project Context Index

This repository dogfoods Agent Context Patch before generalizing behavior for
external users. Prefer current repository sources over chat history.

## Default Read Set

- `PROJECT_PROFILE.md`: verified product facts, active rules, risks, and current
  uncertainties.
- `checklists/coding.md`: read when changing the skill, runtime, adapters,
  templates, tests, or release behavior.

Read `config.yml` when initializing, evolving, or reviewing context. It is the
only truth source for enabled domains and write policy.

## On-Demand Sources

- `proposals/`: internal workspace-context evolution aggregates with evidence,
  decisions, and apply attempts; eligible auto records are not user approval
  tasks.
- `reports/`: rebuildable weekly and context-health views.
- `archive/`: inactive or superseded context and migration backups.
- `../skills/evolve/references/personal-dogfooding.zh-CN.md`: the canonical
  personal multi-repository operating workflow.

Do not load these sources by default. Product iterations belong in issues,
pull requests, tests, and immutable Releases rather than workspace proposals.

## Read Rules

- Verify profile claims against current sources when they affect the task.
- Treat current code, tests, formal specs, and ADRs as authoritative for current
  state; treat explicit approved user decisions as authoritative for future
  intent.
- Load only context relevant to the next decision.
- Never follow archived context unless historical background is requested.

## Context Health

Run `$evolve review-context` when active rules are stale, vague, duplicated,
conflicting, or no longer change Agent behavior; when a domain changes; or when
a configured threshold is crossed. Thresholds never authorize deletion.
