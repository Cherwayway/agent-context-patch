# Agent Context Patch vs. Claude Code Auto Memory

Claude Code Auto Memory and Agent Context Patch solve different layers of the
same problem. Auto Memory is convenient personal recall. Agent Context Patch is
reviewable workspace governance for lessons that a team or more than one coding
agent must rely on.

They can be used together.

| Question | Claude Code Auto Memory | Agent Context Patch |
| --- | --- | --- |
| Who decides what to remember? | Claude decides which notes may help later. | The Agent acts only on a high-signal, verified failure or correction. |
| Where does it live? | Machine-local, per-repository memory shared across that repository's worktrees. | `.agent-context/rules/<id>.md` in the workspace, plus a generated catalog block in `AGENTS.md`, all reviewable and shareable through the repository. |
| Which agents use it? | Claude Code. | Claude Code and OpenAI Codex read the same catalog; Codex reads `AGENTS.md` literally and Claude Code imports it. |
| How is a change authorized? | Claude writes its own memory notes. | One `evolve apply` call runs mechanical gates; only an overlapping hook or an over-budget catalog needs a human `--approved`. |
| What is mechanically enforced? | Memory is context, not enforced configuration. | Byte budgets for hooks, bodies, and the catalog; a privacy scan; a similarity gate against active hooks; hash-checked profile edits; atomic writes with an audit diff; and a re-rendered catalog. Rules still guide rather than hard-enforce agent behavior. |
| How is stale context handled? | Claude keeps a concise index and can reorganize details. | Replace-before-add is a gate, dated state expires automatically, and `weekly` lists never-consulted rules and similar hooks as merge candidates. |
| What audit exists? | Users can inspect and edit memory with Claude Code's memory tools. | One audit record per applied change with evidence, before/after hashes, and a unified diff; `consult` counters record which rules were actually used. |

## Use Auto Memory when

- you want zero-setup personal recall on one machine;
- the learning is a private preference or convenient local note;
- no teammate or second Agent needs the same durable rule.

## Use Agent Context Patch when

- the same verified mistake could recur in later Agent tasks;
- Claude Code and Codex need the same repository-specific lesson;
- the lesson must be reviewed, versioned, and shared with collaborators;
- context changes need budget, privacy, and rollback boundaries;
- stale, duplicated, or contradictory instructions need an explicit lifecycle.

## The boundary

Agent Context Patch does not replace Claude's memory and does not claim to make
instructions deterministic. Semantic judgment remains with the Agent. The
deterministic runtime is deliberately narrow: it makes the context *write*
safe, exact, and auditable, and keeps the read side small enough to always be
in front of the agent.

To install from Claude Code's plugin interface, return to the
[Quick Install](../README.md#quick-install). For Codex or another Agent, use the
same immutable Release through the Agent-facing install prompt.
