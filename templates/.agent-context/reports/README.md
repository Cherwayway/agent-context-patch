# Reports

Store compact weekly and context-health reports here.

Reports are rebuildable views over current context and proposal aggregates. They
are not active sources of truth and ordinary tasks must not load them by
default.

A report should cover recurring signals, applied improvements, proposal triage,
stale or redundant context, recommended cleanup, and next review priorities.

When bounded, content-safe task evidence is available, a report may also group
observations by stable `acp-rule` ID and show:

- reviewed relevant-task opportunities and material uses;
- loaded-only, relevant-but-missed, and not-applicable observations;
- recurrence after activation and the last content-safe material-use pointer;
- unknown evidence coverage; and
- one of `retain`, `observe`, `narrow_route`, `rewrite_candidate`, or
  `cleanup_candidate`.

These are derived Agent judgments over explicitly available evidence. Do not
store raw tasks, conversations, full traces, source code, secrets, usernames,
customer data, or absolute paths. Do not create a background scan or infer zero
use from unobserved tasks. Low use schedules review; it never deletes context.
