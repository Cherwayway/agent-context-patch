---
id: kit-version-single-source
hook: "Bump the kit version only in package.json, then run npm run version:sync; every other manifest is generated"
kind: gate
applies_to:
  repos: []
  paths: [package.json, skills/evolve/manifest.json, templates/.agent-context/config.yml]
  ops: [release]
  skills: []
supersedes: []
source: 2026-09-14-schema-2-dogfood
created: 2026-09-14
consulted: 0
last_consulted: null
missed: 0
---

The repository contract test runs `sync-kit-version.mjs --check`. Editing a manifest by hand leaves the surfaces out of sync and fails `npm test`.
