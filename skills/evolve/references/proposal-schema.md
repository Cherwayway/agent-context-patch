# Proposal Schema

Use frontmatter plus Markdown. Save proposals under:

```text
.agent-context/proposals/YYYY-MM-DD-short-slug.md
```

## Frontmatter

```yaml
---
id: 2026-07-09-context-read-gate
status: pending_current_fix
scope: workspace
trigger: user_correction
current_fix_status: in_progress
target_files:
  - .agent-context/PROJECT_PROFILE.md
confidence: medium
approval_required: true
created_by: agent
created_at: 2026-07-09
---
```

## Fields

`status`:

- `pending_current_fix`
- `proposed`
- `approved`
- `rejected`
- `applied`
- `superseded`
- `archived`

`scope`:

- `repo`
- `workspace`
- `team`
- `user-global`
- `kit`

`trigger` examples:

- `user_correction`
- `verification_failure`
- `review_failure`
- `missing_context_read`
- `stale_context`
- `repeated_explanation`
- `agent_self_detected`

`current_fix_status`:

- `not_started`
- `in_progress`
- `fixed`
- `verified`

`confidence`:

- `low`
- `medium`
- `high`

## Body Template

```md
## Observed Failure

What happened. Keep it factual.

## Evidence

- User signal:
- Command:
- File:
- Existing context:

## Root Cause

Why the current context or workflow failed.

## Future Risk

How this can happen again if context is not updated.

## Proposed Patch

Exact context change or file patch summary.

## Why This Scope

Why this belongs in repo, workspace, team, user-global, or kit context.

## Why Not Broader

Explain why this should not be promoted to broader context yet.

## Privacy Check

Confirm no secrets, customer data, production credentials, or unnecessary
private conversation text are stored.

## Rejection Notes

Leave empty until rejected, or record the user-provided reason.
```

## Evidence Requirements

At least one concrete evidence item is required:

- A short user correction or paraphrased user signal.
- A failed command and relevant output summary.
- A file path and the mismatch observed.
- A PR review or CI finding.
- A context file that was missing, stale, or wrong.

Do not create proposals based only on vibes.

