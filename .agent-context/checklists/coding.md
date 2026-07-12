# Coding And Dogfooding Checklist

Use this checklist before changing the evolution protocol, schemas, templates,
adapters, or validation behavior.

## Evidence

- [ ] Is the change connected to an observed personal workflow problem?
- [ ] Is the evidence factual and free of secrets or private conversation text?
- [ ] Is this recurring, high-risk, or a direct user-approved durable decision?

## Smallest Intervention

- [ ] Could a project fact solve it?
- [ ] Could a checklist solve it?
- [ ] Could an existing `$evolve` command be deepened instead of adding one?
- [ ] If kit behavior must change, is the failure reproducible?
- [ ] If evidence is weak, did we choose observation or no durable change?

## Verification

- [ ] Does the issue, ADR, or change record define what better behavior looks
  like?
- [ ] Were relevant demos, docs, adapters, and templates checked for drift?
- [ ] Did `npm test` pass?
- [ ] Was a real task or fixture used when structural validation is insufficient?

## Cleanup

- [ ] Does the change replace any stale rule or workaround?
- [ ] Were superseded files or proposals archived?
- [ ] Did context remain within budget and actionable?
