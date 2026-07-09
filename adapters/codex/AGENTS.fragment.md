# Agent Context Patch

Use `$evolve` when a mistake, failed verification, repeated correction, stale
context, or recurring workflow issue should become durable project context.

Default behavior:

- Do not use the evolution loop for simple one-off tasks.
- Fix the current task before writing long-term context updates.
- For repeated or high-risk failures, write an evidence-backed proposal under
  `.agent-context/proposals/`.
- Do not silently modify global `AGENTS.md` or project guidance unless the user
  explicitly configured that write policy.
- Include `contextRead` in stage-like or context-sensitive outputs.
- Prefer project/workspace context over chat history as the source of truth.
- Keep context small, current, and actionable. Propose cleanup when old context
  conflicts with current project reality.

When unsure whether to invoke `$evolve`, use a lightweight classification:

- One-time simple change: skip.
- Recurring failure, repeated user correction, or stale project knowledge:
  invoke `$evolve after-failure` or `$evolve review-context`.
