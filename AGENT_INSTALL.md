# Agent Install Guide

This guide is the Agent-facing installation interface for Agent Context Patch.
The Agent understands the environment and proposes semantic instruction edits;
Bootstrap executes only deterministic file operations.

## Stable Release Source

For a normal install, begin at the
[latest stable GitHub Release](https://github.com/Cherwayway/agent-context-patch/releases/latest),
resolve it to its immutable tag and source commit, and download that exact
Release plus its published integrity metadata. Require GitHub to report the
published Release as immutable, verify the archive checksum, and require the
Release tag and target commit plus the unpacked skill manifest version to agree
before executing its Bootstrap.

Do not use the moving `main` branch as a stable install source. A local checkout
or development snapshot is acceptable only when the user explicitly chooses a
development install and reviews that exact source.

## Defaults

- Install `skills/evolve/` in the current Agent's user-level skill directory.
- Install the short guidance fragment in the workspace instruction file.
- Initialize `.agent-context/` in the workspace.
- New workspace context defaults to `auto`; preserve any existing workspace
  policy byte-for-byte.
- Do not install a global trigger unless the user explicitly opts in.
- Run Bootstrap dry-run and show the exact plan hash before apply.
- Never merge an existing instruction file through Bootstrap.

## 1. Detect The Environment

Determine from the current Agent/runtime rather than stale hard-coded paths:

- Agent kind: Codex, Claude, or other.
- Current supported user-level skill directory.
- Workspace root.
- Workspace instruction file (`AGENTS.md`, `CLAUDE.md`, or equivalent).
- Whether a skill or `.agent-context/` already exists.
- Whether Node is available for the evolve runtime
  (`node <skill>/runtime/cli.mjs`).

Report uncertainties instead of guessing. The Agent-resolved paths are inputs to
Bootstrap; path discovery is not Bootstrap policy.

## 2. Build The Two-Part Install Plan

### Deterministic Bootstrap plan

Include:

- skill files to create, skip, or mark as upgrade/conflict;
- workspace template files to create, skip, or preserve;
- legacy migration requirements;
- resolved Agent, workspace, and target paths;
- exact plan hash.

### Semantic instruction patch

Read the existing instruction file and the matching adapter fragment. Show a
minimal patch separately. Do not overwrite or append blindly. The instruction
patch always requires explicit approval.

## 3. Run Bootstrap Dry-Run

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File install/install.ps1 `
  -Mode DryRun `
  -WorkspacePath <workspace> `
  -Agent <Codex|Claude|Other> `
  -SkillTargetPath <resolved-user-skill-target> `
  -InstructionFilePath <workspace-instruction-file>
```

Bash:

```bash
bash install/install.sh \
  --mode dry-run \
  --workspace <workspace> \
  --agent <Codex|Claude|Other> \
  --skill-target <resolved-user-skill-target> \
  --instruction-file <workspace-instruction-file>
```

Show the user:

- every Create, Skip, Preserve, Conflict, UpgradeRequired, and
  MigrationRequired action;
- the separate instruction patch;
- whether Node is available for the evolve runtime;
- the exact plan hash;
- the next action if the plan is blocked.

## 4. Apply Only The Approved Plan

After the user approves both the plan hash and the semantic instruction patch,
run Bootstrap with that hash.

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File install/install.ps1 `
  -Mode Apply `
  -WorkspacePath <workspace> `
  -Agent <Codex|Claude|Other> `
  -SkillTargetPath <resolved-user-skill-target> `
  -InstructionFilePath <workspace-instruction-file> `
  -ApprovedPlanHash <approved-hash>
```

Bash uses the same inputs with `--mode apply --approved-plan-hash`.

Bootstrap must stop if the current plan hash changed. It creates only planned
missing files and rolls back files created during a failed run. It never edits
the instruction file.

Apply the already-approved semantic instruction patch separately, rechecking
that its target has not changed.

## Existing Installations

- Existing user-modified workspace context is preserved.
- Bootstrap classifies an existing `.agent-context/config.yml` by its
  `schema_version`:
  - `2` is current. Bootstrap only requires the file to parse and the value to
    be the integer `2`; the full envelope (`kit_version`, `write_policy`,
    `agents_file`, `budgets`, `state`) is validated by the evolve runtime.
  - `1` is `MigrationRequired` with reason `schema-1-run-evolve-migrate-v1`.
    Bootstrap stops; the Agent runs `$evolve migrate-v1` once, only when the
    user asks, then reruns the install plan.
  - `0`, a missing `schema_version`, or a `.agent-context/` directory without
    `config.yml` is legacy v0: `MigrationRequired`, read-only until migrated.
  - A value above `2` is `UpgradeRequired`; the workspace stays read-only
    until a newer Bootstrap is installed.
  - A duplicated or non-integer `schema_version` is a `Conflict` or
    `InvalidConfig`. PowerShell and Bash fail closed before materializing any
    template.
- Bootstrap never converts a workspace; only `evolve migrate-v1` does.
- A different installed skill version makes the normal install plan report
  `UpgradeRequired`; use `$evolve update` for a reviewed upgrade/backup plan.
- An unversioned existing skill is a conflict, not an overwrite target.
- Existing `AGENTS.md` or `CLAUDE.md` always uses semantic patch review.

## Update An Existing Installation

`$evolve update` is the only public update command. It resolves and verifies an
immutable Release locally, then invokes that candidate Release's Bootstrap.
Bootstrap does not discover Releases or download network content.

For a verified, unpacked candidate Release, the equivalent local Bootstrap
sequence is:

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass `
  -File <candidate-release>\install\install.ps1 `
  -Mode UpdateDryRun `
  -SkillTargetPath <installed-user-skill-target>

# After reviewing the complete UpdatePlan and approving its exact plan hash:
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

# After reviewing the complete UpdatePlan and approving its exact plan hash:
bash <candidate-release>/install/install.sh \
  --mode update-apply \
  --skill-target <installed-user-skill-target> \
  --approved-plan-hash <approved-hash>
```

The script location determines the candidate Release source, and the skill
target is required. Update modes do not read or write a workspace. They show
the exact installed and candidate managed-tree hashes plus the recovery path,
back up the prior skill before replacement, verify the result, and restore the
prior version on failure. They do not edit
`AGENTS.md` / `CLAUDE.md` or authorize a workspace-schema migration. After a
successful update, start a new Agent task so it discovers the new skill.

### One-time handoff from v0.2.0

The v0.2.0 skill predates `$evolve update`. When a newer stable Release exists,
use its published upgrade note to download and verify that immutable candidate,
then run the candidate Release Bootstrap through the UpdateDryRun/UpdateApply
sequence above. This is a compatibility handoff, not a second steady-state Kit
command. After the first upgrade, use `$evolve update`.

There is no background version check, telemetry, or silent upgrade. Users can
subscribe to GitHub Release notifications for external notice and invoke
`$evolve update` when they choose to check or upgrade.

## Post-Install

Run `$evolve init` automatically unless the user explicitly opts out. It
creates `config.yml` (`schema_version: 2`), `STATE.yml`, `PROFILE.md`, the
`rules/`, `proposals/`, `reports/`, and `archive/` directories, and renders
the empty `acp-catalog` block into the instruction file. Existing files are
left untouched. The compact init result must include:

- the workspace root and the instruction file that carries the catalog block;
- files created and files skipped;
- uncertainties;
- requested and effective write policy;
- whether migration is required;
- the recommended next step.

Fill `PROFILE.md` with verified workspace facts only, through a `profile`
operation that carries the current `before_hash`. Rules are added later by
`evolve apply` after verified failures or corrections, never by init.
