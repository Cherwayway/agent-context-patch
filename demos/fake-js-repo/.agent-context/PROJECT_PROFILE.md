# Project Profile

## Product / Project

- Name: Fake JS Repo
- Purpose: Demonstrate the $evolve after-failure and $evolve approve flow.
- Current status: Verified fixture.

## Enabled Domains

Derived from config.yml:

- coding

## Technical Context

- Main language: JavaScript
- Test command: npm test

## Active Working Rules

- Greeting output must preserve caller-provided names.
- Run npm test after changing src/greeting.js.

## Known Risks

- A hard-coded greeting could silently ignore the caller-provided name.

## Current Uncertainties

- None for the demonstrated greeting contract.

## Verification State

- Last verified at: 2026-07-10
- Verified against: package.json, test/greeting.test.js, and npm test.
