# Agent Install Guide

This file is written for coding agents. Follow it when a user asks you to
install Agent Context Patch.

## Goals

- Install the `$evolve` skill for the current agent where possible.
- Add only a short global or project guidance fragment.
- Initialize `.agent-context/` for the current workspace.
- Run dry-run first and show planned changes before applying.
- Never overwrite existing user instructions without a patch review.

## Detect The Agent

1. If the user is using Codex, install:
   - `skills/evolve/` to `~/.agents/skills/evolve/`
   - `adapters/codex/AGENTS.fragment.md` into the requested global or workspace
     guidance target.
2. If the user is using Claude Code, install:
   - `skills/evolve/` to `~/.claude/skills/evolve/`
   - `adapters/claude/CLAUDE.fragment.md` into the requested global or
     workspace guidance target.
3. For other agents, copy the skill as documentation and add the generic
   guidance fragment to the agent's supported instruction file.

## Dry-Run Requirements

Before applying changes, report:

- Agent detected.
- Install scope: `workspace`, `global`, or both.
- Files that would be created.
- Files that would receive a patch.
- Files that already exist and will not be overwritten.
- Whether `$evolve init` will run after install.

## Apply Rules

- Existing `AGENTS.md` or `CLAUDE.md`: create a patch, do not overwrite.
- Existing skill directory: ask before replacing, or create a timestamped
  backup when the user approves.
- Existing `.agent-context/`: update index/profile conservatively and preserve
  proposals, reports, mistakes, checklists, and archive files.
- If pending proposals exceed 10, run `$evolve review-context` before creating
  new proposals.

## Post-Install

Run `$evolve init` for the workspace unless the user explicitly opts out.

The init result must include:

- Created or updated files.
- `contextRead`.
- Detected domains.
- Current uncertainties.
- Recommended next step.
