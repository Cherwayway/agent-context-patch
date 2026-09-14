# Markdown Smoke Demo

This fixture represents a minimal non-code workspace. It proves that Agent
Context Patch can hold a Schema 2 `.agent-context/` and a rendered catalog
without requiring a package manager, framework, or Git repository.

Expected behavior:

- `AGENTS.md` carries the `acp-catalog` block with the single `docs` gate.
- The rule body and the applied audit record are plain Markdown; nothing here
  needs a build step.
- The contract test re-renders the catalog from `rules/` and `STATE.yml` and
  requires it to match the block byte-for-byte.
- No language-specific source files are required.
