# Protocol v2 (Kit 0.8.0, Workspace Schema 2)

This document is normative for the files under `.agent-context/`, the
proposal input accepted by `apply`, the catalog block, the task signature,
selection semantics, gates, receipts, and CLI exit codes. Where this document
and the runtime disagree, the runtime is the bug.

Sizes are UTF-8 bytes. Dates are ISO `YYYY-MM-DD`. Identifiers match
`^[a-z0-9][a-z0-9-]{0,79}$`.

## Workspace layout

```text
.agent-context/
  config.yml
  rules/<id>.md
  STATE.yml
  PROFILE.md
  README.md
  proposals/<id>.md
  reports/weekly-<date>.md
  archive/
    rules/<id>.md
    state.yml
    proposals-v1/
    checklists-v1/
    PROJECT_PROFILE-v1.md
  .lock            (held during normal Schema 2 mutations and CLI snapshot reads)
```

## config.yml

```yaml
schema_version: 2
kit_version: 0.8.0
write_policy: auto
agents_file: AGENTS.md
budgets:
  catalog_bytes: 8192
  hook_bytes: 160
  body_bytes: 1500
  select_bytes: 12288
  similarity_block: 0.5
state:
  default_ttl_days: 14
  max_ttl_days: 90
```

- Exactly these keys; unknown or missing keys make the workspace invalid.
- `schema_version` must be `2`. Any other value is not loadable; a Schema 1
  workspace is converted once by `migrate-v1`.
- `kit_version` is a semantic version string.
- `write_policy` is `auto` or `propose`.
- `agents_file` is a bare file name in the workspace root.
- The four byte budgets are positive integers; `similarity_block` is a number
  in `(0, 1]`.
- `default_ttl_days <= max_ttl_days`, both positive integers.

## Rule file: rules/<id>.md

```markdown
---
id: hot-table-partial-index-cic
hook: "Adding a partial index on a hot table: run CIC in its own workflow step and reject the batch when it fails."
kind: gate
applies_to:
  repos: [ilands]
  paths: ["ilands/migrations/**"]
  ops: [migration]
  skills: []
supersedes: []
source: 2026-09-14-cic-hot-table
created: 2026-09-14
consulted: 0
last_consulted: null
missed: 0
---

## Why

A failed CONCURRENTLY build leaves an invalid index that IF NOT EXISTS
then treats as success.

## Do

Put the CIC in its own step; use an `always()` receipt step; reject the batch
when the index is invalid.

## Evidence

ilands PR 3070 review round 3; migration 481 residue on 2026-09-07.
```

Frontmatter keys (no others are accepted):

| Key | Required | Constraint |
|---|---|---|
| `id` | yes | identifier; must equal the file name without `.md` |
| `hook` | yes | one non-empty line, at most `hook_bytes` |
| `kind` | yes | `gate`, `advice`, or `fact` |
| `applies_to` | yes | mapping with only `repos`, `paths`, `ops`, `skills`; each a list of non-empty strings; `paths` are globs relative to the workspace root |
| `supersedes` | yes | list of identifiers (may be empty) |
| `source` | yes | proposal id or origin label |
| `created` | yes | ISO date |
| `consulted` | no | non-negative integer, default 0 |
| `last_consulted` | no | `null` or ISO date |
| `missed` | no | non-negative integer, default 0 |
| `needs_rewrite` | no | boolean; set by `migrate-v1` |
| `superseded_by` | no | identifier; only in `archive/rules/` |
| `retired` | no | ISO date; only in `archive/rules/` |

The body is Markdown, at most `body_bytes`. A duplicate id across files or
any invalid rule file makes the whole workspace invalid; nothing is skipped
silently.

Kind semantics: a `gate` must be satisfied before an action (it is selected
even when global); `advice` improves an outcome; `fact` is a verified property
of the workspace. Within a catalog group the order is gate, advice, fact, then
id; use counters do not change catalog order.

## STATE.yml

```yaml
- id: pr-3070-round-3
  expires: 2026-09-21
  repos: [ilands]
  text: PR 3070 (distribution_tier) is in review round 3; index recycling is a separate PR.
  created: 2026-09-14
```

- A list (an empty file or `[]` is valid). Keys: `id`, `expires`, `repos`
  (optional), `text`, `created` (optional).
- `text` is one line, at most 240 bytes.
- `expires` is an ISO date. `never` is not accepted. On `state_set`, `expires`
  must be at most `today + max_ttl_days`.
