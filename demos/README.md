# Demo Harness

The demos exercise the v1 Agent Context Patch journey through observable
artifacts:

1. Initialize versioned workspace context.
2. Run and verify the current project behavior.
3. Record one evidence-backed proposal aggregate.
4. Bind a `policy_auto` Decision to an eligible exact PatchPlan.
5. Record a successful ApplyAttempt.
6. Confirm the next run can read the resulting Active Context.

Run the repository verification interface from the repository root:

```bash
npm test
```

## Demos

- `markdown-smoke`: a non-code workspace with no package-manager requirement.
- `fake-js-repo`: a coding workspace with a verified greeting contract and an
  automatically applied proposal aggregate.

Static files are fixtures, not proof by themselves. The root verification gate
must execute the fake project test and validate the v1 records.
