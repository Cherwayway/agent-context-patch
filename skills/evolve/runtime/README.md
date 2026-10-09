# evolve runtime (Kit 0.8.1, Workspace Schema 2)

Plain Node 20+ ES modules with no dependencies. `cli.mjs` is the command
entry; `index.mjs` re-exports the programmatic API. Pure rendering/selection APIs are synchronous; filesystem APIs return
Promises and must be awaited; only `apply`, `consult`, `expire`,
`init`, `memory-sync`, `migrate-v1`, and `weekly` write files.

## Module map

`text.mjs`: byte and hash helpers (`byteLength`, `sha256Text`,
`canonicalJson`), identifier and date helpers (`isIdentifier`, `slugify`,
`isoDate`, `isIsoDate`, `addDays`, `daysBetween`), the privacy scanner
(`findPrivacyHazard` returns `private_key`, `credential`,
`credential_assignment`, `absolute_user_path`, or `undefined`), hook
similarity (`similarityTokens`, `jaccard`), the minimal glob matcher
(`globMatch`), and a line-based LCS `unifiedDiff` used for audit records.

`yaml.mjs`: a deliberately small YAML subset (mappings, sequences, scalars,
inline lists, quoted strings, `#` comments, no tabs, no anchors) that
round-trips through `toYaml`. `parseYaml`, `parseFrontmatter`,
`serializeFrontmatter`, `toYaml`, and `isRecord`. Duplicate keys are errors.

`workspace.mjs`: the Schema 2 contract. `DEFAULT_CONFIG`, `SCHEMA_VERSION`,
`CONTEXT_DIR`, `RULE_KINDS`, `APPLIES_TO_KEYS`; validators `inspectConfig`,
`inspectRule`, `inspectStateEntry`; `normalizeRule`; and `loadWorkspace`,
which reads `config.yml`, every `rules/*.md`, `STATE.yml`, and `PROFILE.md`
and returns `{status: "ok", workspaceRoot, contextRoot, config, rules, state,
profile, today}` or `{status: "invalid" | "missing", failures}`. Any invalid
rule or state entry invalidates the whole workspace.

`catalog.mjs`: `renderCatalog(workspace, {renderedAt, kitVersion})` builds the
managed block text and its byte count; `sortRules` orders gate, advice, fact,
then by id; `replaceCatalogBlock(source, catalogText)` swaps or
appends the block and throws on an unbalanced one; `writeCatalog` renders and
writes it into `config.agents_file`, reporting `changed`.

`select.mjs`: `normalizeSignature` validates the five-list task signature and
normalizes inputs; selection resolves only known repo path prefixes; `selectRules(workspace, signature)` applies
the matching rules (repos filter, any intersecting dimension, global gates
only, explicit ids), prioritizes global gates and returns explicit completion, ambiguity and
fingerprint-bound pages; counts body text and separators within `select_bytes`. `renderRule` and `pathMatches` are exported for tests.

`apply.mjs`: `applyProposal({workspaceRoot, proposal, approved, today,
kitVersion, now})` runs the full gate order, then commits under
`.agent-context/.lock` with per-file temp-and-rename writes, rollback on error,
an audit record with a unified diff, and a catalog re-render. `planProposal`
is the pure half (validation and exact writes, no I/O); `expireWorkspaceState`
archives expired STATE; `expireState`, `findSimilar`, `serializeRule`,
`inspectProposalEnvelope`, `formatApplyReceipt`, `formatReceipt`, `TRIGGERS`,
and `OPERATIONS` are exported.

`consult.mjs`: `recordConsultation({workspaceRoot, consulted, missed, today})`
increments the counters in rule frontmatter and returns the `Context use:`
receipt; `formatConsultReceipt`.

`weekly.mjs`: `buildWeeklyReport({workspaceRoot, today, memoryCandidates})`
writes `reports/weekly-<date>.md` from the use counters, similarity pairs at
or above 0.35, and state expiry, and returns a summary.

