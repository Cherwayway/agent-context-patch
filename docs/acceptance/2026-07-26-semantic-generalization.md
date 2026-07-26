# Semantic generalization fresh-context acceptance

- Date: 2026-07-26
- Candidate Kit Version: 0.5.3
- Workspace Schema: 1
- Fresh Agents: 2
- Result: PASS

## Method

Two fresh Agents were started without conversation, Issue, plan, changelog, or
prior acceptance context. Each followed
`tests/acceptance/review-context-semantic-generalization.runner.json`, could
read only the candidate Skill, cleanup policy, and one neutral case from
`tests/acceptance/fixtures/review-context-semantic-generalization.json`, and
returned the shared structured result schema. They performed a read-only
`$evolve review-context` decision and did not edit the fixture or repository.

The fixture describes applied-proposal summaries by responsibility, trigger,
execution path, intended effect, observable verification, broken stage, and
domain detail. It does not provide an expected decision or generalized wording.

## Case A: cross-noun recurring failure

Case `case-a` produced decision `candidate`. Its structured result is
`docs/acceptance/results/2026-07-26-semantic-generalization-case-a.json`.

The Agent proposed one testable invariant: exercise an exposed action through
its real trigger and registered execution path to the implementation that owns
the promised effect, then observe that effect rather than accepting parsing,
registration, or visible surface state alone.

It included four active rules and their evidence pointers:

- `rule-web-control` / `2026-07-01-visible-control-dispatch`
- `rule-cli-option` / `2026-07-02-cli-option-execution`
- `rule-extension-hook` / `2026-07-03-extension-hook-invocation`
- `rule-scheduled-job` / `2026-07-04-scheduled-job-execution`

It excluded the keyboard-accessibility and hook-retry-idempotency decoys even
though they reuse the browser-control and extension-hook nouns.

The review preserved the domain-specific checks: browser reload proves
durability, export content proves selected scope, the extension event must flow
through the host dispatcher, and the test clock must cross the scheduler
boundary before expired-record removal is observed.

It explicitly excluded accessibility, privacy, idempotency, and timing
correctness. Narrow unit tests remain useful but cannot alone satisfy the
end-to-end invariant. The proposed change replaces four rules with one
invariant while retaining both excluded rules, for a net active-context delta
of `-3`; proposal history remains intact. Because this is semantic replacement,
the Agent required human approval.

## Case B: shared surfaces without a shared failure shape

Case `case-b` produced decision `no_candidate`. Its structured result is
`docs/acceptance/results/2026-07-26-semantic-generalization-case-b.json`.

The Agent kept all four rules separate because they protect different
responsibilities: keyboard access, credential redaction, retry idempotency, and
time-zone semantics. It retained their focus/role, fallback-redaction,
event-identity, and daylight-saving details. A forced merge would weaken those
distinct guarantees.

The net active-context change was zero. No cleanup proposal or approval request
was created.

## Boundary and privacy

The acceptance exercised Agent judgment, not a keyword matcher. The candidate
adds no embedding store, similarity threshold, deterministic clusterer,
automatic semantic merge, new command, background scan, or Workspace Schema
change. Weekly reporting may surface a candidate but cannot apply it.

This record contains only sanitized fixture IDs, short behavior summaries, and
decisions. It stores no raw conversation or full Agent trace, no secret or
customer data, and no private absolute path.
