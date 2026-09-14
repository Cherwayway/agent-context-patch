---
id: 2026-09-14-schema-2-dogfood
trigger: stale_context
fix_status: verified
operations: [add, add, add]
targets: [.agent-context/rules/fixture-workspaces-are-schema-2.md, .agent-context/rules/kit-version-single-source.md, .agent-context/rules/smallest-sufficient-intervention.md]
before_hashes: {}
after_hashes:
  ".agent-context/rules/kit-version-single-source.md": 615d4c8a8482685b07cfa57d330dc0a7486b1069bd62dcb5b626d2edaab7e72d
  ".agent-context/rules/fixture-workspaces-are-schema-2.md": ea42d507c951e3fc293a40eeb88246f265b4e28ace15363ac7ecd6d0ebf7ba5b
  ".agent-context/rules/smallest-sufficient-intervention.md": b095404bcd1dc4b8aa4ffd9c2f8fdd97a129c2e63bb092b62610db9dc3b7a3bd
decision: auto_applied
applied_at: 2026-09-14T00:00:00.000Z
kit_version: "0.7.0"
catalog_bytes: 888
---

## Evidence

docs/adr/0010-read-first-catalog-and-schema-2.md; tests/verification/repository-contract.test.mjs

## Diff

```diff
--- /dev/null
+++ .agent-context/rules/kit-version-single-source.md
@@ -0,0 +1,18 @@
+---
+id: kit-version-single-source
+hook: "Bump the kit version only in package.json, then run npm run version:sync; every other manifest is generated"
+kind: gate
+applies_to:
+  repos: []
+  paths: [package.json, skills/evolve/manifest.json, templates/.agent-context/config.yml]
+  ops: [release]
+  skills: []
+supersedes: []
+source: 2026-09-14-schema-2-dogfood
+created: 2026-09-14
+consulted: 0
+last_consulted: null
+missed: 0
+---
+
+The repository contract test runs `sync-kit-version.mjs --check`. Editing a manifest by hand leaves the surfaces out of sync and fails `npm test`.
--- /dev/null
+++ .agent-context/rules/fixture-workspaces-are-schema-2.md
@@ -0,0 +1,18 @@
+---
+id: fixture-workspaces-are-schema-2
+hook: Demo and dogfood workspaces must stay loadable Schema 2 workspaces with a catalog block that matches a fresh render
+kind: gate
+applies_to:
+  repos: []
+  paths: [demos/**, .agent-context/**, templates/**]
+  ops: [coding]
+  skills: []
+supersedes: []
+source: 2026-09-14-schema-2-dogfood
+created: 2026-09-14
+consulted: 0
+last_consulted: null
+missed: 0
+---
+
+After changing runtime rendering, re-render every fixture catalog (`node skills/evolve/runtime/cli.mjs catalog --write --workspace <dir>`) so the contract test's render comparison stays green.
--- /dev/null
+++ .agent-context/rules/smallest-sufficient-intervention.md
@@ -0,0 +1,18 @@
+---
+id: smallest-sufficient-intervention
+hook: Prefer a rule or STATE entry over new kit behavior; deepen an existing command before adding one
+kind: advice
+applies_to:
+  repos: []
+  paths: [skills/evolve/**]
+  ops: [coding]
+  skills: []
+supersedes: []
+source: 2026-09-14-schema-2-dogfood
+created: 2026-09-14
+consulted: 0
+last_consulted: null
+missed: 0
+---
+
+Keep the public command surface small. A kit change needs a reproducible failure and a test; a workspace lesson needs only a rule.
```
