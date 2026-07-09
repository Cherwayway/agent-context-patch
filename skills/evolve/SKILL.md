---
name: evolve
description: Turn agent mistakes, failed verification, repeated corrections, and stale project context into durable, reviewable context improvements.
---

# Evolve

Use this skill when a task reveals a reusable lesson for future work. The skill
does not replace normal execution. Fix the current task first, then turn the
lesson into durable project context.

Do not invoke this skill for simple one-off tasks unless they expose a repeated
mistake or stale context.

## Commands

### `$evolve init`

Initialize or refresh `.agent-context/` for the current workspace.

Steps:

1. Detect workspace root. If no Git repo or known workspace exists, use the
   current directory.
2. Inspect the project at the depth needed to produce useful context. Do not
   guess. Mark uncertainty explicitly.
3. Create or update:
   - `.agent-context/PROJECT_CONTEXT_INDEX.md`
   - `.agent-context/PROJECT_PROFILE.md`
   - `.agent-context/config.yml`
   - `.agent-context/checklists/`
   - `.agent-context/proposals/`
   - `.agent-context/reports/`
   - `.agent-context/mistakes/`
   - `.agent-context/archive/`
4. Detect relevant domain packs. Multiple domains may apply.
5. Output created/updated files, `contextRead`, detected domains, current
   uncertainties, and the recommended next step.

### `$evolve after-failure`

Run after a user correction, failed test, failed build, failed review, repeated
mistake, missing context read, or stale context discovery.

Steps:

1. State that you will fix the current issue first.
2. Repair the current task and verify when possible.
3. Create a proposal under `.agent-context/proposals/`.
4. Set proposal status to `pending_current_fix` if the current fix is still in
   progress, otherwise `proposed`.
5. Include evidence. Proposals without evidence should not be created.
6. Do not merge the patch into long-term context until approved or allowed by
   `context_write_policy`.

Suggested first sentence after a clear failure:

```text
I will fix the current issue first. After that I will write an evidence-backed context proposal so this class of mistake is less likely to repeat.
```

### `$evolve approve`

Approve one or more proposals.

Default behavior:

1. Read the selected proposal files.
2. Show the context patch that will be applied.
3. Apply only after user approval, unless `context_write_policy` allows direct
   application.
4. Update the proposal status and decision record.
5. Preserve rejected proposals with a rejection reason when provided.

### `$evolve review-context`

Review existing context for:

- Conflicts with current code or docs.
- Outdated assumptions.
- Overlong files.
- Vague or non-actionable rules.
- Too many pending proposals.
- Mistakes that can be archived.
- Domain packs that were misdetected or no longer apply.

When cleanup is needed, write a proposal with `scope` and `deprecation_reason`.

### `$evolve weekly`

Create a compact report under `.agent-context/reports/`.

Report sections:

1. Recurring Mistakes
2. Approved Improvements
3. Pending Proposals
4. Deprecated / Redundant Context
5. Recommended Context Patches
6. Next Week Watchlist

## Proposal Rules

Read `references/proposal-schema.md` before writing proposal files.

One failure should normally produce one proposal, even if the proposal includes
multiple target context patches. Keep proposals reviewable.

If more than 10 proposals are pending, run `$evolve review-context` before
creating another proposal.

## Context Write Policy

Read `.agent-context/config.yml` when present.

Supported policies:

- `propose`: write proposals only. This is the default.
- `notify`: apply allowed changes and notify the user.
- `auto`: apply allowed changes automatically. Use only when the user has
  explicitly opted in.

Global instructions should default to `propose` even if project context is more
permissive.

## Privacy

Never store secrets, customer data, production credentials, private keys, or
unnecessary private conversation text in context files. Keep user corrections
short and paraphrased when possible.

## References

- `references/proposal-schema.md`
- `references/context-budget.md`
- `references/cleanup-policy.md`
- `references/domain-coding.md`
- `references/domain-prd.md`
- `references/domain-seo.md`

