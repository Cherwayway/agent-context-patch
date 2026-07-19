# Proposals

Each proposal file is one complete internal evolution aggregate containing
minimal evidence, the exact patch, Decision Log, Apply Attempts, supersession,
and rejection history. Eligible auto proposals are applied in the same Agent
turn; this directory is not a default user approval inbox.

Use:

~~~text
YYYY-MM-DD-short-slug.md
~~~

Follow the installed evolve skill reference proposal-schema.md. Do not create
separate mistake or receipt files.

The installed Lifecycle Coordinator reconciles unfinished aggregates only when
an existing evolve workflow invokes it. It does not scan in the background and
never infers an applied audit merely because target bytes match an after hash.

Proposal counts are triage signals. Crossing a configured threshold blocks auto
and schedules review; it never discards a new proposal.
