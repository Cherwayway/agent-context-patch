# ADR-0009: Progressive Context Compilation From Active Context

- Status: Accepted
- Date: 2026-09-01
- Extends: ADR-0001 and ADR-0007

## Context

Schema 1 keeps current workspace guidance in one small Active Context: the
context index, project profile, and enabled checklists. Ordinary tasks have so
far loaded those files as a whole. That is safe, but as useful rules accumulate
it makes an unrelated task pay for every rule and increases the chance that a
broad instruction constrains work where it does not apply.

Proposal history has the opposite problem. It is intentionally outside the
default model context, so a relevant pending correction can be easy to miss.
Loading every proposal would spend still more context and would incorrectly
promote unapproved proposal content into guidance.

The needed seam is a deterministic, read-only compiler that a compatible host
can place before model-context injection: keep safety and unclassified guidance
visible, progressively disclose only packs selected by structured task signals,
and surface only a bounded attention pointer when a non-terminal proposal
explicitly targets selected context. This is routing, not semantic effectiveness
scoring.

## Decision

### 1. A read-only Context Compiler

The installed evolve runtime exposes a deep API:

~~~js
compileWorkspaceContext({ workspaceRoot, taskSignature })
~~~

`taskSignature` is structured and contains no raw prompt:

~~~js
{
  schemaVersion: 1,
  operations: [],
  paths: [],
  tools: [],
  skills: [],
  domains: [],
  risk: "normal", // or "high"
  requestedPacks: [],
}
~~~

Paths are workspace-relative. The compiler performs no model call, network
request, reconciliation, lifecycle transition, or workspace write. It returns
an ephemeral result:

~~~js
{
  schemaVersion: 1,
  status: "compiled",       // compiled | fallback | blocked
  mode: "progressive",      // progressive | legacy_full | none
  reason,
  content,
  catalog,
  selectedPackIds,
  selections,
  attention,
  metrics: {
    fullContextBytes,
    modelVisibleBytes,
    savedBytes,
    reductionBasisPoints,
  },
  warnings,
}
~~~

A compatible consumer must expose only `content` to the model; the remaining
fields are host-side diagnostics. `content` includes the rendered catalog and
attention surface in addition to core and selected pack content. Byte metrics
count that final UTF-8 payload, including routing overhead, but do not prove
actual token savings without compatible host injection. The structured catalog,
selections, and metrics make routing inspectable; they are not a second source
of truth or a usage ledger.

### 2. Routing metadata stays with the guidance

Active Markdown may wrap a bounded block with a single-line strict-JSON marker:

~~~md
<!-- acp-context: {"schemaVersion":1,"id":"workspace-safety","kind":"core","description":"Safety and authority invariants."} -->
## Safety

- Verify current sources before relying on a point-in-time project fact.
<!-- /acp-context -->
~~~

A task-routed pack uses `kind: "pack"`, a `priority` of `normal` or `safety`,
and one non-empty `match` object. Supported selectors are `operations`,
`pathPrefixes`, `pathBasenames`, `tools`, `skills`, `domains`, and `risks`.
Within one selector any value may match; across selectors that are present, all
must match.

The runtime derives `catalog` from these co-located blocks. There is no
separate catalog file to drift from the guidance it describes. Core blocks and
content outside marked blocks in the task-relevant read set remain present. A
normal pack is selected by its hard task signals or by exact `requestedPacks`;
a high-risk task also selects task-relevant safety-priority packs.
Task-signature domains choose the task-relevant enabled checklists; an empty
list conservatively reads every enabled checklist and uses every enabled domain
during matching. A host-side metadata scan covers every enabled checklist so
block IDs remain workspace-global. Ordinary hard matching is limited to the
task-relevant set. Exact requests expand the read to the requested pack's source
checklist; high-risk selection includes every safety pack in the task-relevant
set. Unknown explicit pack requests, absent markers,
malformed or overlapping blocks, unsafe paths, unsupported schema, missing
high-risk safety coverage, or another ambiguous parse never produce a partial
context. A high-risk task also falls back when relevant attention exceeds three
items, any non-terminal proposal lacks an explicit context edge, or the bounded
proposal scan is incomplete. At normal risk a globally incomplete proposal scan
keeps the independently compiled context projection but suppresses all
attention pointers, because global proposal-ID uniqueness cannot be established.
The compiler either returns the complete legacy default read set with
`mode: "legacy_full"` or blocks when
even that read cannot be performed safely.

Progressive compilation accepts at most 64 context blocks. Overflow returns
the complete legacy read set without a rendered catalog. Credential-shaped
marker metadata blocks with empty content because returning the raw marker
through fallback would repeat the unsafe value.

`active`, `selected`, `loaded`, and `material_use` remain different states. An
active rule is eligible guidance. Selection means only that routing chose its
pack. Loading means only that the compiled payload exposed it. Material use
still requires bounded evidence that it changed planning, execution, or
verification and produced an observable result.

### 3. Proposal attention is bounded and non-authoritative

A proposal may optionally declare context edges in frontmatter:

~~~yaml
attention_targets:
  - context:coding-database
  - rule:2026-08-11-isolated-verification#1
