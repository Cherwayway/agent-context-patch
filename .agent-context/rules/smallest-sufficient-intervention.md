---
id: smallest-sufficient-intervention
hook: Prefer a rule or STATE entry over new kit behavior; deepen an existing command before adding one
kind: advice
applies_to:
  repos: []
  paths: [skills/evolve/**]
  ops: [coding]
  skills: []
supersedes: []
source: 2026-09-14-schema-2-dogfood
created: 2026-09-14
consulted: 0
last_consulted: null
missed: 0
---

Keep the public command surface small. A kit change needs a reproducible failure and a test; a workspace lesson needs only a rule.
