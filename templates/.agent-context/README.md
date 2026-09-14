# Agent context (Schema 2)

- rules/<id>.md      one rule per file: frontmatter (hook, kind, applies_to) + short body
- STATE.yml          dated working state; every entry expires and is archived automatically
- PROFILE.md         verified workspace facts only; never rules
- proposals/<id>.md  audit record per applied change: evidence + unified diff
- reports/           rebuildable weekly reviews
- archive/           superseded or retired rules, expired state, pre-migration history

The always-on view of this directory is the `acp-catalog` block that evolve
renders into the workspace instruction file. Edit rules through `evolve apply`;
hand edits are allowed but the catalog must be re-rendered afterwards.
