# Agent Context Patch (dogfood workspace)

This repository dogfoods its own kit. The block below is rendered by `evolve`;
rule bodies live in `.agent-context/rules/`. Do not edit the block by hand.

<!-- acp-catalog: kit=0.8.1 schema=2 rendered=2026-10-09T08:50:18.582Z rules=3 state=0 -->
## Workspace Context Catalog

Read .agent-context/rules/<id>.md first. (+ops) adds ops. Select needs repos; no edits.
### any · coding
- gate [fixture-workspaces-are-schema-2] Demo and dogfood workspaces must stay loadable Schema 2 workspaces with a catalog block that matches a fresh render
- advice [smallest-sufficient-intervention] Prefer a rule or STATE entry over new kit behavior; deepen an existing command before adding one
### any · release
- gate [kit-version-single-source] Bump the kit version only in package.json, then run npm run version:sync; every other manifest is generated
<!-- /acp-catalog -->
