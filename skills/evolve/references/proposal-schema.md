# Proposal Schema v1

Save each proposal aggregate as:

~~~text
.agent-context/proposals/YYYY-MM-DD-short-slug.md
~~~

README files are directory guidance and are not proposals.

## Frontmatter

~~~yaml
---
schema_version: 1
id: 2026-07-10-context-read-gate
status: proposed
scope: workspace
operation: add
trigger: verification_failure
current_fix_status: verified
target_files:
  - .agent-context/PROJECT_PROFILE.md
confidence: high
authority: current_source
retention_value: high
plan_hash: <64 lowercase hexadecimal characters>
# candidate_hash is present only for an unresolved user-global promotion
created_by: agent
created_at: 2026-07-10T10:00:00Z
updated_at: 2026-07-10T10:00:00Z
privacy:
  raw_conversation_stored: false
  full_logs_stored: false
  secrets_stored: false
  customer_data_stored: false
  absolute_user_paths_stored: false
  redactions: []
---
~~~

Do not store approval_required. Approval is derived from operation, target,
policy, and the hard gates in protocol-v1.md.

## Required fields

status:

- pending_current_fix
- proposed
- approved
- rejected
- applied
- superseded
- archived

scope:

- workspace
- user-global, only when operation is user_global_promotion

operation:

- add
- update
- tighten
- merge
- rewrite
- supersede
- demote_to_checklist
- archive_example
- archive_rule
- domain_enable
- domain_disable
- migration
- user_global_promotion

trigger examples:

- user_correction
- verification_failure
- review_failure
- missing_context_read
- stale_context
- repeated_observation
- agent_self_detected

current_fix_status:

- not_started
- in_progress
- fixed
- verified

confidence and retention_value:

- low
- medium
- high

authority, ordered by the source that supports the statement:

- user_decision
- current_source
- verified_context
- repeated_observation
- heuristic

For current-state facts, current code, tests, formal specs, and ADRs are
authoritative. For desired future state, an explicit approved user decision is
authoritative. Never present a future goal as current fact.

target_files must be non-empty, workspace-relative, use forward slashes, and
contain no parent traversal for workspace operations. A user-global promotion
uses an empty target_files list until the selected agent adapter resolves its
separately approved target.

For workspace scope, plan_hash is null while status is pending_current_fix and
is required from proposed onward. It is the canonical JSON SHA-256 of the full
PatchPlan stored under Proposed Patch.

target_files contains context patch targets only. Never list the proposal
aggregate itself as a target; its mutable audit log is written before and after
the kernel boundary. For a workspace proposal, target_files must equal the
PatchPlan operation targets in the same order.

All five privacy outcome fields are required and must be false. redactions is a
list of short descriptions and may be empty. Redact unsafe evidence before
writing the proposal; do not record a true value as permission to retain it.

## Required body

~~~md
## Observed Failure

State the factual observation without copying the full incident.

## Evidence

- Kind:
- Pointer:
- Command and exit code:
- Result summary:

## Root Cause

Explain why current context or workflow allowed the failure.

## Future Risk

Explain the likely recurrence and consequence.

## Proposed Patch

For workspace scope, store exactly one complete JSON PatchPlan as defined below.
For user-global promotion, store the sanitized candidate form.

### PatchPlan JSON

Use a four-tilde JSON fence so Markdown-like text inside complete target content
cannot terminate extraction.

## Why This Scope

Explain why workspace is correct, or why this is a sanitized user-global
promotion candidate.

## Why Not Broader

State why the lesson should not affect unrelated workspaces.

## Context Priority

- Authority:
- Retention value:
- Existing overlap:
- Net active-context change:

## Privacy Check

Confirm pointer-first evidence and explain any redactions.

## Decision Log

Append decisions; do not rewrite prior entries.

## Apply Attempts

Append each applied, failed, conflict, or rolled-back attempt.

## Supersession

Name the replacing proposal or state None.

## Rejection Notes

Record the decision reason or state Not rejected.
~~~

## Persisted workspace PatchPlan

Proposed Patch contains one JSON code block with this complete,
JSON-serializable object:

### PatchPlan JSON

~~~~json
{
  "schemaVersion": 1,
  "planId": "2026-07-10-context-read-gate-plan-1",
  "proposalId": "2026-07-10-context-read-gate",
  "semanticOperation": "add",
  "requestedPolicy": "propose",
  "policy": "propose",
  "policyReason": "workspace_policy_propose",
  "risk": "low",
  "currentFixStatus": "verified",
  "privacy": {
    "safe": true
  },
  "contextHealth": {
    "autoAllowed": true
  },
  "contextDelta": {
    "activeLinesBefore": 100,
    "activeLinesAfter": 101
  },
  "operations": [
    {
      "type": "update",
      "target": ".agent-context/PROJECT_PROFILE.md",
      "beforeHash": "<64 lowercase hexadecimal characters>",
      "content": "<complete UTF-8 target content, including final newline>"
    }
  ]
}
~~~~

