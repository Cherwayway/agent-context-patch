# Agent Context Patch

Turn agent mistakes into durable project context.

Agent Context Patch helps Codex, Claude Code, and other AI coding agents learn
from recurring failures without turning every task into a heavyweight workflow.

The default loop is simple:

1. Detect a mistake, failed verification, repeated correction, or stale context.
2. Fix the current task first.
3. Write an evidence-backed evolution proposal.
4. Ask the user to approve the context patch.
5. Keep approved project context small, current, and useful.

## Quick Install

Ask your agent:

```text
Install agent-context-patch from https://github.com/<org>/agent-context-patch.
Run dry-run first, show planned changes, then ask before applying.
After install, run $evolve init for this workspace.
```

For local development from this checkout:

```powershell
powershell -ExecutionPolicy Bypass -File install/install.ps1 -Mode DryRun
powershell -ExecutionPolicy Bypass -File install/install.ps1 -Mode Workspace -WorkspacePath .
```

On macOS or Linux:

```bash
bash install/install.sh --mode dry-run
bash install/install.sh --mode workspace --workspace .
```

## What Gets Installed

Agent Context Patch installs two layers:

- A short agent guidance fragment for Codex `AGENTS.md` or Claude `CLAUDE.md`.
- A portable `$evolve` skill that owns the full evolution protocol.

It can also initialize workspace context under `.agent-context/`:

```text
.agent-context/
  PROJECT_CONTEXT_INDEX.md
  PROJECT_PROFILE.md
  config.yml
  proposals/
  reports/
  mistakes/
  checklists/
  archive/
```

## Commands

`$evolve init`

Initialize or refresh workspace context. The agent should inspect the workspace,
report `contextRead`, detect relevant domains, record uncertainties, and create
or update `.agent-context/`.

`$evolve after-failure`

Run after a user correction, verification failure, repeated mistake, or stale
context discovery. The agent should fix the current task first, then create an
evidence-backed proposal.

`$evolve approve`

Approve one or more proposals. By default the agent shows the patch before
applying it. Users may configure more permissive write policies.

`$evolve review-context`

Find outdated, conflicting, redundant, overlong, or vague context and propose
cleanup.

`$evolve weekly`

Generate a compact report of recurring mistakes, approved improvements, pending
proposals, redundant context, recommended patches, and next-week watch items.

## Scope

Agent Context Patch is built for heavy users of AI coding, PRD, SEO, and similar
project workflows. It does not try to manage every small one-off task.

Use the loop when a lesson is likely to matter again. Skip it for simple
one-time changes.

## Safety Model

By default, the kit proposes context changes instead of silently modifying
global instructions.

Recommended write policy:

```yaml
context_write_policy: propose
```

Other supported policies:

- `notify`: apply allowed changes and notify the user.
- `auto`: apply allowed changes automatically. Use only when you trust the
  agent and workspace.

Global agent files should use `propose` unless the user explicitly opts into a
more permissive policy.

## Why Not Just AGENTS.md Or CLAUDE.md?

Global agent instructions are always in context, so they must stay short. Agent
Context Patch keeps the startup guidance small and moves the real workflow into
a skill that loads only when needed.

## Suggested GitHub Topics

```text
ai-agent
coding-agents
codex
claude-code
agents-md
agent-skills
context-engineering
project-context
agent-memory
context-patch
self-improving-agents
developer-tools
```

## Development

Run the demo validation:

```bash
npm test
```

The demo harness checks that the repository contains the install adapters,
workspace templates, proposal schema, and the files needed to prove the
evolution flow.
