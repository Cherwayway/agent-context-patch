---
name: evolve
description: Keep verified workspace lessons in a read-first catalog that Claude Code and Codex both see inside the instruction file, turn failures and corrections into auto-applied rule patches behind mechanical gates, record which rules were actually used, or explicitly check and safely update the installed Kit with $evolve update.
---

# Evolve

Kit 0.7.0, Workspace Schema 2. The normative formats are in
`references/protocol-v2.md`; the runtime is documented in `runtime/README.md`.

## Purpose

A workspace lesson is worth keeping only if a later task reads it. Schema 2
therefore puts the read side first: every active rule has a one-line hook that
is rendered into the workspace instruction file, so both agents see it with
zero read decision. Rule bodies are fetched only for the task at hand. The
write side is one direct, gated `apply` call with an audit record; there is no
proposal inbox, lifecycle coordinator, or context compiler any more.

Fix and verify the current task before touching long-term context. Never let
evolution delay the repair.

## How context reaches the agent

1. The catalog is already in front of you. It is the managed block between
   `<!-- acp-catalog: ... -->` and `<!-- /acp-catalog -->` in the instruction
   file (`AGENTS.md` by default; Claude Code imports it through `CLAUDE.md`).
   It lists one hook per active rule under `### <repo> · <op>` headings, gates
   first, then a `### STATE (auto-expires)` section of dated working state.
2. Read a rule body when its hook matches the task. Either open
   `.agent-context/rules/<id>.md` or run `select` with a task signature built
   from hard facts (paths, ops, skills, repos, explicit ids), never from the
   raw prompt. Do this before the first edit of a task that touches a matched
   repo, path, op, or skill, and again when the task changes shape.
3. Skills call `select` when they activate, with a fixed signature such as
   `{"ops":["pr"],"skills":["pawlogic-ship"]}`, so gate rules ride along with
   the workflow without a separate decision.
4. Global rules (no `applies_to` scope) are selected only when they are gates;
   a global advice is fully expressed by its hook.

## Delivery checkpoint and proposal authoring

After the current fix is verified, run the checkpoint only when a high-signal
event occurred: `failed_verification_later_passed`,
`explicit_user_correction`, `independent_qa_defect`, `stale_context`, or
`first_fix_failed_then_passed`. Otherwise stay silent: no proposal, no receipt,
no durable write.

When there is a candidate, author one proposal JSON and call `apply` once:

- `hook`: one line, at most 160 bytes, "situation + action". Name the trigger
  situation first, then the action, so the hook is usable without the body.
  Example: `Adding a partial index on a hot table: run CIC in its own
  workflow step and reject the batch when it fails.`
- `kind`: `gate` blocks or requires something before an action; `advice`
  improves an outcome; `fact` records a verified property of the workspace.
- `applies_to`: `{repos, paths (globs), ops, skills}`. Leave a dimension empty
  when it does not narrow the rule; leave all empty only for a global gate.
- `body`: at most 1500 bytes, Markdown with `Why`, `Do`, and an evidence
  pointer (workspace-relative path, command, exit code, PR number). No raw
  conversation, no secrets, no absolute user paths.
- `trigger`, `fix_status: verified`, and `evidence` are required in the
  envelope. `trigger` is one of `verification_failure`, `review_failure`,
  `user_correction`, `independent_qa_defect`, `stale_context`,
  `repeated_observation`, `agent_self_detected`, or
  `first_fix_failed_then_passed`. `observed` and `root_cause` are optional,
  each at most 800 bytes.

Replace-before-add is mechanical now. A new hook whose token similarity with
an active hook is at or above `similarity_block` is blocked with
`similar_rule_exists` and the similar ids. Respond with a `supersede`
operation that names those ids, not with a reworded `add`. When the catalog
would exceed `catalog_bytes`, `apply` blocks with `catalog_budget_exceeded`;
supersede or retire something first. `--approved` bypasses only those two
gates and only when a human made that decision.

## Consult at the end of a task

At the end of any task in which you read rule bodies, record what was used:

```bash
node <skill>/runtime/cli.mjs consult --consulted <id>,<id> --missed <id>
```

`--consulted` lists rules that actually influenced planning, execution, or
verification; `--missed` lists rules that were relevant but discovered too
late. Print the returned `Context use:` line. These counters are the only
real "was the rule used" data, and `weekly` ranks, merges, and retires by
them.

## STATE

STATE is dated working state, not guidance: an in-flight PR, a temporarily
broken environment, a decision that expires. A rule is a lesson that should
still hold next quarter. If a sentence starts with "right now" or "until", it
is state. Entries carry `expires` (default TTL 14 days, at most 90, never
`never`) and one line of text at most 240 bytes. Expired entries leave the
catalog automatically and are archived to `archive/state.yml`. Set or clear
state through `state_set` and `state_clear` operations in a proposal.

## Commands

`<skill>` is the installed evolve skill directory, for example
`~/.agents/skills/evolve` (Claude Code reaches it through the
`~/.claude/skills/evolve` symlink). Every command accepts
`--workspace <dir>` (default: the nearest ancestor containing
`.agent-context/config.yml`, or `ACP_WORKSPACE`) and `--today YYYY-MM-DD`.

```bash
node <skill>/runtime/cli.mjs init [--policy auto|propose] [--agents-file AGENTS.md]
node <skill>/runtime/cli.mjs status
node <skill>/runtime/cli.mjs catalog [--write]
node <skill>/runtime/cli.mjs select --signature '{"paths":["ilands/migrations/481.sql"],"ops":["migration"],"skills":[],"repos":[],"ids":[]}' [--json]
node <skill>/runtime/cli.mjs apply --proposal '<json>' [--approved]
node <skill>/runtime/cli.mjs apply --proposal @proposal.json [--approved]
node <skill>/runtime/cli.mjs consult --consulted a,b [--missed c,d]
node <skill>/runtime/cli.mjs expire
node <skill>/runtime/cli.mjs weekly [--memory-dir <dir>]
node <skill>/runtime/cli.mjs memory-sync --memory-dir <dir> [--dry-run]
node <skill>/runtime/cli.mjs migrate-v1 [--agents-file AGENTS.md]
node <skill>/runtime/cli.mjs receipt --detect no_candidate:<reason> --propose not_needed:<reason>
```

