# Cleanup Policy

Agents must manage context drift. Adding context without cleanup eventually
makes the agent worse.

## Cleanup Triggers

Run `$evolve review-context` when:

- Current code contradicts existing context.
- A user says existing context is wrong or outdated.
- Pending proposals exceed 10.
- A context file exceeds its budget.
- Two rules say the same thing.
- A rule is too broad to guide behavior.
- A mistake record is no longer relevant.

## Deprecation Proposal

Cleanup should usually be proposed, not silently applied.

Include:

```yaml
deprecation_reason:
replacement_context:
evidence:
```

Previously approved context may be overwritten directly only when the user's
write policy allows it or when the user explicitly asks for direct updates. In
all cases, notify the user.

## Do Not Memorize

Do not preserve:

- One-time requirements.
- Temporary workarounds.
- Unverified guesses.
- Emotional feedback without a reusable lesson.
- Details from deprecated architecture.
- Secrets, credentials, customer data, or private personal data.

