# Agent Context Patch

Turn recurring Agent mistakes into small, durable, reviewable workspace
context.

Agent Context Patch is Agent-first: a capable Agent decides what a lesson means
and drafts the context patch. A small deterministic Commit Kernel is required
for `auto` and may also commit an exact human-approved plan; `propose` remains
usable without it.

The loop is:

1. Detect a reusable failure, correction, stale rule, or workflow lesson.
2. Fix and verify the current task first.
3. Search Active Context and replace before adding.
4. Write an evidence-backed proposal with an exact PatchPlan.
5. Approve that plan or apply an eligible low-risk plan through `auto`.
6. Keep Active Context current by proposing semantic cleanup.

## Quick Install

Ask your Agent:

```text
Install the latest stable Agent Context Patch from
https://github.com/Cherwayway/agent-context-patch/releases/latest. Resolve it to
one GitHub-enforced immutable tag and source commit, download that exact
Release, and verify its published checksum before running its AGENT_INSTALL.md.
Run Bootstrap dry-run first, show the exact plan hash and the separate AGENTS.md
or CLAUDE.md patch, then ask before applying. After the install, run $evolve
init for this workspace.
```

Stable installs use GitHub-enforced immutable Releases. The moving `main`
branch is a development source, not a normal install source.

Default placement:

- The `$evolve` skill and optional Node Commit Kernel install in the Agent's
  user-level skill directory.
- The short trigger fragment and `.agent-context/` install in the workspace.
- A global trigger is explicit opt-in.

Bootstrap itself never merges existing `AGENTS.md` or `CLAUDE.md`. The Agent
must show that semantic patch separately.

## Local Bootstrap Development

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File install/install.ps1 `
  -Mode DryRun -WorkspacePath .

# After reviewing the reported plan hash:
powershell -ExecutionPolicy Bypass -File install/install.ps1 `
  -Mode Apply -WorkspacePath . -ApprovedPlanHash <approved-hash>
```

Bash:

```bash
bash install/install.sh --mode dry-run --workspace .

# After reviewing the reported plan hash:
bash install/install.sh --mode apply --workspace . \
  --approved-plan-hash <approved-hash>
```

Pass an Agent-resolved skill target with `-SkillTargetPath` or
`--skill-target`. Pass the existing instruction file path to include a
`GuidancePatchRequired` action in the reviewed plan; Bootstrap still will not
edit that file.

## Local Upgrade Verification

After independently verifying and unpacking an immutable candidate Release,
run its Bootstrap against the installed user-level skill:

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass `
  -File <candidate-release>\install\install.ps1 `
  -Mode UpdateDryRun `
  -SkillTargetPath <installed-user-skill-target>

# After reviewing and approving the exact plan hash:
powershell -ExecutionPolicy Bypass `
  -File <candidate-release>\install\install.ps1 `
  -Mode UpdateApply `
  -SkillTargetPath <installed-user-skill-target> `
  -ApprovedPlanHash <approved-hash>
```

Bash:

```bash
bash <candidate-release>/install/install.sh \
  --mode update-dry-run \
  --skill-target <installed-user-skill-target>

# After reviewing and approving the exact plan hash:
bash <candidate-release>/install/install.sh \
  --mode update-apply \
  --skill-target <installed-user-skill-target> \
  --approved-plan-hash <approved-hash>
```

The candidate script determines the update source. Update modes do not inspect
or write workspace context, edit instruction files, or authorize schema
migration. They bind the exact installed and candidate managed trees to the
approved plan, back up the prior skill, verify the replacement, and restore the
prior version on failure.

The v0.2.0 skill predates `$evolve update`. Its first upgrade uses this candidate
Bootstrap sequence as a one-time compatibility handoff; later checks use the
single public `$evolve update` command.

## Workspace Context

V1 writes Active Context only inside the workspace:

```text
.agent-context/
  PROJECT_CONTEXT_INDEX.md
  PROJECT_PROFILE.md
  config.yml
  checklists/
  proposals/
  reports/
  archive/
```

Ordinary tasks read only the index, profile, and relevant enabled checklists.
Proposals own their Decision Log and Apply Attempts. Reports are derived and
archives are inactive. There is no separate mistake or receipt store.

## Commands

`$evolve init`

Inspect the workspace, report `contextRead`, detect domain candidates with
evidence, and present a reviewable InitPlan. A domain becomes active only after
approval and only `config.enabled_domains` records activation.

`$evolve after-failure`

Fix and verify the current task, then perform replace-before-add analysis and
create one evidence-backed proposal. Overlap or conflict produces a cleanup
proposal rather than automatic accumulation.

`$evolve approve`

Show the exact PatchPlan and bind approval to its plan hash. Internally the
proposal moves through separate `approved` and `applied` states. A changed file
invalidates the approval; a failed commit never becomes `applied`.

`$evolve review-context`

Review conflicts, staleness, duplication, authority, and retention value.
Quantity is only a review trigger. Semantic merge, rewrite, supersede, and
archive changes always require approval.

`$evolve weekly`

Create a derived report of recurring lessons, proposal health, cleanup
candidates, applied improvements, and watch items. Reports never overwrite
Active Context.

`$evolve update`

Explicitly check the latest stable immutable Release, verify its checksum, tag,
and source commit, then show the complete UpdatePlan and exact plan hash before
any user-level skill replacement. A successful update takes effect in a new
Agent task. There is no background check, telemetry, or silent upgrade.
For prompt external notice, subscribe to this repository's GitHub Release
notifications; run `$evolve update` when you choose to check or upgrade.

## Write Policies

```yaml
context_write_policy: propose
```

Supported policies:

- `propose`: the default; draft a plan and wait for exact approval.
- `auto`: explicit workspace opt-in; apply only eligible low-risk create/update
  plans through the Node Commit Kernel. The kernel rechecks workspace config;
  checklist writes are eligible only for enabled domains.

If Node or the kernel is unavailable, `auto` explicitly degrades to `propose`.
Delete, archive, supersede, migration, instruction-file, domain-activation, and
user-global promotion operations always require human approval.

## Context Health

Context is not improved merely by getting larger.

- New rules run replace-before-add analysis.
- Authority decides which evidence wins a conflict.
- Retention value decides whether a rule still earns Active Context space.
- Budget thresholds trigger review and may block `auto`; they never truncate
  context.
- Cleanup is proposed with the behavior lost, replacement rule, and net context
  change visible.

## Evidence Privacy

Evidence is pointer-first and summary-first:

- use workspace-relative file references, commands, exit codes, and hashes;
- paraphrase user corrections;
- do not persist raw conversations, complete logs, secrets, credentials,
  customer data, or unnecessary personal details;
- scrub workspace-specific information before user-global promotion.

## Legacy Workspaces

An unversioned `.agent-context/` tree is `legacy_v0` and read-only. V1 may read
it through a legacy adapter, but migration requires a reviewed MigrationPlan,
backup, exact approval, and ApplyAttempt. Bootstrap never overwrites legacy
context with new templates.

## Architecture

See [CONTEXT.md](CONTEXT.md) for the domain language and
[ADR-0001](docs/adr/0001-agent-first-context-evolution.md) for the accepted
architecture. The [v1 verification matrix](docs/v1-verification-matrix.md)
maps every accepted decision to its durable contract and test evidence.

## Development

Run the single verification interface:

```bash
npm test
```

The gate executes real demo behavior, protocol fixtures, Commit Kernel file
outcomes, Bootstrap dry-run/apply/idempotency, repository hygiene, and platform
contracts. CI runs the same interface on Windows and Ubuntu.
