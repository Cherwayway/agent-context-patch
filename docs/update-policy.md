# Update Policy

Agent Context Patch uses a small, explicit update surface suitable for early
internal use. The goals are reproducibility, informed approval, and reliable
recovery, not invisible freshness.

## Stable source

- A tagged, GitHub-enforced immutable Release is the stable source of a Kit
  Version.
- A Release carries integrity metadata and an attestation for its distributed
  files. A mutable Release is not a stable source.
- `main`, pull requests, and arbitrary source snapshots are development inputs,
  not normal install or upgrade sources.
- A replacement or correction is published as a new Kit Version; an existing
  Release is never silently rewritten.

## Discovery and notification

For the early product stage:

- users subscribe to GitHub Release notifications for prompt external notice;
- `$evolve update` performs an explicit, live version check when the user asks;
  and
- maintainers may announce an important internal Release through the team's
  existing communication channel.

The kit does not run a daemon, poll in the background, or contact a server
automatically. A failed or unavailable version check never blocks ordinary
context work. No workspace identity, path, context, source code, conversation,
or usage event is sent to check a public Release.

## Version compatibility

Kit Version and Workspace Schema answer different questions:

- **Kit Version** identifies installed product behavior and follows semantic
  versioning.
- **Workspace Schema** identifies the durable context contract.

A Kit Version may change while the Workspace Schema remains unchanged. The Kit
must declare which Workspace Schema versions it can read and write. Historical
creation-version metadata describes provenance; it is not an equality lock to
the currently installed Kit Version.

If the current Workspace Schema is supported, upgrading the Kit must not rewrite
the workspace merely to refresh version metadata. If migration is needed, it is
planned, approved, backed up, and applied separately from the Kit upgrade. A
future unsupported schema remains read-only.

## Upgrade protocol

An upgrade follows one visible sequence:

1. Resolve one immutable target Release and verify its identity and integrity.
2. Compare the exact installed and candidate Kit managed-tree identities.
3. Produce an exact Upgrade Plan describing whole-skill replacement scope,
   schema impact, recovery copy, and rollback behavior.
4. Wait for explicit approval of that exact plan.
5. Preserve the installed Kit, stage the replacement, and validate it before
   activation.
6. Activate the replacement as one operation and run post-upgrade verification.
7. Restore the preserved Kit automatically if activation or verification fails.
8. Report the installed version and whether a new Agent task is needed to load
   it.

Changing either tree invalidates approval. The current protocol deliberately
does not merge or classify file-level drift: the complete installed tree is
identified in the plan and retained in the recovery copy before replacement.
A managed-tree identity covers directory paths plus file paths and bytes;
timestamps, ownership, and platform ACL metadata are outside this portable
contract.
A Kit upgrade does not scan or bulk-edit workspaces, and approval of a Kit
upgrade does not authorize instruction-file patches or Workspace Schema
migration.

## Release requirements

Each stable Release must provide:

- the Kit Version and immutable source revision;
- integrity metadata for distributed artifacts;
- supported Workspace Schema range;
- user-visible changes and upgrade notes;
- known limitations or required manual actions; and
- a tested recovery path from the preceding stable Release.

If the preceding stable skill does not yet expose `$evolve update`, the new
Release notes must provide the one-time candidate Bootstrap handoff. That
handoff disappears from normal use after the first upgrade.

Publish a stable Release in this order:

1. Confirm repository Release immutability is enabled.
2. Create a draft against the exact release commit.
3. Attach the named archive and its digest before publication.
4. Publish the draft, then verify the immutable flag, tag target, attestation,
   and asset digest. Never replace a published tag or asset; publish a new
   version for corrections.

Maintainers can create the commit-bound archive and checksum with:

```text
npm run release:prepare -- <version> <40-character-sha> <output-directory>
```

The command refuses mismatched public version surfaces, a missing dated
changelog section, a non-exact commit, or an existing output artifact.

The default response to an update is notification and a plan, never silent
installation. Urgent security releases may disable a known-unsafe write path,
but still require explicit approval before replacing local files.

## Deferred complexity

Background checks, snooze state, release channels, automatic upgrades,
behavioral telemetry, automatic workspace migration, and a custom update server
are outside the current policy. Reconsider background notification only after
at least two independent users miss a relevant fix, or after a trusted
distribution platform provides the capability without expanding this kit's
runtime. Any telemetry proposal requires a new explicit privacy decision and
must remain opt-in.
