---
schema_version: 1
id: fixture-user-global-promotion
status: proposed
scope: user-global
operation: user_global_promotion
trigger: repeated_observation
current_fix_status: verified
target_files: []
confidence: high
authority: repeated_observation
retention_value: high
plan_hash: null
candidate_hash: 2dcd26abdc7153e0cda202430151cb12eb79f46fd1e5297ead8d7040e7a68700
created_by: verification
created_at: 2026-07-10T00:00:00Z
updated_at: 2026-07-10T00:00:00Z
privacy:
  raw_conversation_stored: false
  full_logs_stored: false
  secrets_stored: false
  customer_data_stored: false
  absolute_user_paths_stored: false
  redactions: [workspace name removed]
---

## Observed Failure

The same safe evidence practice was repeatedly rediscovered.

## Evidence

- kind: repeated_observation
- summary: The same safe evidence practice recurred in multiple workspaces.

## Root Cause

No user-global candidate had been proposed.

## Future Risk

Future workspaces may repeat the same mistake.

## Proposed Patch

### Promotion Candidate JSON

~~~~json
{
  "schemaVersion": 1,
  "proposalId": "fixture-user-global-promotion",
  "scope": "user-global",
  "operation": "user_global_promotion",
  "candidateContent": "Prefer pointer-first evidence across workspaces.\n"
}
~~~~

## Why This Scope

The candidate may apply across workspaces.

## Why Not Broader

An agent adapter must resolve and separately approve the final global target.

## Context Priority

High retention value with repeated-observation authority.

## Privacy Check

Workspace identity was removed.

## Decision Log

None. The adapter has not resolved an exact target.

## Apply Attempts

None.

## Supersession

None.

## Rejection Notes

Not rejected.
