# Demo Harness

The demos are Workspace Schema 2 fixtures. Each one shows the Agent Context
Patch journey through observable artifacts:

1. A `.agent-context/` workspace with `config.yml` (`schema_version: 2`),
   `STATE.yml`, and `PROFILE.md`.
2. One rule in `rules/<id>.md` with a one-line hook, a kind, and a scope.
3. One applied audit record in `proposals/<id>.md` carrying the evidence,
   before/after hashes, and the unified diff of that rule.
4. An `AGENTS.md` carrying the rendered `acp-catalog` block, so the next run
   sees the hook without a read decision.

Run the repository verification interface from the repository root:

```bash
npm test
```

## Demos

- `markdown-smoke`: a non-code workspace with no package-manager requirement.
- `fake-js-repo`: a coding workspace with a verified greeting contract and a
  gate rule that points at the test protecting it.

Static files are fixtures, not proof by themselves. The verification gate runs
the fake project's own `npm test`, and the repository contract test loads each
fixture workspace, re-renders its catalog, and compares it with the block in
`AGENTS.md`. After editing a fixture rule, re-render with
`node skills/evolve/runtime/cli.mjs catalog --write --workspace <demo>`.
