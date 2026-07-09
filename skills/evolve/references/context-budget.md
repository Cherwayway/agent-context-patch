# Context Budget

Context should get more useful over time, not simply larger.

Default budgets:

- Global guidance fragment: 120 lines.
- Workspace profile: 500 lines.
- Repo profile: 300 lines.
- Single proposal: 180 lines.
- Weekly report: 250 lines.
- Checklist item: must be executable or directly reviewable.
- Mistake case: keep only if recurrence risk is real.

When a file exceeds budget, do not blindly truncate. Propose one of:

- Move old details to `archive/`.
- Replace examples with a shorter rule.
- Merge duplicated rules.
- Split repo-specific context out of workspace context.
- Delete context that no longer changes agent behavior.

Context that is too vague to guide action should be removed or rewritten.

