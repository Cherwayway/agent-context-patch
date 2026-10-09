---
name: evolve
description: Read task-relevant workspace rules, keep verified lessons through gated apply, record actual context use, maintain dated state, or explicitly check and safely update the installed Kit with $evolve update.
---

# Evolve

Kit 0.8.0, Workspace Schema 2. Read `references/protocol-v2.md` for normative
formats and `runtime/README.md` for the API. Fix and verify the current task
before evolving long-term context.

## Read before acting

The `acp-catalog` block in `AGENTS.md` lists one hook per active rule and dated
STATE. `CLAUDE.md` imports that same instruction file. Read matching bodies
before the first edit and again when the task changes stage or scope.

Use hard facts, never the raw prompt, to select bodies:

```bash
node <skill>/runtime/cli.mjs select --signature '{"repos":["ilands"],"paths":["ilands/migrations/481.sql"],"ops":["migration"],"skills":["cloud-sql"]}'
```

Skills must include the actual repo, relevant paths, and current operation in
their signature. Cross-repo work names both repos. A known repo prefix in a
workspace-relative path can resolve scope; an arbitrary `src/` prefix cannot.
Missing repo scope is reported as `repo-required`, without loading other repos'
bodies. Explicit ids include exactly those rules plus matching/global gates;
unknown ids fail. Beyond the repo filter, any matching path, op, or skill still
matches; this version does not change the scope model to AND.

Global gates come first. Selection is complete only when `complete: true`:
`INCOMPLETE` / exit 1 means some matching bodies remain unread or require repo
scope. Repeat with the same signature and `--cursor <token>` until complete;
keep all pages. A changed source invalidates the cursor. An oversized rule
returns `rule_exceeds_budget`: read its file directly or restart with a larger
explicit `--bytes` budget. `--json` is a routing manifest and omits bodies; it
is not a substitute for reading them. Never treat an omitted gate as satisfied.
An unscoped advice is served by its hook; unscoped gates require their bodies.

## Verified lesson checkpoint

After verification, write only for a high-signal event:
`failed_verification_later_passed`, `explicit_user_correction`,
`independent_qa_defect`, `stale_context`, `first_fix_failed_then_passed`.
Otherwise stay silent: no proposal, no receipt. Author one JSON proposal and
call `apply` once; proposals are audit records, not an inbox.

- Envelope: unique `id`, supported `trigger`, `fix_status: verified`, and an
  evidence pointer. Optional `observed` / `root_cause` are at most 800 bytes.
  Map failed verification to `verification_failure`, explicit correction to
  `user_correction`; other triggers retain their names.
- Rule: `id`, one-line situation + action `hook` (160 bytes), `kind`
  (`gate`, `advice`, `fact`), `applies_to: {repos,paths,ops,skills}`, short
  `body` (1500 bytes) with why, action, and a relative evidence pointer.
- Operations: `add`, `supersede` with `replaces`, `retire` with reason,
  `state_set`, `state_clear`, `profile` with exact current `before_hash`.
  See protocol examples when authoring an unfamiliar operation.
- `similar_rule_exists`: supersede the existing rule; do not reword an add.
  `catalog_budget_exceeded`: review and supersede/retire before adding.
  `--approved` bypasses only similarity and catalog limits and satisfies
  `write_policy: propose`, only when a human has made that decision.

```bash
node <skill>/runtime/cli.mjs apply --proposal @proposal.json
```

Privacy, schema, per-rule size, fix verification, and profile hash gates cannot
be bypassed. No raw conversation, secrets, logs, customer data, or absolute user
paths in durable context. Never reuse an active or archived rule id.

## Record actual use

After a task that read bodies, record only ids that influenced planning,
execution, or verification. `missed` means relevant but found too late.

```bash
node <skill>/runtime/cli.mjs consult --consulted a,b [--missed c]
```

Print the returned `Context use:` line. Counters are cumulative self-reports,
not proof of improved outcomes. For a high-value local observation, optionally
add `--task-ref <safe-kebab-id> --action <category>`. Categories:
`prevented_error`, `changed_plan`, `added_verification`, `avoided_work`,
`confirmed_path`. This stores a bounded report with the rule-text hash, safe
reference and category; no prompt or telemetry. Ordinary tasks need no extra
fields. Do not infer a causal benefit from these observations alone.

## State and maintenance

STATE describes temporary work, each entry expires (default 14, maximum 90
days) and has one line of at most 240 bytes. Expired entries disappear from the
catalog; successful `apply` or `expire` archives them exactly once. Renew only
after checking fresh evidence. PROFILE contains verified stable facts, not
rules or a task-progress log. Host memory helps locate evidence; current rules,
source and runtime determine current facts.

```bash
node <skill>/runtime/cli.mjs status
node <skill>/runtime/cli.mjs expire
node <skill>/runtime/cli.mjs weekly
node <skill>/runtime/cli.mjs catalog --write
```

Status compares stored/fresh catalog content, excluding render time; weekly
shows recent growth, pending expiry, audit consistency and predecessor use.
Investigate missed rules through routing, budget, scope and hook clarity before
rewriting. Similarity and age are review candidates, not automatic retirement.
Use a short dated report for reviewed-and-retained decisions, not a new rule.
Daily maintenance expires/checks context; a weekly pass reviews semantics. An
unchanged run stays quiet. Scheduling belongs to the host; the kit has no daemon.

Normal Schema 2 mutations and CLI reads share `.agent-context/.lock`, acquire
it before reading and report contention; retry serially. Never remove another
writer's lock. Hand edits must be quiescent, followed by `catalog --write`.
Handled write failures roll back all changed files, including audit/catalog.
`rollback_failed` retains the lock and reports failed paths: inspect/restore
from known evidence before removing it. Process termination or power loss is
not a crash-atomic multi-file transaction; a leftover lock requires inspection.

## Commands and receipts

`<skill>` is the one installed entity, normally `~/.agents/skills/evolve`;
Claude reaches the same entity through its skill symlink. All workspace commands
accept `--workspace <dir>` and `--today YYYY-MM-DD`. Default discovery is the
nearest ancestor with `.agent-context/config.yml`, or `ACP_WORKSPACE`.
Exit 0: ok/applied; 1: incomplete/blocked/failed/approval_required/invalid;
2: usage error. `receipt` formats blocked/no-candidate stages when needed.

Print only the runtime's `Evolution outcome:` or `Context use:` receipt, never
lesson prose, proposal JSON or a diff. No-candidate normal tasks stay silent.
Never edit the managed catalog by hand or change instruction text outside it
on evolve's behalf. AGENTS.md is the shared literal source; CLAUDE.md is only
an import. One shared skill entity, no divergent copies.

## Explicit update, init, migration, memory bridge

For `$evolve update`, read `references/maintenance-and-update.md` first. Resolve
https://github.com/Cherwayway/agent-context-patch/releases/latest to an immutable
Release, verify integrity, produce the exact candidate Bootstrap UpdatePlan,
and obtain approval of that exact plan hash before replacement. A Kit update
does not authorize workspace edits or schema migration. New tasks load the new
skill. No background version check, silent install, or telemetry.

Read that reference for `init`, explicit `migrate-v1` and weekly details. The
Claude-specific `memory-sync --memory-dir <dir> [--dry-run]` bridge changes a
separate memory index only when explicitly requested; it is not a generic
Codex/host-memory adapter. Do not run it as part of routine maintenance.
