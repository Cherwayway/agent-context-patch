---
id: 2026-07-09-greeting-contract
trigger: verification_failure
fix_status: verified
operations: [add]
targets: [.agent-context/rules/greeting-preserve-caller-name.md]
before_hashes: {}
after_hashes:
  ".agent-context/rules/greeting-preserve-caller-name.md": 78d0d058e1ee7ec7d7a42f084f52f375c335bbd0eb35a11b602119c54dbc9488
decision: auto_applied
applied_at: 2026-07-09T00:00:00.000Z
kit_version: "0.7.0"
catalog_bytes: 568
---

## Observed

npm test failed: greeting must preserve caller-provided names. The greeting was hard-coded to World.

## Evidence

test/greeting.test.js#greeting must preserve caller-provided names (fail-to-pass in the same task)

## Root cause

The greeting template dropped the name argument, and no rule warned about the contract before editing.

## Diff

```diff
--- /dev/null
+++ .agent-context/rules/greeting-preserve-caller-name.md
@@ -0,0 +1,18 @@
+---
+id: greeting-preserve-caller-name
+hook: Greeting output must preserve the caller-provided name; a hard-coded greeting fails the contract test
+kind: gate
+applies_to:
+  repos: []
+  paths: [src/greeting.js]
+  ops: [coding]
+  skills: []
+supersedes: []
+source: 2026-07-09-greeting-contract
+created: 2026-07-09
+consulted: 0
+last_consulted: null
+missed: 0
+---
+
+Run `npm test` after any change to src/greeting.js. The contract test is `greeting must preserve caller-provided names`; it fails the moment the template stops interpolating the argument.
```
