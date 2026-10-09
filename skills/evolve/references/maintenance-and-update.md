# Maintenance and explicit updates

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
