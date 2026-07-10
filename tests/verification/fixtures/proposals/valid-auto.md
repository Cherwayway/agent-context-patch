---
schema_version: 1
id: fixture-valid-auto
status: applied
scope: workspace
operation: add
trigger: repeated_observation
current_fix_status: verified
target_files:
  - .agent-context/PROJECT_PROFILE.md
confidence: high
authority: verified_context
retention_value: high
plan_hash: d01423ad9cb2070285eae8842b6d978b56c3311c72c1d28923d82804a79ef325
created_by: verification
created_at: 2026-07-11T00:00:00Z
updated_at: 2026-07-11T00:00:01Z
privacy:
  raw_conversation_stored: false
  full_logs_stored: false
  secrets_stored: false
  customer_data_stored: false
  absolute_user_paths_stored: false
  redactions: [workspace name removed]
---

## Observed Failure

A verified low-risk rule was repeatedly omitted.

## Evidence

- kind: repeated_observation
- pointer: tests/verification/fixtures/proposals/valid-auto.md
- summary: The static profile target is eligible for the configured auto policy.

## Root Cause

The active profile lacked the verified rule.

## Future Risk

The same omission can recur.

## Proposed Patch

### PatchPlan JSON

~~~~json
{
  "schemaVersion": 1,
  "planId": "plan-fixture-valid-auto",
  "proposalId": "fixture-valid-auto",
  "semanticOperation": "add",
  "requestedPolicy": "auto",
  "policy": "auto",
  "policyReason": "auto_eligible",
  "risk": "low",
  "currentFixStatus": "verified",
  "privacy": {
    "safe": true
  },
  "contextHealth": {
    "autoAllowed": true
  },
  "contextDelta": {
    "activeLinesBefore": 2,
    "activeLinesAfter": 4
  },
  "operations": [
    {
      "type": "create",
      "target": ".agent-context/PROJECT_PROFILE.md",
      "beforeHash": null,
      "content": "# Project Profile\n\nAuto rule.\n"
    }
  ]
}
~~~~

## Why This Scope

The rule is workspace-specific.

## Why Not Broader

No global behavior is changed.

## Context Priority

Verified context with high retention value.

## Privacy Check

Only a sanitized summary is stored.

## Decision Log

~~~~yaml
- decision: policy_auto
  decided_at: 2026-07-11T00:00:00Z
  decided_by: policy_engine
  plan_hash: d01423ad9cb2070285eae8842b6d978b56c3311c72c1d28923d82804a79ef325
  reason: auto_eligible
~~~~

## Apply Attempts

~~~~yaml
- attempt: 1
  plan_hash: d01423ad9cb2070285eae8842b6d978b56c3311c72c1d28923d82804a79ef325
  before_hashes:
    .agent-context/PROJECT_PROFILE.md: null
  result: applied
  attempted_at: 2026-07-11T00:00:01Z
  applied_at: 2026-07-11T00:00:01Z
  after_hashes:
    .agent-context/PROJECT_PROFILE.md: 26190130caf550c42e6d20152c8f18a341340cf171b2236cc72b8437e0448a28
  error_summary: null
~~~~

## Supersession

None.

## Rejection Notes

Not rejected.
