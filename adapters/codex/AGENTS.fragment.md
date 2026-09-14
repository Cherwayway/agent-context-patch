# Agent Context Patch

The `acp-catalog` block below is the workspace's active context: one hook per
rule, grouped by repo and operation, then dated STATE. Read it before acting.

- When a hook matches the task, read the rule body before the first edit:
  `.agent-context/rules/<id>.md`, or run `evolve select` with a task
  signature built from paths, ops, skills, and repos (never the raw prompt).
- Fix and verify the current task before evolving long-term context.
- After the fix is verified, run the evolution checkpoint only for a
  high-signal event (`failed_verification_later_passed`,
  `explicit_user_correction`, `independent_qa_defect`, `stale_context`,
  `first_fix_failed_then_passed`): author one proposal and call
  `evolve apply`; on `similar_rule_exists`, supersede instead of rewording.
  Otherwise stay silent: no proposal, no receipt.
- Print only receipts: the `Evolution outcome:` line returned by `apply` or
  by `evolve receipt`, never lesson prose, proposal JSON, or a diff.
- At the end of any task that read rule bodies, run
  `evolve consult --consulted <ids> [--missed <ids>]` with the ids that
  actually influenced the work, and print its `Context use:` line.
- Never edit the managed `acp-catalog` block in `AGENTS.md` by hand, and never
  edit `AGENTS.md` outside it on evolve's behalf; `evolve catalog --write`
  re-renders the block.
- Persist evidence pointers and summaries, not raw conversation, secrets, or
  absolute user paths.
