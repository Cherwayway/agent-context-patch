---
id: 2026-07-10-markdown-fixture-scope
trigger: stale_context
fix_status: verified
operations: [add]
targets: [.agent-context/rules/markdown-fixture-no-toolchain.md]
before_hashes: {}
after_hashes:
  ".agent-context/rules/markdown-fixture-no-toolchain.md": aee203be1906486e6211d4e406dde32c442d903a8bb29071305ee2c8cd4b8e1c
decision: auto_applied
applied_at: 2026-07-10T00:00:00.000Z
kit_version: "0.7.0"
catalog_bytes: 564
---

## Evidence

demos/markdown-smoke/README.md describes a workspace with no programming language

## Diff

```diff
--- /dev/null
+++ .agent-context/rules/markdown-fixture-no-toolchain.md
@@ -0,0 +1,18 @@
+---
+id: markdown-fixture-no-toolchain
+hook: "Keep this fixture valid without assuming a programming language, package manager, or Git repository"
+kind: gate
+applies_to:
+  repos: []
+  paths: []
+  ops: [docs]
+  skills: []
+supersedes: []
+source: 2026-07-10-markdown-fixture-scope
+created: 2026-07-10
+consulted: 0
+last_consulted: null
+missed: 0
+---
+
+Changes here must stay plain Markdown. Do not add build scripts, lockfiles, or Git-only conventions.
```
