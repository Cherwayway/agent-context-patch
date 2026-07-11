# Domain Packs

Domain detection and domain activation are separate.

## Detection

The agent may detect candidates from project evidence. Each candidate in the
temporary InitPlan contains:

~~~yaml
- id: coding
  confidence: high
  evidence:
    - package.json defines a test command
    - src/ and test/ exist
  uncertainties: []
~~~

Detected candidates are not active context and are not persisted as a second
truth source.

## Activation

The InitPlan proposes which candidates to enable. One human approval may cover
the complete InitPlan.

config.yml enabled_domains is the only activation truth source. A profile may
display the enabled list but must label it as derived. A checklist is
materialized only after its domain is approved and enabled.

Auto cannot enable, disable, or replace a domain pack.

## Pack ownership

A pack owns:

- ID and purpose
- detection guidance and evidence
- executable checks
- evidence examples
- what not to memorize
- cleanup rules
- checklist materialization content

Bootstrap does not preinstall every checklist. It creates the directory
contract; init materializes selected packs.

## Workspace-specific guidance

If no pack fits, propose a workspace-specific checklist. Do not invent a new
generic pack for one project. Consider promotion only after the pattern recurs
across workspaces and a human approves a sanitized user-global or kit change
outside this v1 active-context model.
