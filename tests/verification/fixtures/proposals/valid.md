---
schema_version: 1
id: fixture-valid-proposal
status: applied
scope: workspace
operation: update
trigger: verification_fixture
current_fix_status: verified
target_files:
  - .agent-context/PROJECT_PROFILE.md
confidence: high
authority: verified_context
retention_value: high
plan_hash: 95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd
created_by: verification
created_at: 2026-07-10T00:00:00Z
updated_at: 2026-07-10T00:00:01Z
privacy:
  raw_conversation_stored: false
  full_logs_stored: false
  secrets_stored: false
  customer_data_stored: false
  absolute_user_paths_stored: false
  redactions: [workspace user path removed]
---

## Observed Failure

Fixture failure.

## Evidence

- kind: verification_failure
- command: node --test tests/verification/proposal-fixtures.test.mjs
- exit_code: 1
- source: tests/verification/fixtures/proposals/valid.md

## Root Cause

Fixture cause.

## Future Risk

Fixture risk.

## Proposed Patch

### PatchPlan JSON

~~~~json
{
  "schemaVersion": 1,
  "planId": "plan-fixture-valid-proposal",
  "proposalId": "fixture-valid-proposal",
  "semanticOperation": "update",
  "requestedPolicy": "propose",
  "policy": "propose",
  "policyReason": "workspace_policy_propose",
  "risk": "high",
  "currentFixStatus": "verified",
  "privacy": {
    "safe": true
  },
  "contextHealth": {
    "autoAllowed": false
  },
  "contextDelta": {
    "activeLinesBefore": 2,
    "activeLinesAfter": 4
  },
  "operations": [
    {
      "type": "update",
      "target": ".agent-context/PROJECT_PROFILE.md",
      "beforeHash": "1111111111111111111111111111111111111111111111111111111111111111",
      "content": "# Project Profile\n\nFixture rule.\n"
    }
  ]
}
~~~~

## Why This Scope

Fixture scope.

## Why Not Broader

Fixture boundary.

## Context Priority

Fixture priority.

## Privacy Check

The persisted evidence is redacted.

## Decision Log

~~~~yaml
- decision: approved
  decided_at: 2026-07-10T00:00:00Z
  decided_by: fixture_user
  plan_hash: 95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd
  reason: Exact fixture plan approved.
~~~~

## Apply Attempts

~~~~yaml
- attempt: 1
  plan_hash: 95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd
  before_hashes:
    .agent-context/PROJECT_PROFILE.md: 1111111111111111111111111111111111111111111111111111111111111111
  result: applied
  attempted_at: 2026-07-10T00:00:01Z
  applied_at: 2026-07-10T00:00:01Z
  after_hashes:
    .agent-context/PROJECT_PROFILE.md: 78c30b878e02b328c81cb90ca9d4ff41223d22c63dd1a09c51192a8d7ea6a5e0
  error_summary: null
~~~~

## Supersession

None.

## Rejection Notes

Not rejected.