- Entries with `expires < today` are expired. `apply` drops them from
  `STATE.yml` and, like `expire`, appends them with an `archived` date,
  to `archive/state.yml`. The catalog never shows an expired entry.

## PROFILE.md

Free Markdown containing verified workspace facts only (repositories,
environments, build and test commands, verification state). Never rules. It is
replaced as a whole by a `profile` operation that carries the SHA-256 of the
current content as `before_hash`.

## Proposal input (JSON)

```json
{
  "id": "2026-09-14-cic-hot-table",
  "trigger": "review_failure",
  "fix_status": "verified",
  "observed": "Review rejected the CIC step twice.",
  "evidence": "ilands PR 3070 rounds 1-3; migration 481 residue on 2026-09-07.",
  "root_cause": "IF NOT EXISTS hides a failed CONCURRENTLY build.",
  "operations": [
    { "op": "add", "rule": { "id": "hot-table-partial-index-cic", "hook": "...", "kind": "gate", "applies_to": { "repos": ["ilands"], "ops": ["migration"] }, "body": "..." } }
  ]
}
```

Envelope:

| Field | Required | Constraint |
|---|---|---|
| `id` | yes | identifier; also the audit record name |
| `trigger` | yes | `verification_failure`, `review_failure`, `user_correction`, `independent_qa_defect`, `stale_context`, `repeated_observation`, `agent_self_detected`, `first_fix_failed_then_passed` |
| `fix_status` | yes | `verified` or `unverified`; only `verified` can apply |
| `evidence` | yes | non-empty text, at most 800 bytes |
| `observed`, `root_cause` | no | text, at most 800 bytes each |
| `operations` | yes | 1 to 20 entries |

No other keys are accepted.

Operations:

| `op` | Fields | Effect |
|---|---|---|
| `add` | `rule: {id, hook, kind?, applies_to?, supersedes?, body?}` | writes `rules/<id>.md`; `kind` defaults to `advice`; `source`, `created`, counters are filled by the runtime |
| `supersede` | `replaces: [id, ...]`, `rule: {...}` | every replaced rule must be active; each moves to `archive/rules/<id>.md` with `superseded_by`; the new rule's `supersedes` is the union of its own list and `replaces` |
| `retire` | `id`, `reason` | moves the active rule to `archive/rules/<id>.md` with `retired: <today>` and `retired_reason` |
| `state_set` | `entry: {id, text, repos?, ttl_days? or expires?}` | replaces the entry with that id; `expires` defaults to `today + ttl_days`, `ttl_days` defaults to `default_ttl_days` |
| `state_clear` | `id` | removes an existing entry |
| `profile` | `content`, `before_hash` | replaces `PROFILE.md`; `before_hash` is the SHA-256 hex of the current content |

A rule id that is already active, or already archived by the same proposal,
is rejected. Within one proposal, operations are evaluated in order against
the evolving next state.

## Gates and reason codes

Gates run in this order. The first failing gate decides the result.

| Order | Gate | Result | `reason` |
|---|---|---|---|
| 1 | workspace loads and validates | failed | `workspace_invalid` |
| 2 | envelope shape | failed | `invalid_proposal` |
| 3 | `fix_status == verified` | blocked | `current_fix_not_verified` |
| 4 | privacy scan on `observed`, `evidence`, `root_cause`, and the JSON of `operations` | failed | `privacy_hazard` (details: `private_key`, `credential`, `credential_assignment`, or `absolute_user_path`) |
| 5 | per operation: rule shape, hook and body byte limits | failed | `invalid_rule` |
| 5 | per operation: state entry shape, 240-byte text, `max_ttl_days` | failed | `invalid_state` |
| 5 | per operation: profile `before_hash` equals current hash | blocked | `profile_changed` |
| 5 | per `add`/`supersede`: token Jaccard of the new hook against every hook that will still be active is `< similarity_block` | blocked | `similar_rule_exists` (details: `similar: [{id, score}]`) |
| 6 | rendered catalog `<= catalog_bytes` | blocked | `catalog_budget_exceeded` (details: `catalog_bytes`, `budget`) |
| 7 | at least one file changes | blocked | `no_effective_change` |
| 8 | `write_policy == auto` or `--approved` | approval_required | `policy_requires_approval` |
| 0 | `.agent-context/.lock` can be created before reading/planning | blocked | `workspace_locked` |
| 10 | `proposals/<id>.md` does not exist | blocked | `proposal_exists` |
| 11 | file transaction | failed | `commit_failed` (rollback complete) or `rollback_failed` (lock retained) |
| — | I/O failure before commit planning finishes | failed | `mutation_failed` |

