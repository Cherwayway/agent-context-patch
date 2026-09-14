---
id: fixture-workspaces-are-schema-2
hook: Demo and dogfood workspaces must stay loadable Schema 2 workspaces with a catalog block that matches a fresh render
kind: gate
applies_to:
  repos: []
  paths: [demos/**, .agent-context/**, templates/**]
  ops: [coding]
  skills: []
supersedes: []
source: 2026-09-14-schema-2-dogfood
created: 2026-09-14
consulted: 0
last_consulted: null
missed: 0
---

After changing runtime rendering, re-render every fixture catalog (`node skills/evolve/runtime/cli.mjs catalog --write --workspace <dir>`) so the contract test's render comparison stays green.
