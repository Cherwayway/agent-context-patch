---
id: greeting-preserve-caller-name
hook: Greeting output must preserve the caller-provided name; a hard-coded greeting fails the contract test
kind: gate
applies_to:
  repos: []
  paths: [src/greeting.js]
  ops: [coding]
  skills: []
supersedes: []
source: 2026-07-09-greeting-contract
created: 2026-07-09
consulted: 0
last_consulted: null
missed: 0
---

Run `npm test` after any change to src/greeting.js. The contract test is `greeting must preserve caller-provided names`; it fails the moment the template stops interpolating the argument.