~~~

The compiler may inspect only valid frontmatter for the non-terminal statuses
`pending_current_fix`, `proposed`, and `approved`. Its bounded prefix scanner
parses only frontmatter and never emits proposal body, PatchPlan content,
Decision Log, or Apply Attempts; it does not reconcile or write the proposal.
At most three relevant attention items are returned.

Attention says only that a pending artifact claims an edge to selected context.
It is not Active Context, approval, or current truth. The consumer must verify
the affected claim against current sources before deciding whether to inspect
that proposal more deeply. Existing proposals are not backfilled and edges are
never inferred. Without `attention_targets`, normal-risk compilation creates no
attention item for that proposal; high-risk compilation falls back with a
bounded manual-inspection hint.

New Active Context rules use the exact canonical marker
`<!-- acp-rule: <source>#<positive ordinal>; source: <source>; subsumes: none -->`.
For reader compatibility only, the compiler also accepts historical markers of
the exact form
`<!-- acp-rule: id=<source>-<positive ordinal> source=<source> subsumes=<rule-id-list-or-none> -->`.
Both marker spellings and both rule-edge spellings normalize to
`<source>#<positive ordinal>`. New writers never emit the historical form, and
the compiler does not migrate or rewrite an existing workspace.

A malformed bounded marker or duplicate logical rule identity forces complete
fallback at any risk. Oversized, incompletely bounded, or credential-shaped
rule metadata blocks with empty content instead of being echoed. The
512-candidate inspection budget is shared by the complete enabled Active
Context catalog for one compilation. A missing normalized attention target is
dangling: normal risk warns and omits that
target, while high risk falls back. A known rule in an unselected pack is
irrelevant rather than dangling. Duplicate proposal IDs or two aliases for the
same rule in one proposal cannot yield a pointer; normal risk warns and high
risk falls back because the scan is incomplete. Any globally incomplete bounded
proposal scan likewise suppresses all normal-risk attention pointers.

### 4. Progressive disclosure is fail-open to complete guidance

The safety fallback is the previous behavior: load the complete Schema 1
default read set. Routing uncertainty must never silently omit a core rule or
an older unmarked rule. Existing workspaces therefore remain usable without a
marker migration, although they receive no context reduction until their
guidance is explicitly organized into valid packs.

Reclassifying existing core or unmarked guidance into a routed pack changes
when that guidance is visible. It is a semantic narrowing operation, not a
mechanical annotation, and follows the existing reviewed cleanup lifecycle.
There is no bulk migration.

### 5. Activation remains explicit

The compiler is a runtime API, not a daemon, platform hook, startup scan, or new
public command. It installs no pre-first-model-call integration. A fresh-install
workflow may propose the updated adapter instruction for separate semantic
review; Bootstrap and Kit update do not rewrite an existing `AGENTS.md`,
`CLAUDE.md`, or workspace index. An old installation therefore does not silently
begin progressive loading merely because the evolve skill was replaced.

## Workspace Schema Compatibility

Workspace Schema remains 1:

- storage topology, config keys, proposal lifecycle, and PatchPlan semantics do
  not change;
- context markers and `attention_targets` are optional, backward-compatible
  metadata in existing Markdown records;
- the catalog is derived at runtime and is never persisted as another truth
  source;
- compiler output and metrics are ephemeral and create no workspace record;
- old, unmarked, or ambiguous workspaces retain the complete legacy read path;
  and
- no existing workspace must be rewritten or migrated to remain valid.

Kit Version 0.6.0 identifies this new read behavior. Kit Version 0.6.1 repairs
historical `acp-rule` reader compatibility and ambiguous attention handling;
it does not set `last_migrated_with_kit_version` or authorize a Workspace
Schema migration. Its scope is limited to `acp-rule` metadata. The
`acp-context` grammar and unrelated context-fence or cross-line behavior are
unchanged. A required routing registry, new config envelope, durable usage
ledger, or persisted compiled-context artifact would be a separate schema
decision.

## Consequences

- Context cost can fall when task signals select a small subset, while core and
  older guidance remain visible.
- Proposal awareness no longer requires injecting full proposal prose.
- Deterministic routing is reproducible and measurable in UTF-8 bytes, but does
  not by itself prove better Agent behavior.
- Fresh-Agent paired acceptance must establish non-inferior task behavior and
  guard against negative over-constraint before effectiveness is claimed.
- Existing instruction files require a separately reviewed semantic patch to
  invoke the compiler automatically.

## Rejected Alternatives

- **Inject every proposal from a hook:** spends model context and treats
  unapproved prose as guidance.
- **Let a model route from the raw prompt:** adds another model call, makes
  selection harder to reproduce, and can expose task content.
- **Persist a separate rule catalog:** creates a second truth source that can
  drift from Active Context.
- **Drop unmatched or malformed content:** can hide rare safety constraints.
- **Infer effectiveness from selection or byte reduction:** repeats the error
  of treating loaded context as material use.
- **Migrate immediately to Workspace Schema 2:** adds compatibility and backup
  cost without any new required durable state.
