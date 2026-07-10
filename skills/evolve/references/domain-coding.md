# Domain Pack: Coding

Use for implementation, debugging, review, CI, refactoring, and release work.

## Detection Guidance

Candidate evidence includes source and test directories, a package/build
manifest, CI configuration, or verified build and test commands. Do not enable
from a repository name alone.

## Checks

- Read project instructions and current source-of-truth docs.
- Confirm the requirement source for non-trivial scope.
- Keep edits within the requested behavior and architecture boundary.
- Run the narrowest useful verification, then the required broader checks.
- Preserve generated or historical evidence unless the task owns it.

## Evidence Examples

- workspace-relative failing test pointer plus command and exit code
- current project instruction that required a skipped command
- user correction to an architecture boundary
- review finding with a source pointer

## What Not To Memorize

- one-off bug detail with no recurring lesson
- temporary network or registry failure
- local path unless the project contract depends on it
- unverified architecture guess

## Cleanup Rules

Propose cleanup when a rule names deleted paths, old build tools, retired
commands, or an architecture contradicted by current sources.

## Materialized Checklist

- Read active project instructions and relevant context before editing.
- Confirm the requirement and affected boundary.
- Keep the patch scoped.
- Run narrow verification and required project checks.
- Report exact verification evidence.
- Use replace-before-add for any reusable failure lesson.
