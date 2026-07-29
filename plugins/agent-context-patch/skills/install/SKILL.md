---
name: install
description: Safely install or inspect Agent Context Patch when the user asks for durable, reviewable workspace memory for Claude Code or Codex.
disable-model-invocation: true
---

# Install Agent Context Patch

Use this skill only when the user explicitly asks to install Agent Context
Patch. This marketplace plugin is a discovery and installation adapter; it is
not the Agent Context Patch runtime and it must not silently edit the current
workspace.

## Stable source

Resolve the latest stable release from:

`https://github.com/Cherwayway/agent-context-patch/releases/latest`

Require a GitHub-enforced immutable Release that is neither a draft nor a
prerelease. Resolve its exact tag and target commit. Download the published
archive to a temporary directory and verify its GitHub-published SHA-256 asset
checksum before unpacking it. Require the release tag, target commit, archive
identity, and unpacked `skills/evolve/manifest.json` Kit Version to agree.

Never install the runtime from the moving `main` branch. If release metadata,
immutability, the checksum, or any identity check is unavailable or
inconsistent, stop and leave the workspace unchanged.

## Reviewed installation

After verification, read `AGENT_INSTALL.md` from the unpacked Release and
follow it as the canonical installation contract:

1. Detect the Agent, workspace root, instruction file, user-level skill target,
   existing context, and Node capability instead of guessing paths.
2. Run the candidate Release's Bootstrap in dry-run mode.
3. Show the complete deterministic plan, exact plan hash, and a separate
   minimal semantic patch for `CLAUDE.md`, `AGENTS.md`, or the matching
   instruction file.
4. Obtain explicit approval for both the unchanged plan and the semantic
   instruction patch before applying anything.
5. Recompute the plan at apply time, apply only the approved hash, apply the
   separately approved instruction patch, and run the Release verification
   seam.
6. Report installed Kit Version, workspace schema, policy, targets, verification
   result, and any preserved conflicts without exposing sensitive content.

The installation must preserve existing workspace context and instructions.
Bootstrap never merges the instruction file by itself.
