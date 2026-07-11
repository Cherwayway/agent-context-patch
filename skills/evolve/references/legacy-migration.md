# Legacy Migration

Legacy workspaces are readable but not writable until migration is approved.
Never silently upgrade context-bearing files.

## Version detection

- missing schema_version: legacy_v0
- schema_version 1: current
- lower supported version: migration planning
- higher than supported: read-only; require a newer kit
- mixed legacy and v1 files: stop and produce a conflict report

The legacy adapter normalizes old files in memory only. It cannot rewrite them,
invent decisions or receipts, or dual-write old and new formats.

## v0 mapping

| Legacy value | v1 migration |
|---|---|
| scope repo | workspace |
| scope workspace | workspace |
| scope user-global | user_global_promotion proposal; manual only |
| scope team or kit | unsupported; stop for review |
| policy propose | propose |
| policy notify | propose |
| policy auto | retain requested value; use propose if kernel unavailable |
| approval flags | remove; policy now derives approval |
| evolution_style balanced | remove because it has no v1 semantics |
| applied without decision or attempt | preserve with legacy_unverified audit level |
| mistakes directory | link useful evidence to a proposal and archive the raw case |
| context read history | replace with one current verification state |

Do not fabricate missing hashes, approvals, or application success.

## Migration flow

1. Detect and inventory legacy files.
2. Create a MigrationPlan with mappings, removed fields, unsupported content,
   complete diffs, before_hashes, and plan_hash.
3. Store a migration proposal with operation migration.
4. Show ambiguity and privacy findings.
5. Obtain human approval for the exact plan_hash.
6. Choose one workspace-relative migration ID. For every changed existing file
   `.agent-context/<relative-path>`, create a byte-identical backup at
   `archive/migrations/<migration-id>/<relative-path>` in the same plan.
7. Recheck hashes, apply through the same staged transaction, and write
   schema_version 1.
8. Set last_migrated_with_kit_version and append the migration Apply Attempt.

Stop without writing if:

- a scope or field cannot be mapped safely
- rules would become ambiguous or duplicated
- proposal frontmatter cannot be parsed
- unknown security-sensitive configuration exists
- a future schema is present
- the approved target changed
- any changed existing file lacks its exact backup mapping
- backup creation fails
- legacy and v1 state are mixed

There is no dual-write period. Bootstrap must not cover legacy content with
fresh templates; it should direct the agent to this migration flow.
