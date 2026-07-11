# Workspace Config Schema v1

.agent-context/config.yml is the truth source for workspace write policy,
enabled domain packs, health thresholds, and schema compatibility.

The runtime and repository verifier use the same production parser and
validator. A current config must contain this complete envelope; missing or
unsupported fields do not create a partially enabled mode. Quoted scalars and
inline or block domain lists are equivalent, while duplicate domains and
unknown fields are rejected.

PowerShell and Bash Bootstrap cannot assume Node is present, so their native
validators implement this same envelope and are held to shared black-box
fixtures. A file that merely says `schema_version: 1` is invalid, not current.

## Required shape

~~~yaml
schema_version: 1
created_with_kit_version: "0.3.0"
last_migrated_with_kit_version: null

context_write_policy: propose
enabled_domains: []

budgets:
  active_context:
    unit: lines
    warn: 500
    block_auto: 800
  single_proposal:
    unit: lines
    warn: 220
  pending_proposals:
    unit: count
    warn: 8
    block_auto: 12

privacy:
  raw_conversation_stored: false
  full_logs_stored: false
  secrets_stored: false
  customer_data_stored: false
  absolute_user_paths_stored: false
~~~

## Semantics

- schema_version must be 1. Missing means legacy_v0; a higher version is
  read-only for this kit.
- created_with_kit_version records the initializing kit.
- last_migrated_with_kit_version is null until a migration succeeds, then
  records the kit that applied it.
- context_write_policy is propose or auto. Auto must be explicitly selected by
  the user and still passes every protocol gate.
- enabled_domains is the only domain activation truth source. Detection
  candidates never appear here before InitPlan approval.
- unit is lines for active_context and single_proposal, and count for
  pending_proposals.
- warn must be a positive integer. block_auto must be greater than warn.
- single_proposal intentionally has no hard ceiling.
- all five privacy outcomes are required and false. They are invariants, not
  opt-outs.

Every non-migration kernel call requires a complete valid v1 config, including
human-approved calls. A future schema is read-only. A migration must replace or
create `config.yml` with a complete valid v1 envelope in its approved
transaction.

Changing config, enabling auto, changing a domain, or weakening a threshold is
approval-only. The kernel cannot auto-write config.yml.

Do not add approval flags, evolution style, repo budgets, global budgets, or a
second domain list. Approval is derived from the protocol and user-global
guidance is outside active workspace config.
