# Markdown Smoke Demo

This fixture represents a minimal non-code workspace. It proves that Agent Loop
Kit can initialize `.agent-context/` without requiring a package manager,
framework, or Git repo.

Expected behavior:

- `$evolve init` creates `.agent-context/`.
- The agent reports `contextRead`.
- No domain-specific source files are required.