`--approved` skips gates 5 (similarity only) and 6 and satisfies gate 8. It
never skips schema, verification, privacy, byte-limit, or hash gates.

Privacy scan patterns: PEM private-key markers; well-known token shapes
(`AKIA...`, `ghp_...`, `xox?-...`, `sk-...`, `Bearer ...`); assignments of
`api_key`, `token`, `secret`, `password` and similar to a value of 8 or more
characters; absolute user-home paths (`/Users/<name>/`, `/home/<name>/`,
`C:\Users\<name>\`).

Similarity tokens are lowercase ASCII words (single characters and a small
stop-word list removed) plus individual CJK characters; the score is the
Jaccard index of the two token sets.

## Apply result

```json
{
  "status": "applied",
  "proposalId": "2026-09-14-cic-hot-table",
  "targets": [".agent-context/rules/hot-table-partial-index-cic.md"],
  "expired": [],
  "catalog": { "bytes": 2210, "rules": 12, "state": 1, "agentsFile": "AGENTS.md" },
  "receipt": "Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=2026-09-14-cic-hot-table; targets=.agent-context/rules/hot-table-partial-index-cic.md; catalog=2210B/12 rules."
}
```

`targets` lists the workspace-relative files the proposal changed (rule files,
archive copies, `STATE.yml`, `PROFILE.md`), sorted. The audit record and the
instruction file are not listed as targets. Non-applied results have `status`,
`reason`, and, when known, `proposalId`, `targets`, and `details`.

Normal Schema 2 mutations acquire `.agent-context/.lock` before reading and
planning. Each target is replaced through a unique sibling temporary file and
rename. All targets are preflighted; handled failures restore every touched
file, including the audit and instruction block. `commit_failed` reports a
completed rollback. `rollback_failed` reports unrestored paths and retains the
lock; never claim success or remove the lock before operator inspection.
This is not crash-atomic across files: process termination/power loss requires
inspection of the leftover lock and workspace. Init/migrate and hand edits must
run in a quiescent workspace. No stale-lock auto-deletion or hidden retry.

## Audit record: proposals/<id>.md

~~~markdown
---
id: 2026-09-14-cic-hot-table
trigger: review_failure
fix_status: verified
operations: [add]
targets: [.agent-context/rules/hot-table-partial-index-cic.md]
before_hashes: {}
after_hashes:
  .agent-context/rules/hot-table-partial-index-cic.md: <sha256>
decision: auto_applied
applied_at: 2026-09-14T08:12:31.000Z
kit_version: 0.8.0
catalog_bytes: 2210
---

## Observed

...

## Evidence

...

## Root cause

...

## Diff

```diff
--- /dev/null
+++ .agent-context/rules/hot-table-partial-index-cic.md
@@ -0,0 +1,18 @@
+---
+id: hot-table-partial-index-cic
...
```
~~~

`before_hashes` covers only targets that existed before the apply. The record
never contains full file contents beyond the unified diff. One record per
applied proposal; an existing record with the same id blocks a second apply.

## Catalog block

Rendered into `agents_file`, replacing an existing block or appended when
none exists. Everything outside the block is left byte-for-byte.

```markdown
<!-- acp-catalog: kit=0.8.0 schema=2 rendered=2026-09-14T08:12:31.000Z rules=12 state=1 -->
## Workspace Context Catalog

Read .agent-context/rules/<id>.md first. (+ops) adds ops. Select needs repos; no edits.

### ilands · migration
- gate [hot-table-partial-index-cic] Adding a partial index on a hot table: run CIC in its own workflow step and reject the batch when it fails.
- advice [migration-applied-ledger] ...

### any · general
- gate [verify-before-evolve] ...

### STATE (auto-expires)
- (09-21) ilands: PR 3070 (distribution_tier) is in review round 3; index recycling is a separate PR.
<!-- /acp-catalog -->
```

- Group key: all `applies_to.repos` joined with commas or `any`, then the first
  op or `general`; additional ops are visible as `(+op,op)` after the hook.
  Each rule appears once, and no secondary repo/op is hidden. Groups sort by repo then op; `any` groups sort last.
- Line format: `- <kind> [<id>] <hook>`.
- STATE lines: `- (MM-DD) [repo,repo: ]<text>`, sorted by expiry then id; only
  entries with `expires >= today`.
- Header counts: `rules` is the number of active rules, `state` the number of
  unexpired entries.
- The block's byte length, header and footer included, must be at most
  `catalog_bytes` for an unapproved `apply` to succeed. `status`, `weekly`,
  and `migrate-v1` report the size but do not enforce it.
- An instruction file with an unbalanced block (open without close, or close
  before open) is an error; the runtime does not guess.

## Task signature

```json
{ "repos": ["ilands"], "paths": ["ilands/migrations/481.sql"], "ops": ["migration"], "skills": ["cloud-sql"], "ids": ["hot-table-partial-index-cic"] }
```

- Only these five keys; each is a list of at most 64 non-empty single-line
  strings. Backslashes become slashes; a leading `./` is removed.
- Explicit `repos` are authoritative. When absent, selection derives only
  path prefixes that name a repo present in rule scopes; `src/` does not
  invent a repo. Cross-repo tasks name every affected repo.
- `ids` must be identifiers.
- The signature is built from hard facts. It never contains the prompt.

## Selection semantics

For each active rule:

1. If its id is in `ids`, it is selected with score 100 and reason `id`.
2. If the rule has no scope at all, it is selected only when `kind == gate`
   (score 0, reason `global`).
3. If the rule lists `repos` and the task has repos, at least one must
   intersect; otherwise the rule is excluded regardless of other dimensions.
   A matching repo-scoped rule with no task repo is reported as ambiguous
   and its body is not emitted; the caller must disambiguate.
4. If the rule is scoped by repos only, it matches when repos intersect.
   Otherwise it matches when any of `paths`, `ops`, or `skills` intersects.
   Path patterns are globs (`**` spans directories, `*` stays within one
   segment); a pattern without a leading `**` also matches when prefixed with
   `**/`, and a pattern without `/` also matches the basename.
5. Score is the number of intersecting dimensions (`repos` counts when it
   intersects).

Order: all unscoped global gates first, then gates/advice/facts, score, id.
Counters do not change routing order. Unknown explicit ids fail. The result
contains the full matched manifest (ids, kinds, hooks, scores, reasons), emitted
`selected` bodies, unread `omitted` ids, repo-required `ambiguous` ids, and
`complete`. `status: ok` is reserved for complete reads. `incomplete` exits 1
and prominently reports unread scope/bodies. JSON mode omits body text.

`select_bytes` (or explicit `--bytes`) bounds the UTF-8 bytes of rendered body
text, including inter-rule newline separators; CLI notices and the routing
manifest are outside that budget. An oversized first rule is blocked with
`rule_exceeds_budget`, never emitted above budget. Read it directly or restart
with a larger budget. A `cursor` resumes with the same signature/budget. It is
bound to the matched rule texts, scope, order and ambiguity; changed sources
return `selection_changed`. Keep every page before treating the read as complete.
Render-time-only changes do not rewrite an otherwise identical catalog.

Rendered form per rule:

```markdown
### gate [hot-table-partial-index-cic] Adding a partial index on a hot table: ...
<!-- repos=ilands paths=ilands/migrations/** ops=migration -->
<body>
```

## Consult writeback

`consult --consulted a,b --missed c` increments `consulted` and sets
`last_consulted = today` for each id in `--consulted`, and increments
`missed` for each id in `--missed`. Ids are deduplicated. Unknown ids are
reported in `unknown` and do not fail the call; a malformed id fails with
`invalid_ids`. Receipt:

```text
Context use: consulted=a,b; missed=c; unknown=x.
```

Optional `--task-ref <identifier> --action <category>` records material use in
`reports/material-use-<date>.json`. Both fields and at least one consulted id
are required; categories are prevented_error, changed_plan, added_verification,
avoided_work, confirmed_path. Records contain only safe reference, rule id,
SHA-256 of rendered rule text, action, and evidenceType=self_report; identical
observations deduplicate, at most 1000 per day. No raw prompt or network calls.

`consulted=none` when the list is empty; `missed` and `unknown` appear only
when non-empty.

## Receipt formats

Applied (returned by `apply`; never hand-formatted):

```text
Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=<id>; targets=<path>[,<path>...]; catalog=<bytes>B/<n> rules.
```

No candidate (formatted by `receipt --detect <status>:<reason> --propose <status>:<reason>`):

```text
Evolution outcome: detect=no_candidate(<reason>); propose=not_needed(<reason>); apply=not_attempted(no_proposal).
```

`status` matches `^[a-z_]+$`, `reason` matches `^[a-z0-9_]+$`; a missing
reason renders as `unspecified`. When `--propose` has status `blocked`, the
apply stage renders `not_attempted(proposal_blocked)`. A stage shows no
parenthesised reason only when it equals its success value (`candidate`,
`created`, `applied`).

Blocked, failed, or approval-required apply: report `status(reason)` from the
JSON result in the same line shape, with `proposal=<id>` when known.

## Weekly report

`reports/weekly-<date>.md` is a rebuildable view. Sections: Catalog (bytes
against budget, rule counts by kind, state counts, `needs_rewrite` count),
Most consulted (top 10 with a non-zero count), Relevant but missed, Never
consulted (created 30 or more days ago with `consulted == 0`), Not consulted
for 30+ days, Similar hooks (pairs with Jaccard at or above 0.35), State
expiring within 3 days, Claude memory files not yet in the workspace (only
with `--memory-dir`), Recommended next actions. Status/weekly distinguish
stored/fresh catalog content (render time ignored), expired pending archive,
pending proposal inputs, invalid audits, recent 7/30-day growth, latest applied
audit and last weekly report filename. These timestamps do not prove a semantic
maintenance pass completed. Archived predecessor consultation totals are separate
from current-version use; never-consulted candidates exclude used lineages.
Missed rules trigger investigation of routing/budget/scope, not automatic rewrite.
Counters are cumulative self-reports, not causal outcome evidence. Optional
material-use reports cover a bounded 30-day window, distinguish current and
historical rule-text hashes, and report opportunities/recurrence as unknown.

## Claude memory bridge

`memory-sync --memory-dir <dir>` scans `*.md` files other than `MEMORY.md`,
reads `metadata.type` from their frontmatter, keeps files typed `user`, and
reports every other file (`feedback`, `project`, untyped) as a migration
candidate. It rewrites `MEMORY.md` as a generated index headed by
`<!-- acp-memory: generated by evolve; ... -->` that lists only the kept
files and states that rules and state live in the catalog. `--dry-run`
computes the same result without writing. A missing directory returns
`status: missing`.

## Migration from Schema 1 (`migrate-v1`)

Preconditions: `config.yml` exists and has `schema_version: 1`
(`config_missing` or `not_schema_1` otherwise). Steps, in order:

1. Collect bullets from every `checklists/*.md` (template boilerplate bullets
   are skipped) and from the `## Active Working Rules` section of
   `PROJECT_PROFILE.md`; `acp-rule` markers supply the source proposal id.
2. Move `proposals/*.md` to `archive/proposals-v1/`, checklists to
   `archive/checklists-v1/`, and copy `PROJECT_PROFILE.md` to
   `archive/PROJECT_PROFILE-v1.md`.
3. Remove `PROJECT_CONTEXT_INDEX.md`, `PROJECT_PROFILE.md`, `checklists/`,
   the directory `README.md` placeholders, and the old `config.yml`.
4. Write a Schema 2 config (`write_policy` preserved from
   `context_write_policy`), `PROFILE.md` from the remaining profile sections
   (rules and enabled-domain sections removed), and one draft rule per bullet:
   id from the marker source (date prefix stripped) or the first words of the
   text, `hook` = first sentence truncated to `hook_bytes`, `kind` = `gate`
   when the text reads like a prohibition or requirement, `applies_to`
   inferred from keyword hints, `body` = the original text truncated to
   `body_bytes` with a pointer to the archived original, `needs_rewrite: true`.
5. Render the catalog.

The result reports rule counts, moved proposals, and the catalog size against
budget. The conversion is one-shot and lossy by design.

## CLI exit codes

| Code | Meaning |
|---|---|
| 0 | `status: ok` or `status: applied` |
| 1 | `status: blocked`, `failed`, `approval_required`, `incomplete`, `invalid`, or `missing` |
| 2 | usage error: unknown command, unexpected argument, invalid or missing JSON option, no workspace found |

Errors that exit 2 print one line to stderr. Results that exit 0 or 1 print
JSON to stdout, except `catalog` (block text), `select` without `--json`
(rule bodies), `consult` (receipt line), `receipt` (receipt line), and
`apply` on success (JSON followed by the receipt line).
