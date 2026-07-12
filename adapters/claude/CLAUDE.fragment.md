# Agent Context Patch

Use the installed `$evolve` skill autonomously when a failure, correction,
stale rule, or recurring workflow lesson is likely to matter again. The user
does not need to invoke `$evolve after-failure` manually.

- Fix and verify the current task before evolving long-term context.
- If `.agent-context/PROJECT_CONTEXT_INDEX.md` exists, read it before making
  workspace-level claims or context changes.
- Default to `auto`. When every `auto` gate passes, persist the proposal audit,
  apply the exact patch immediately through the Commit Kernel, and finish the
  audit before the final response. Do not ask for approval and do not wait for
  a user reply on this eligible path.
- After a successful automatic application, give one compact, non-blocking
  receipt with the lesson, proposal ID, and targets. Do not dump the PatchPlan
  or plan hash unless the user asks.
- If a safety gate requires approval, ask only for that exceptional decision
  and state the blocking reason plainly.
- Never silently modify `CLAUDE.md`, delete Active Context, migrate a legacy
  workspace, activate a domain, or promote a rule to user-global guidance.
- Prefer replace-before-add and propose cleanup when rules overlap, conflict,
  become stale, or no longer earn their context cost.
- Persist evidence pointers and summaries, not raw conversations or full logs.
