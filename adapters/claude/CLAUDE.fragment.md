# Agent Context Patch

Use the installed `$evolve` skill only when a failure, correction, stale rule,
or recurring workflow lesson is likely to matter again.

- Fix and verify the current task before proposing long-term context.
- If `.agent-context/PROJECT_CONTEXT_INDEX.md` exists, read it before making
  workspace-level claims or context changes.
- Default to `propose`. `auto` is valid only when the deterministic Commit
  Kernel is available and all workspace safety guards pass.
- Never silently modify `CLAUDE.md`, delete Active Context, migrate a legacy
  workspace, activate a domain, or promote a rule to user-global guidance.
- Prefer replace-before-add and propose cleanup when rules overlap, conflict,
  become stale, or no longer earn their context cost.
- Persist evidence pointers and summaries, not raw conversations or full logs.
