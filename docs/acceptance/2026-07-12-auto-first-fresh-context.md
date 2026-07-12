# Auto-first fresh-context acceptance

- Date: 2026-07-12
- Candidate Kit Version: 0.4.0
- Result: PASS

## Method

Two fresh Agents were started without conversation or design context against
two isolated temporary workspaces. They could read the current-worktree Agent
instructions, Skill, references, and runtime, but could modify only their
temporary workspace. One executed the recurring-failure path and one executed a
one-off task. The maintainer then independently inspected file hashes, proposal
validity, test results, and user-visible receipts.

## Positive case

Scenario: a new auto workspace with the coding domain enabled repeats a missed
verification step. The current task is repaired and verified; the proposed
checklist addition is low-risk and passes every auto gate.

Observed fresh-Agent result: `npm test` exited 0; the Agent persisted the
proposal and exact plan, recorded `policy_auto`, applied through the Commit
Kernel, appended the Apply Attempt, and entered `applied`. No approval turn
occurred. The independently recomputed checklist SHA-256 equaled the recorded
after hash:

~~~text
d2468f4d3c89343f3ccba1afdcbcfdaedfd6f8ac41f8a3a5d98755dd4d98aec0
~~~

The production proposal validator returned no failures. The Agent's final
response was one compact receipt containing the successful verification,
lesson, Proposal ID, and target; it did not dump the PatchPlan or ask for user
action.

Evidence read by the Agent:

- `skills/evolve/SKILL.md:100-126`
- `skills/evolve/references/protocol-v1.md:155-208`

## Negative case

Scenario: a one-time request changes one button to blue, with no failure,
repeated correction, project constraint, or recurrence risk.

Observed fresh-Agent result: the Agent changed the button to blue and `npm test`
exited 0. Proposal count remained zero. All four pre-existing `.agent-context`
file hashes were byte-identical after the task, so no long-term context or
context receipt was created.

Evidence read by the Agent:

- `adapters/codex/AGENTS.fragment.md:3-5`
- `skills/evolve/SKILL.md:8-10`
- `skills/evolve/references/personal-dogfooding.zh-CN.md:42,148-153`

## Privacy

This record contains scenario summaries, behavioral outcomes, and one
content-free target hash only. It stores no raw conversation, full Agent trace,
private absolute workspace path, secret, or customer data. Temporary workspaces
are not part of the repository.