Exit codes: 0 for `ok` or `applied`, 1 for `blocked`, `failed`, or
`approval_required`, 2 for a usage error. `status` prints JSON; `catalog`
prints the block and `--write` re-renders it into the instruction file;
`select` prints rule bodies (`--json` prints ids, hooks, scores, reasons).

## Receipts

Print only the receipt line, never lesson prose, proposal JSON, or a diff.

- Applied: the `receipt` field returned by `apply`, verbatim:
  `Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=<id>; targets=<paths>; catalog=<bytes>B/<n> rules.`
- No candidate: the output of `receipt`, for example
  `Evolution outcome: detect=no_candidate(one_off); propose=not_needed(one_off); apply=not_attempted(no_proposal).`
- Blocked or approval required: report the `status` and `reason` from the
  `apply` result in the same shape, for example
  `Evolution outcome: detect=candidate; propose=created; apply=blocked(similar_rule_exists); proposal=<id>.`
  and, if a human decision is genuinely needed, ask for that one decision.

## Hard invariants

- Never edit the instruction file outside the managed `acp-catalog` block, and
  never edit the block by hand; `catalog --write` re-renders it.
- Never store secrets, raw conversation, complete logs, customer data, or
  absolute user paths in a rule, state entry, profile, or proposal. The
  privacy gate fails the proposal; `--approved` cannot bypass it.
- Never apply a proposal whose fix is not verified.
- Never hand-format an applied receipt; only `apply` produces it.
- Never invent a rule id that already exists; supersede or retire instead.
- Hand edits to `rules/` are allowed but must be followed by `catalog --write`.
- Kit updates run only when the user invokes `$evolve update`. They never
  poll in the background, emit telemetry, silently replace the installed
  skill, edit a workspace, or authorize a workspace-schema migration.

## $evolve update

This is the only public Kit update entry point. Run it only when the user asks:

1. Resolve the installed evolve skill path and read its manifest without
   scanning workspaces.
2. Query
   https://github.com/Cherwayway/agent-context-patch/releases/latest, resolve
   the latest stable Release to one GitHub-enforced immutable tag and source
   commit, and compare its Kit Version with the installed version. Stop if the
   Release is not marked immutable. If the check is unavailable, report that
   and leave the current install usable. If the installed version is current
   or newer, report that and stop; this command never downgrades an
   installation.
3. Download that exact Release and its published integrity metadata to a local
   temporary directory. Verify the published archive checksum, the GitHub
   Release tag and target commit, and the unpacked skill manifest version.
   Require those identities to agree. Stop on missing metadata or any
   mismatch.
4. Execute the Bootstrap from the unpacked candidate Release in UpdateDryRun
   mode against the resolved installed skill path. The candidate Release is
   the update source; never run the installed Bootstrap as its own source.
5. Show the complete UpdatePlan: installed and target versions, immutable tag
   and commit, artifact checksum, exact installed and candidate managed-tree
   hashes, whole-skill replacement scope, recovery copy, workspace-schema
   impact, rollback behavior, and exact plan hash.
6. Obtain explicit approval of that exact hash. A changed candidate, target,
   or plan requires a new dry-run and new approval.
7. Invoke the same candidate Release Bootstrap in UpdateApply mode with the
   approved hash. Do not merge locally modified skill files or include an
   instruction-file patch or workspace migration in this mechanical update.
8. Report verification and recovery results. On failure, restore the prior
   working skill when possible. If automatic restore fails, retain and report
   the recovery copy; never claim success from an incomplete replacement.
9. On success, report the installed version and tell the user to start a new
   Agent task so the updated skill is loaded.

Version discovery sends no workspace path, context, source code, conversation,
or usage event. GitHub Release notifications are external; this skill provides
no daemon, scheduled check, telemetry, or silent upgrade.

## $evolve migrate-v1

Converts a Schema 1 workspace (`PROJECT_CONTEXT_INDEX.md`, `PROJECT_PROFILE.md`,
`checklists/`, PatchPlan proposals) in place, once, lossily. Run it only when
the user asks. Every checklist bullet and profile "Active Working Rules" bullet
becomes a draft rule with `needs_rewrite: true`; old proposals, checklists, and
the profile move to `archive/`. The catalog will usually exceed its budget
right after migration. The next step is a one-time rewrite pass by the agent:
merge and rewrite drafts to at most 60 rules with real hooks and scopes, then
retire the rest. New adds are refused until the catalog is within budget.

## $evolve weekly

Writes `reports/weekly-<date>.md`: catalog size against budget, most consulted
rules, relevant-but-missed rules, rules never consulted in 30 days, similar
hook pairs at or above 0.35 as merge candidates, state expiring within three
days, migrated drafts still flagged `needs_rewrite`, and, with
`--memory-dir`, Claude memory files not yet moved into rules or STATE. The
report recommends; it never removes anything. Act on it through `apply`.

## $evolve init

Creates a fresh Schema 2 workspace: `config.yml`, `STATE.yml`, `PROFILE.md`,
`README.md`, and the `rules/`, `proposals/`, `reports/`, `archive/`
directories, then renders the empty catalog block into the instruction file.
Existing files are left untouched. Fill `PROFILE.md` with verified facts only,
through a `profile` operation that carries the current `before_hash`.
