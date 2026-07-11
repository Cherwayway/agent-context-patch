# Cleanup Policy

Use cleanup to make active context more accurate and higher leverage, not merely
shorter.

## Replace before add

Before adding an active rule, compare it with current rules:

- no matching responsibility: propose add
- same meaning: retain one rule and add evidence to the proposal history
- partial overlap: propose tighten, merge, or rewrite
- conflict: propose supersede
- lower-authority lesson: keep the proposal but do not activate it
- historical example: archive the example and retain the executable rule

Auto is not allowed when overlap, replacement, or semantic removal is involved.

## Authority

Use authority to resolve conflicting claims:

1. explicit approved user decision for desired future state
2. current code, tests, formal spec, or ADR for current state
3. verified approved active context
4. repeated observation
5. single observation, inference, or heuristic

The current source still wins when an older approved instruction claims a fact
that is no longer true. Keep current facts separate from future intent.

## Retention value

Judge retention value as high, medium, or low with evidence. Consider:

- severity if forgotten
- recurrence
- number of tasks affected
- specificity and actionability
- agreement with current sources
- coverage by a stronger rule
- whether it is only an example
- active-context cost

Do not compute a mechanical score.

## Cleanup triggers

Generate a cleanup proposal when:

- current code or an approved source contradicts context
- a path, command, architecture, or domain is no longer current
- rules duplicate, overlap, or conflict
- a rule is too broad or vague to guide action
- examples obscure the executable principle
- lower-authority context hides higher-authority guidance
- a domain is being disabled
- a new proposal can replace or tighten existing context
- a configured warn or block_auto threshold is crossed

## Cleanup proposal

For every affected rule, include:

- exact rule and source proposal when known
- current purpose and evidence
- authority and retention value
- overlap, conflict, or staleness evidence
- proposed operation and replacement
- behavior lost if approved
- net active-context change

Allowed semantic actions are tighten, merge, rewrite, supersede,
demote_to_checklist, archive_example, and archive_rule. Any operation that
changes or removes active context requires human approval, including under
auto.

Never delete proposal audit history. Move inactive context to archive and link
its replacement proposal when appropriate.

## Do not retain as active context

- one-time requirements
- temporary workarounds with no reusable constraint
- unverified guesses
- emotional feedback without a reusable lesson
- details from rejected or obsolete architecture
- secrets, credentials, customer data, or private personal data
