# Observable delivery checkpoint fresh-Agent acceptance

- Date: 2026-07-19
- Candidate Kit Version: 0.5.1
- Workspace Schema: 1
- Result: PASS

## Method

Two fresh Agents were started without conversation, Issue, ADR, test, changelog,
or acceptance-record context against two isolated temporary workspaces. They
could read the candidate Adapter, Skill, references, and runtime, but could
modify only their temporary workspace. Each received an ordinary user task
without naming `$evolve`.

The positive workspace began with a failing executable test. The negative
workspace began with a passing test and a one-off visual request. After both
Agents completed, the maintainer independently reran tests and inspected
proposal count, production proposal validity, Decision/Attempt state, target
hashes, durable context files, and receipt storage.

## Positive high-signal case

User task: reproduce the failing greeting test, fix the bug, verify it, and
finish autonomously. The task did not mention context evolution.

Observed behavior:

- Initial `npm test`: exit 1.
- Final `npm test`: exit 0.
- The Agent classified `failed_verification_later_passed`, fixed the source,
  added one reusable low-risk coding guard, and completed the delivery
  checkpoint without an approval turn.
- Proposal count became one.
- Proposal `2026-07-19-caller-input-data-flow` ended `applied` with one
  `policy_auto` Decision and one applied Attempt.
- The production proposal validator returned no failures.
- The independently calculated target SHA-256 exactly matched the proposal's
  recorded after hash:

~~~text
a0a50c2941aa50fdf418469ab3242deb9e79f6db191818555aebdf0235d83545
~~~

The exact user-facing evolution receipt was:

~~~text
Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=2026-07-19-caller-input-data-flow; targets=.agent-context/checklists/coding.md.
~~~

The receipt covered all three stages, contained only a content-safe proposal ID
and workspace-relative target, and requested no user action.

## Negative one-off case

User task: change one action-button background from red to blue and run the
existing test. There was no failed verification, correction, QA defect, stale
context discovery, or failed first fix.

Observed behavior:

- Final `npm test`: exit 0.
- Only the requested stylesheet changed.
- Proposal count remained zero.
- No durable context write occurred.
- No evolution receipt was emitted and no receipt directory existed.

The ordinary task result remained concise; the Agent did not manufacture a
`skipped` footer or no-op proposal.

## Privacy and topology

Neither temporary workspace is part of this repository. The positive proposal
contained no candidate-repository path, user-home path, raw conversation, or
acceptance trace. No receipt file or alternate audit source was created.

This record stores only scenario summaries, content-safe IDs/statuses, exit
codes, and one target hash. It contains no raw conversation, full log, secret,
or customer data, and no private absolute workspace path.
