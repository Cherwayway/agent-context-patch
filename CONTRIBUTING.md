# Contributing

Agent Context Patch is intentionally small. Contributions should improve the
mistake-to-context loop without turning every task into a heavyweight process.

## Domain Packs

New domain packs must include:

- Trigger conditions.
- Checks.
- Evidence examples.
- What not to memorize.
- Cleanup rules.

Domain packs should be usable as guidance, not as rigid process engines. Keep
them short enough for an agent to load during real work.

## Context Rules

Do not add guidance that encourages agents to silently modify long-term context
without user approval. The default policy is proposal-first.

Do not store secrets, customer data, production credentials, or unnecessary
private conversation text in examples, proposals, reports, or fixtures.

## Testing

Run:

```bash
npm test
```

The validation script checks the scaffold and demo harness. Add focused tests
when you add a new adapter, schema, or domain pack.