Required rules:

- The persisted object has no workspaceRoot and no planHash. Those are
  runtime-only inputs.
- planId and proposalId are stable identifiers; proposalId equals frontmatter
  id.
- semanticOperation equals frontmatter operation and is included in canonical
  hashing. It records the context meaning independently of file-level create or
  update operations.
- requestedPolicy and policy are propose or auto. policy is the effective
  policy and policyReason is a
  non-empty machine-readable explanation.
- risk is low or high. currentFixStatus equals frontmatter
  current_fix_status.
- privacy.safe is true; the five detailed storage outcomes remain in proposal
  frontmatter.
- contextHealth.autoAllowed is an explicit boolean.
- contextDelta contains integer activeLinesBefore and activeLinesAfter for the
  whole active default read set, measured with the configured line unit.
- operations are create or update. A create has beforeHash null; an update has
  the exact current SHA-256.
- content is the complete post-apply target, not a diff, excerpt, or evidence
  transcript.

Canonicalize by recursively sorting object keys, preserving array order, and
serializing with standard compact JSON. Hash its UTF-8 bytes with SHA-256 and
write the lowercase hexadecimal value to frontmatter plan_hash.

At runtime, add absolute workspaceRoot and planHash to the parsed object.
computePlanHash excludes exactly those two runtime-only fields, so it must
reproduce the persisted hash.

Once Decision Log or Apply Attempts contains an entry, the PatchPlan is
immutable. A changed plan requires a new superseding proposal. Every
Decision Log and Apply Attempt plan_hash in one aggregate must equal
frontmatter plan_hash and the recomputed hash.

Auto requires semanticOperation add. update, tighten, merge, rewrite,
supersede, demote_to_checklist, archive_example, archive_rule, domain_enable,
domain_disable, migration, and user_global_promotion require exact approval
regardless of their file-level operations.

## User-global promotion candidate

Before an adapter resolves its actual target, a user-global promotion has:

- target_files: []
- plan_hash: null
- candidate_hash: <64 lowercase hexadecimal characters>
- status: proposed
- no approved or policy_auto Decision
- no workspace PatchPlan

Proposed Patch instead contains a sanitized JSON candidate:

### Promotion Candidate JSON

~~~~json
{
  "schemaVersion": 1,
  "proposalId": "promotion-example",
  "scope": "user-global",
  "operation": "user_global_promotion",
  "candidateContent": "<sanitized reusable guidance>"
}
~~~~

Write candidate_hash in frontmatter as the canonical JSON SHA-256 using the
same algorithm as PatchPlan. It binds the candidate for comparison but is not
approval to write. candidateContent is a JSON string; any intentional final
newline is part of that string, so hashing has no fence or platform-line-ending
ambiguity. The selected adapter must resolve its real target, produce its own
exact plan, and request approval there. The workspace validator and kernel
neither recompute nor apply that adapter plan.

## Decision Log shape

~~~yaml
- decision: approved
  decided_at: 2026-07-10T10:05:00Z
  decided_by: user
  plan_hash: <64 lowercase hexadecimal characters>
  reason: Exact patch approved.
~~~

Valid decisions are approved, rejected, and policy_auto. An approval refers to
one plan_hash. For workspace proposals it must equal frontmatter plan_hash and
the recomputed PatchPlan hash. Preserve rejected proposals and their reason.

## Apply Attempts shape

~~~yaml
- attempt: 1
  plan_hash: <approved plan hash>
  before_hashes:
    .agent-context/PROJECT_PROFILE.md: <sha256 or null for a new file>
  result: applied
  attempted_at: 2026-07-10T10:05:01Z
  applied_at: 2026-07-10T10:05:01Z
  after_hashes:
    .agent-context/PROJECT_PROFILE.md: <sha256>
  error_summary: null
~~~

Valid results are applied, conflict, failed, and rolled_back. attempted_at is
always required; applied_at appears only for applied. The agent maps the
kernel's content-free status and reason into these audit fields. Failed attempts
do not change status from approved. Every attempt plan_hash must equal the
aggregate frontmatter and recomputed PatchPlan hash.

Terminal status remains derivable from this history. `superseded` requires a
valid applied history and a non-empty Supersession target. `archived` requires
either that superseded history or a rejected Decision with meaningful Rejection
Notes and no Apply Attempt. Empty history can never be relabeled archived.

## Evidence requirements

At least one concrete item is required:

- workspace-relative file and line pointer
- command, exit code, and short result summary
- current spec, issue, review, or ADR pointer
- short paraphrase of a user correction
- stale or missing context pointer

Prefer reproducible pointers. Do not create proposals from a guess alone.
