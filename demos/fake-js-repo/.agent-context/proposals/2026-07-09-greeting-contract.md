---
id: 2026-07-09-greeting-contract
status: applied
scope: repo
trigger: verification_failure
current_fix_status: verified
target_files:
  - .agent-context/PROJECT_PROFILE.md
  - .agent-context/checklists/coding.md
confidence: high
approval_required: true
created_by: demo
created_at: 2026-07-09
applied_at: 2026-07-09
---

## Observed Failure

The implementation changed greeting behavior in a way that would not preserve
caller-provided names.

## Evidence

- Command: `npm test`
- File: `test/greeting.test.js`
- Project rule added after approval: greeting output must preserve
  caller-provided names.

## Root Cause

The project had no durable rule describing the greeting contract.

## Future Risk

Future edits to `src/greeting.js` could hard-code names or change output shape
without noticing.

## Proposed Patch

Add a working rule to `PROJECT_PROFILE.md` and a checklist item to
`checklists/coding.md`.

## Why This Scope

The rule is specific to this repo's greeting behavior.

## Why Not Broader

This does not apply to other repositories or user-global preferences.

## Privacy Check

No secrets, customer data, production credentials, or private conversation text
are stored.

## Rejection Notes

Not rejected. Demo proposal was applied.

