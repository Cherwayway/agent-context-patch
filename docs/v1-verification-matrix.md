# Verification Matrix (Kit 0.7.0, Workspace Schema 2)

This matrix maps each behavior accepted in
`docs/adr/0010-read-first-catalog-and-schema-2.md` (with ADR-0001, ADR-0003,
and ADR-0005 where they still apply) to the test file that proves it. Tests
exercise observable file outcomes, not token presence. Semantic judgment
(whether a lesson is reusable, what its hook should say, which rule to
supersede) remains the Agent's responsibility and is not encoded in tests.

| Behavior | Contract | Test file |
|---|---|---|
| YAML subset | Mappings, sequences, scalars, inline lists, quoted strings, comments; duplicate keys and tabs rejected; `toYaml` round-trips config, frontmatter, and STATE. | `tests/runtime/yaml.test.mjs` |
| Text helpers | Byte length, SHA-256, identifier pattern, ISO dates and TTL arithmetic, privacy hazard classes (private key, credential, credential assignment, absolute user path), similarity tokens and Jaccard, glob matching, unified diff. | `tests/runtime/text.test.mjs` |
| Workspace validation | `config.yml` must be exactly the Schema 2 envelope; every `rules/*.md` must satisfy the frontmatter table and byte budgets with `id` equal to the file name; `STATE.yml` entries must be valid; any invalid file invalidates the whole workspace; Schema 1 config is reported as not loadable. | `tests/runtime/workspace.test.mjs` |
| Catalog render and replace | Groups by `<repo> · <op>` with `any`/`general` last; order gate, advice, fact, then `consulted`; STATE section with `(MM-DD)` prefix and only unexpired entries; header counts; block replaced in place or appended; content outside the block byte-identical; unbalanced block is an error. | `tests/runtime/catalog.test.mjs` |
| Select semantics | Signature validation (five keys, 64-entry limit, identifiers); repos derived from path prefixes; repos filter; any intersecting paths/ops/skills matches; repos-only scope matches on repos; global gates selected, global advice not; explicit ids always included; gates first; `select_bytes` cap with first rule always emitted and omitted ids reported. | `tests/runtime/select.test.mjs` |
| Apply gates | In order: `workspace_invalid`, `invalid_proposal`, `current_fix_not_verified`, `privacy_hazard`, `invalid_rule`, `invalid_state`, `profile_changed`, `similar_rule_exists` (with similar ids), `catalog_budget_exceeded`, `no_effective_change`, `policy_requires_approval`, `workspace_locked`, `proposal_exists`. `--approved` bypasses only similarity and budget. | `tests/runtime/apply.test.mjs` |
| Apply commit | Rule, archive, STATE, and PROFILE files written atomically under `.lock`; audit record with frontmatter hashes and unified diff; catalog re-rendered; expired STATE removed; rollback restores every written file on failure; lock always released; applied receipt line format. | `tests/runtime/apply.test.mjs` |
| Supersede and retire | Replaced rule must be active; it moves to `archive/rules/<id>.md` with `superseded_by` or `retired` and `retired_reason`; new rule's `supersedes` is the union. | `tests/runtime/apply.test.mjs` |
| Consult writeback | `consulted` and `last_consulted` updated for `--consulted`, `missed` for `--missed`; ids deduplicated; unknown ids reported not failed; malformed ids fail with `invalid_ids`; `Context use:` receipt format. | `tests/runtime/consult.test.mjs` |
| Expire | Entries with `expires < today` removed from `STATE.yml`, appended with `archived` date to `archive/state.yml`, catalog re-rendered. | `tests/runtime/apply.test.mjs` |
| Weekly | Report sections and thresholds: never consulted after 30 days, not consulted for 30 or more days, missed, similar pairs at or above 0.35, state expiring within 3 days, `needs_rewrite` count, memory candidates, recommended actions; report is a derived file that changes no rule. | `tests/runtime/weekly.test.mjs` |
| Memory bridge | `scanMemory` classifies by `metadata.type`; `user` kept, others candidates; generated `MEMORY.md` with the `acp-memory` header; `--dry-run` writes nothing; missing directory reports `missing`. | `tests/runtime/memory-bridge.test.mjs` |
| Migrate v1 | Requires `schema_version: 1`; checklist and profile bullets become draft rules with `needs_rewrite`, hook truncated to budget, inferred scope, body pointing to the archived original; proposals, checklists, and profile archived; Schema 1 files removed; write policy preserved; catalog rendered; result counts. | `tests/runtime/migrate-v1.test.mjs` |
| CLI | Command dispatch, `--workspace` / `ACP_WORKSPACE` / ancestor discovery, `@file` JSON options, exit codes 0 (ok/applied), 1 (blocked/failed/approval_required), 2 (usage), text versus JSON output per command, `receipt` stage parsing. | `tests/runtime/cli.test.mjs` |
| Installer | Bootstrap dry-run and apply plan hash, idempotency, skill target placement, instruction file never edited, update dry-run and apply with backup and restore, Schema 2 template awareness. | `tests/verification/installer-*.test.mjs`, `tests/verification/installer-upgrade-*.test.mjs` |
| Repository contract and hygiene | Kit version agreement across package, manifest, and template; public update surface (`releases/latest`, `$evolve update`, no background polling, no schema migration by update); no placeholder URLs or obsolete names. | `tests/verification/repository-contract.test.mjs`, `tests/verification/repository-hygiene.test.mjs` |

## Semantic review boundaries

The tests do not decide whether a hook is well written, whether two rules
that pass the similarity gate are nevertheless duplicates in meaning, whether
a `fact` is still true, or which of several similar rules should survive a
supersede. Those decisions are visible in the audit record and the weekly
report and remain reviewable by a person.

`select` proves that a rule was returned; `consult` proves that the Agent
reported using it. Neither proves that the rule changed the outcome. Claims
about effectiveness need paired task evidence outside this matrix.

## Required gate

```text
npm test
```

The same command runs on Windows and Ubuntu. Before release, also inspect the
actual diff, run `git diff --check`, and exercise the Bash apply path on a Unix
environment when it was not executed by the local test job.
