# Context Health Thresholds

Context size is a scheduling signal, not a measure of value. Never truncate,
delete, or reject evidence only to satisfy a number.

## What counts

Active-context thresholds count:

- PROJECT_CONTEXT_INDEX.md
- PROJECT_PROFILE.md
- checklists materialized for enabled domains
- approved workspace-specific active checklists

They do not count proposals, reports, migration backups, rejected history, or
archive because ordinary tasks do not load those files.

Storage health may report those inactive areas separately.

## Config shape

~~~yaml
budgets:
  active_context:
    unit: lines
    warn: 500
    block_auto: 800
  single_proposal:
    unit: lines
    warn: 220
  pending_proposals:
    unit: count
    warn: 8
    block_auto: 12
~~~

- warn: schedule a context-health review and show the measured impact.
- block_auto: change effective policy to propose.
- A human may approve a justified patch after seeing its context impact.
- No threshold permits automatic content loss.

When a new proposal crosses a threshold, preserve it, report the condition, and
prioritize cleanup or triage. The next proposal may be more important than the
previous ones.

## Context health output

Report:

- measured active files and largest contributors
- current and post-patch values
- duplicate, overlap, conflict, and staleness candidates
- cleanup proposals ordered by authority, consequence, and retention value
- the reason if auto was blocked

Use cleanup-policy.md for semantic cleanup. The agent measures thresholds and
sets contextHealth.autoAllowed; the kernel enforces that supplied gate. The
agent proposes what should change.
