---
name: source-snapshot
description: Pin and inspect fresh, exact Git source snapshots for read-only code analysis without touching the user's working tree.
---

# Source Snapshot

Use this skill when a task asks about current or latest repository code, an
exact remote ref, or a read-only code review whose conclusions depend on source
freshness.

Do not treat the primary checkout, local `main`, or a local remote-tracking ref
as current merely because it exists. Resolve the requested source against the
remote, pin its exact commit, and analyze only the resulting snapshot.

## Workflow

Run the bundled CLI relative to this skill directory:

```text
node scripts/agent-source.mjs resolve --repo <repository> --ref <full-ref>
node scripts/agent-source.mjs snapshot --receipt <source-receipt-path>
node scripts/agent-source.mjs close --receipt <snapshot-receipt-path>
```

`resolve` currently supports exact full remote refs such as
`refs/heads/main` and `refs/pull/123/head`. It compares `git ls-remote` with the
commit fetched into a workspace-external bare cache. A mismatch or unavailable
remote fails closed.

`snapshot` exports the pinned commit into a task-owned temporary directory,
rejects submodules and escaping symlinks, records an integrity digest, and
makes the extracted tree read-only. It never reads files from the user's
working tree.

`close` verifies the digest before cleanup. It removes only the task-owned
session and cache ref. If the snapshot changed, it retains the session and
reports the integrity failure instead of deleting evidence.

Always close a source receipt when snapshot creation fails:

```text
node scripts/agent-source.mjs close --receipt <source-receipt-path>
```

## Claims And Boundaries

- Report the source mode, remote ref, exact commit SHA, resolution time, and
  snapshot method with the analysis.
- If `resolve` did not succeed, do not describe cached or local code as latest.
- The guarantee is workspace-read-only, not system-wide zero-write: the CLI
  writes only its external Git cache and task-owned temporary session.
- Dependency installation, builds, generators, and tests are outside this
  read-only snapshot mode. Use a separately authorized isolated verification
  environment for them.
- A deployed revision is not the same as remote `main`; first obtain an exact
  deployed ref or SHA from a project-specific deployment resolver.
