# Agent Context Patch vs. Claude Code Auto Memory

Claude Code Auto Memory and Agent Context Patch solve different layers of the
same problem. Auto Memory is convenient personal recall. Agent Context Patch is
reviewable workspace governance for lessons that a team or more than one coding
agent must rely on.

They can be used together.

| Question | Claude Code Auto Memory | Agent Context Patch |
| --- | --- | --- |
| Who decides what to remember? | Claude decides which notes may help later. | The Agent acts only on a high-signal, verified failure or correction. |
| Where does it live? | Machine-local, per-repository memory shared across that repository's worktrees. | Workspace files that can be reviewed and shared through the repository. |
| Which agents use it? | Claude Code. | Claude Code and OpenAI Codex through their own adapters. |
| How is a change authorized? | Claude writes its own memory notes. | An exact PatchPlan is checked against policy; risky changes require approval. |
| What is mechanically enforced? | Memory is context, not enforced configuration. | The Commit Kernel enforces allowed paths, hashes, conflicts, and rollback for context writes. Active Context still guides rather than hard-enforces agent behavior. |
| How is stale context handled? | Claude keeps a concise index and can reorganize details. | Replace-before-add, explicit context budgets, and approval-gated cleanup prevent silent accumulation. |
| What audit exists? | Users can inspect and edit memory with Claude Code's memory tools. | Proposal evidence, decisions, apply attempts, and before/after hashes form a workspace audit trail. |

## Use Auto Memory when

- you want zero-setup personal recall on one machine;
- the learning is a private preference or convenient local note;
- no teammate or second Agent needs the same durable rule.

## Use Agent Context Patch when

- the same verified mistake could recur in later Agent tasks;
- Claude Code and Codex need the same repository-specific lesson;
- the lesson must be reviewed, versioned, and shared with collaborators;
- context changes need path, conflict, privacy, and rollback boundaries;
- stale, duplicated, or contradictory instructions need an explicit lifecycle.

## The boundary

Agent Context Patch does not replace Claude's memory and does not claim to make
instructions deterministic. Semantic judgment remains with the Agent. The
deterministic kernel is deliberately narrow: it makes the context *write* safe,
exact, and auditable.

To install from Claude Code's plugin interface, return to the
[Quick Install](../README.md#quick-install). For Codex or another Agent, use the
same immutable Release through the Agent-facing install prompt.
