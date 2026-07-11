# Agent Install Guide

This guide is the Agent-facing installation interface for Agent Context Patch.
The Agent understands the environment and proposes semantic instruction edits;
Bootstrap executes only deterministic file operations.

## Defaults

- Install `skills/evolve/` in the current Agent's user-level skill directory.
- Install the short guidance fragment in the workspace instruction file.
- Initialize `.agent-context/` in the workspace.
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
- Whether Node and the optional Commit Kernel are available.

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
- whether Node Commit Kernel capability will be available;
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
- An unversioned `.agent-context/config.yml` is `legacy_v0`; Bootstrap stops and
  directs the Agent to create a migration proposal.
- A `schema_version: 1` config is current only when its complete policy,
  domain, budget, version, and privacy envelope is valid. PowerShell and Bash
  fail closed with `InvalidConfig` before materializing any template when that
  envelope is incomplete, unsafe, duplicated, or contains unknown fields.
- A future schema is read-only and requires a newer Bootstrap.
- A different installed skill version requires a reviewed upgrade/backup plan.
- An unversioned existing skill is a conflict, not an overwrite target.
- Existing `AGENTS.md` or `CLAUDE.md` always uses semantic patch review.

## Post-Install

Run `$evolve init` unless the user explicitly opts out. The init result must
include:

- `contextRead` for the current run;
- detected domain candidates with evidence and confidence;
- the proposed enabled domains;
- files in the InitPlan;
- uncertainties;
- requested and effective write policy;
- whether migration is required;
- the recommended next step.

Domain activation is approved as part of the InitPlan. It is never inferred
from the mere presence of a checklist file.
