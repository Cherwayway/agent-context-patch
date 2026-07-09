# Domain Pack: Coding

Use this pack for implementation, debugging, review, CI, refactoring, and
release tasks.

## Triggers

- Build, lint, test, or typecheck failure.
- User says the agent changed the wrong file or over-engineered.
- PR review rejects the change.
- Agent skipped required project context.
- Repeated mistakes around commands, architecture, or conventions.

## Checks

- Did the requirement exist in a file or approved issue/spec when needed?
- Did the agent read project instructions and relevant docs?
- Were edits scoped to the requested behavior?
- Were tests or narrow validation run?
- Was any generated or historical evidence edited improperly?

## Evidence Examples

- `npm test` failed with a summarized error.
- `AGENTS.md` required a command that was skipped.
- User corrected the expected architecture boundary.
- PR review noted a missing test.

## What Not To Memorize

- A one-off bug detail with no recurring lesson.
- Temporary network or package registry failure.
- Local-only path unless the project depends on it.
- Unverified guesses about architecture.

## Cleanup Rules

Archive coding rules that reference deleted directories, old build tools, or
commands no longer present in the repo.

