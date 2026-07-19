# Agent Context Patch

Use the installed `$evolve` skill autonomously when a failure, correction,
stale rule, or recurring workflow lesson is likely to matter again. The user
does not need to invoke `$evolve after-failure` manually.

- Fix and verify the current task before evolving long-term context.
- If `.agent-context/PROJECT_CONTEXT_INDEX.md` exists, read it before making
  workspace-level claims or context changes.
- At the delivery checkpoint, after the current fix is verified, run the
  evolution checkpoint when any high-signal event occurred:
  `failed_verification_later_passed`, `explicit_user_correction`,
  `independent_qa_defect`, `stale_context`, or
  `first_fix_failed_then_passed`.
- The Agent owns the semantic `detect` and `propose` results. Pass them, the
  content-safe proposal ID when one exists, and the exact Lifecycle Coordinator
  result to `finalizeEvolutionOutcome` from `runtime/outcome.mjs`. Never invent
  `apply`. Print only `receipt.text`: one compact, non-blocking receipt covering
  `detect`, `propose`, and `apply`, stable non-success reasons, and the proposal
  ID and workspace-relative targets when available.
- If there is no high-signal trigger, stay silent: do not create a proposal or
  durable context write merely to emit an outcome. Use `detect: skipped` only
  when an explicit diagnostic result is required.
- Default to `auto`. When every `auto` gate passes, persist the proposal audit,
  apply the exact patch immediately through the Commit Kernel, and finish the
  audit before the final response. Do not ask for approval and do not wait for
  a user reply on this eligible path.
- If a safety gate requires approval, ask only for that exceptional decision
  and state the blocking reason plainly.
- Never silently modify `CLAUDE.md`, delete Active Context, migrate a legacy
  workspace, activate a domain, or promote a rule to user-global guidance.
- Prefer replace-before-add and propose cleanup when rules overlap, conflict,
  become stale, or no longer earn their context cost.
- Persist evidence pointers and summaries, not raw conversations or full logs.
