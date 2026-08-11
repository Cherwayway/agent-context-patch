# Context effectiveness fresh-Agent acceptance

- Date: 2026-08-11
- Candidate Kit Version: 0.5.5
- Workspace Schema: 1
- Fresh Agents: 6
- Result: PASS

## Method

Six fresh Agents were started in separate temporary directories without prior
conversation, project rules, GitHub Issue, changelog, or another run's result.
Every run used a read-only sandbox and a strict structured-output schema. The
maintainer harness then bound each retained result to canonical-LF SHA-256
digests of its candidate and harness inputs.

Two Agents performed a bounded semantic effectiveness review. Four Agents
formed two baseline/candidate pairs: one relevant package-metadata task and one
unrelated prose-only task. Each impact Agent could read only its own fixture
variant, so a baseline run could not inspect the candidate rule.

## Bounded effectiveness review

Case `mixed-bounded-evidence` is retained at
`docs/acceptance/results/2026-08-11-context-effectiveness-mixed.json`.
The fresh Agent classified:

- the isolated-verification rule as `material_use` because the rule changed the
  environment strategy and observable verification passed without worktree or
  lockfile drift;
- the context-index rule as `relevant_but_missed` because the preventable
  failure recurred after activation;
- the release rule as `not_applicable` for a documentation-only task even
  though context was loaded; and
- the rollback-copy rule as `unknown` because no bounded opportunity evidence
  was available;
- the full-suite rule as `loaded_only` because the task independently required
  the same verification and no retained evidence showed that context changed
  the plan.

It scheduled semantic review and proposed an approval-required rewrite
candidate for the repeated miss. It did not treat low use as permission to
remove context.

Case `absence-is-not-disuse` is retained at
`docs/acceptance/results/2026-08-11-context-effectiveness-absence.json`.
The fresh Agent kept the destructive-operation rule at `unknown`, classified
the release rollback rule as `not_applicable` to README prose, and created no
cleanup proposal or semantic-review ceremony.

## Relevant paired impact

For `package-metadata-change`, the no-rule `baseline` selected `unit_check` in
`docs/acceptance/results/2026-08-11-rule-impact-package-baseline.json`. The
fixture's external outcome map shows that this action passes unit tests but does
not validate packaged metadata, so the required boundary remains unobserved.

The isolated `candidate` run selected `distribution_check` in
`docs/acceptance/results/2026-08-11-rule-impact-package-candidate.json`. The
same external outcome map records `artifact_manifest_match` and satisfies the
required package-metadata boundary. The difference between the pair is the
candidate Active Context rule.

## Unrelated negative pair

For `prose-only-change`, both the `baseline` result at
`docs/acceptance/results/2026-08-11-rule-impact-prose-baseline.json` and the
`candidate` result at
`docs/acceptance/results/2026-08-11-rule-impact-prose-candidate.json` selected
`docs_check`. The package-specific rule therefore did not broaden its trigger
or force distribution verification onto unrelated prose work.

## Boundary and privacy

This acceptance checks Agent-owned semantics and an externally mapped fixture
outcome. It adds no deterministic meaning classifier, task scanner, telemetry,
daemon, raw usage ledger, per-task receipt, or Workspace Schema migration.

The retained evidence contains no raw task or conversation, no full Agent
trace, no source code, no secret or customer data, no username, and no private
absolute path. Repository files were not mutated by the fresh Agents.
