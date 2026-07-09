# Demo Harness

The demos are lightweight fixtures that prove the v1 evolution flow:

1. Initialize workspace context.
2. Simulate a failure.
3. Create an evidence-backed proposal.
4. Apply an approved context patch.
5. Confirm future runs can read the new context.

Run:

```bash
npm test
```

## Demos

- `markdown-smoke`: smallest possible workspace context fixture.
- `fake-js-repo`: coding-oriented fixture with an applied proposal.

