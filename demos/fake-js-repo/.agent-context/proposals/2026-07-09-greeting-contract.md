---
schema_version: 1
id: 2026-07-09-greeting-contract
status: applied
scope: workspace
operation: add
trigger: verification_failure
current_fix_status: verified
target_files:
  - .agent-context/PROJECT_PROFILE.md
  - .agent-context/checklists/coding.md
confidence: high
authority: current_source
retention_value: high
plan_hash: 703294a47871d13777c95c643ed34e6526e440a90f306f0e3fffdf7a8fbd6f11
created_by: demo_fixture
created_at: 2026-07-09T14:00:00Z
updated_at: 2026-07-09T14:05:01Z
privacy:
  raw_conversation_stored: false
  full_logs_stored: false
  secrets_stored: false
  customer_data_stored: false
  absolute_user_paths_stored: false
  redactions: []
---

## Observed Failure

The demo's initial greeting implementation ignored the name supplied by its
caller.

## Evidence

- Kind: verification_failure
- Pointer: test/greeting.test.js:3
- Command and exit code: npm test initially failed; it exited 0 after repair.
- Result summary: the current test requires greeting("Ada") to return
  "Hello, Ada!".

## Root Cause

The workspace had no durable rule or coding check for the caller-provided name
contract.

## Future Risk

A later edit could hard-code a name and pass casual inspection unless the
contract remains active and the focused test is run.

## Proposed Patch

### PatchPlan JSON

~~~~json
{
  "schemaVersion": 1,
  "planId": "2026-07-09-greeting-contract-plan-1",
  "proposalId": "2026-07-09-greeting-contract",
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
    "activeLinesBefore": 58,
    "activeLinesAfter": 60
  },
  "operations": [
    {
      "type": "update",
      "target": ".agent-context/PROJECT_PROFILE.md",
      "beforeHash": "8ff66455419ef5dc4904d0d48f6ac8281f45bec43fb5abd93c2de958855151b0",
      "content": "# Project Profile\n\n## Product / Project\n\n- Name: Fake JS Repo\n- Purpose: Demonstrate the automatic $evolve after-failure flow.\n- Current status: Verified fixture.\n\n## Enabled Domains\n\nDerived from config.yml:\n\n- coding\n\n## Technical Context\n\n- Main language: JavaScript\n- Test command: npm test\n\n## Active Working Rules\n\n- Greeting output must preserve caller-provided names.\n- Run npm test after changing src/greeting.js.\n\n## Known Risks\n\n- A hard-coded greeting could silently ignore the caller-provided name.\n\n## Current Uncertainties\n\n- None for the demonstrated greeting contract.\n\n## Verification State\n\n- Last verified at: 2026-07-10\n- Verified against: package.json, test/greeting.test.js, and npm test.\n"
    },
    {
      "type": "update",
      "target": ".agent-context/checklists/coding.md",
      "beforeHash": "638dafbc096b3430206ae43f6f47357ea7351e4f999d59b98992f0c3636b1041",
      "content": "# Coding Checklist\n\nMaterialized from the coding domain pack because config.yml enables coding.\n\n- Read PROJECT_PROFILE.md before editing.\n- Preserve caller-provided names in greeting output.\n- Run npm test after changing src/greeting.js.\n- Use replace-before-add for any reusable failure lesson.\n"
    }
  ]
}
~~~~

## Why This Scope

The contract belongs to this workspace and its fake greeting implementation.

## Why Not Broader

It does not guide unrelated repositories, workspaces, or user-global behavior.

## Context Priority

- Authority: current_source; test/greeting.test.js enforces the contract.
- Retention value: high; forgetting it recreates a user-visible regression.
- Existing overlap: none in the modeled before state.
- Net active-context change: two executable lines across two active files.

## Privacy Check

Evidence uses workspace-relative pointers and a short test summary. It stores no
raw conversation, complete log, secret, customer data, or absolute user path.

## Decision Log

~~~yaml
- decision: policy_auto
  decided_at: 2026-07-09T14:05:00Z
  decided_by: agent
  plan_hash: 703294a47871d13777c95c643ed34e6526e440a90f306f0e3fffdf7a8fbd6f11
  reason: All low-risk workspace auto gates passed.
~~~

## Apply Attempts

~~~yaml
- attempt: 1
  plan_hash: 703294a47871d13777c95c643ed34e6526e440a90f306f0e3fffdf7a8fbd6f11
  before_hashes:
    .agent-context/PROJECT_PROFILE.md: 8ff66455419ef5dc4904d0d48f6ac8281f45bec43fb5abd93c2de958855151b0
    .agent-context/checklists/coding.md: 638dafbc096b3430206ae43f6f47357ea7351e4f999d59b98992f0c3636b1041
  result: applied
  attempted_at: 2026-07-09T14:05:01Z
  applied_at: 2026-07-09T14:05:01Z
  after_hashes:
    .agent-context/PROJECT_PROFILE.md: d1d4a3cf544a1575fa9fb32a6994e4d0032db7e5378716da31582c39a0d0feab
    .agent-context/checklists/coding.md: 7b5a9cf81f4ce715d407a8bdb827f23f073da95aa0a2f8939d5f98317eca6c3f
  error_summary: null
~~~

## Supersession

None.

## Rejection Notes

Not rejected.
