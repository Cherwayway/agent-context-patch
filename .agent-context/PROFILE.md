# Profile

Verified workspace facts only. Replace stale facts instead of appending history.

## Workspace

- Repositories: this repository (Agent Context Patch kit)
- Environments: GitHub Actions runs `npm test` on Ubuntu and Windows; releases are immutable GitHub Releases

## Commands

- Test: `npm test`
- Version sync: `npm run version:sync` (check: `npm run version:check`)
- Plugin sync: `npm run plugin:sync`

## Layout

- Skill protocol: `skills/evolve/SKILL.md`; runtime: `skills/evolve/runtime/`
- Workspace scaffold: `templates/.agent-context/`
- Bootstrap adapters: `install/`; verification: `tests/` via `scripts/run-verification.mjs`

## Verification State

- Last verified at: 2026-09-14 against package.json, skills/evolve/SKILL.md, and npm test