`memory-bridge.mjs`: `scanMemory(memoryDir)` classifies Claude auto-memory
files by `metadata.type`; `renderMemoryIndex({keep})` produces the generated
`MEMORY.md`; `syncMemoryIndex({memoryDir, write})` writes it when changed.

`migrate-v1.mjs`: `migrateV1({workspaceRoot, today, kitVersion, agentsFile})`
converts a Schema 1 workspace in place; `extractBullets`, `splitProfile`,
`draftToRule`, and `truncateBytes` are the pure pieces.

`init.mjs`: `initWorkspace({workspaceRoot, kitVersion, writePolicy,
agentsFile, profile, writeCatalogBlock})` creates the directories and
`config.yml`, `README.md`, `STATE.yml`, `PROFILE.md` without overwriting
existing files, then renders the catalog; `renderConfig`, `README`,
`PROFILE_TEMPLATE`.

`cli.mjs`: argument parsing (`--key value` or bare `--flag`), workspace
discovery (`--workspace`, `ACP_WORKSPACE`, or nearest ancestor with
`.agent-context/config.yml`), kit version from `../manifest.json`, and the
exit-code mapping (0 ok/applied, 1 blocked/failed/approval_required, 2
usage error). Run `node cli.mjs` with no command for usage.

`mutation.mjs`: shared lock, atomic file replacement and full handled-error rollback.

`health.mjs`: `buildStatus` and `inspectHealth`, catalog freshness, audits, growth
and archived lineage; read diagnostics do not claim causal effectiveness.

`index.mjs`: the public re-export surface listed below.

## Programmatic API

```js
import {
  applyProposal, planProposal, expireWorkspaceState, findSimilar, formatReceipt, serializeRule,
  renderCatalog, replaceCatalogBlock, writeCatalog,
  recordConsultation,
  initWorkspace,
  scanMemory, syncMemoryIndex, renderMemoryIndex,
  migrateV1,
  normalizeSignature, selectRules,
  buildWeeklyReport,
  loadWorkspace, inspectConfig, inspectRule, inspectStateEntry, DEFAULT_CONFIG, SCHEMA_VERSION,
  parseYaml, parseFrontmatter, serializeFrontmatter, toYaml,
  sha256Text, unifiedDiff, findPrivacyHazard,
} from "./index.mjs";

const workspace = await loadWorkspace(workspaceRoot, { today: "2026-09-14" });
if (workspace.status !== "ok") throw new Error(workspace.failures.join("\n"));

const selection = selectRules(workspace, { paths: ["ilands/migrations/481.sql"], ops: ["migration"] });
// Read all pages: selection.complete must be true before claiming completion.

const result = await applyProposal({ workspaceRoot, proposal, approved: false, today: "2026-09-14", kitVersion: "0.8.1" });
if (result.status === "applied") console.log(result.receipt);
else console.log(result.status, result.reason, result.details ?? "");

await recordConsultation({ workspaceRoot, consulted: ["hot-table-partial-index-cic"], missed: [] });
```

All paths passed in are absolute or process-relative; everything the runtime
stores is workspace-relative. The runtime makes no network calls and spawns
no processes.

## Invariants the runtime enforces

- It writes only under `.agent-context/` and inside the `acp-catalog` block
  of `config.agents_file`; nothing else in the instruction file is touched.
- All normal Schema 2 mutations reload under the shared lock. Handled failures
  restore all touched files; incomplete rollback retains the lock and reports
  failed paths. This is not crash-atomic across files; see the protocol.
- A proposal with `fix_status` other than `verified`, or with a privacy
  hazard in any text, never writes, even with `approved: true`.
- The catalog is derived from `rules/` and `STATE.yml`; it is never a source
  of truth and can be re-rendered at any time with `writeCatalog`.

## Tests

`tests/runtime/*.test.mjs` cover each module by observable file outcome:
`yaml`, `text`, `workspace`, `catalog`, `select`, `apply`, `consult`,
`weekly`, `memory-bridge`, `migrate-v1`, and `cli`. Run everything with
`npm test` from the repository root.
