# Markdown Smoke Demo

This fixture represents a minimal non-code workspace. It proves that Agent
Context Patch can initialize and read `.agent-context/` without requiring a
package manager, framework, Git repository, Node Commit Kernel, or `auto`.

Expected behavior:

- `$evolve init` reports the current-run `contextRead`.
- The workspace remains usable in `propose` mode without Node.
- Domain candidates require evidence and are not activated implicitly.
- No domain-specific source files are required.
