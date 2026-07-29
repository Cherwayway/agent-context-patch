# Seven-Day Discoverability Experiment

This experiment separates acquisition, installation, activation, and reuse.
It is not a star campaign.

## Primary measures

- **External unique visitors**: repository visitors not attributable to the
  owner or known team members.
- **Valid activations**: an independent user installs the Kit and reaches one
  verified `$evolve init` or real `after-failure` result.
- **Real evolutions**: a verified failure produces a valid, auditable context
  patch in an independent workspace.
- **Reuse evidence**: a later Agent task reads and applies that lesson.

Do not use raw views, downloads, or clones as the success KPI. In particular,
do not use unique clones as a KPI: CI runners, bots, IDEs, and Agent-driven
installs can clone without representing independent people.

## Channel design

Use one distinct landing path per channel so GitHub Popular content can provide
a coarse attribution signal:

| Channel | Audience | Landing path | Asset |
| --- | --- | --- | --- |
| Claude marketplace submission | Claude Code users already browsing extensions | `docs/why-agent-context-patch.md` | Plugin manifest plus Auto Memory comparison |
| One technical community post | Coding-Agent and context-engineering practitioners | `docs/launch/terminal-demo.md` | 60–90 second verified-failure demo |
| Direct design partners | 10–15 developers outside the team | `AGENT_INSTALL.md` | Personal install invitation and feedback issue |

Do not publish the same generic copy everywhere. Each post should answer one
audience-specific question and contain one call to action.

## Schedule

`docs/launch/experiment.json` keeps `startsAt: null` during preparation. Set it
to the first channel's actual UTC publication time only when that channel is
live; the decision window then ends exactly seven days later. Do not backdate
the clock to Day 0 or to asset preparation.

### Day 0 — baseline

1. Save a discovery snapshot with `npm run metrics:discovery`.
2. Confirm existing stars, forks, issues, and known visitors are internal.
3. Validate the marketplace and the complete repository verification seam.
4. Record the full and short demo cuts.

### Day 1 — platform-native discovery

Submit the validated plugin through Anthropic's official plugin submission
form. The plugin is deliberately only a safe-install adapter: the runtime still
comes from a GitHub-enforced immutable Release after checksum and approval.

### Day 2 — technical case study

Publish the failure -> verified repair -> safe context patch -> fresh-task
reuse story. Lead with the observed behavior, not architecture nouns.

### Days 3–5 — design partners

Invite 10–15 independent developers who actively use Claude Code or Codex.
Ask each person to try one real repository and report where they stop. Do not
ask for a star before they obtain value.

### Days 6–7 — follow-up and decision

Answer concrete install questions, take another snapshot, classify every
known activation, and apply the decision table below.

## Decision table

| Seven-day result | Diagnosis | Next move |
| --- | --- | --- |
| `< 30` external unique visitors | Acquisition or channel selection failed. | Change the case study or channel; do not keep polishing README. |
| `>= 30` visitors and `< 3` valid activations | Positioning, trust, or install conversion failed. | Interview visitors and simplify the first-value path. |
| `>= 3` valid activations and no real evolution | Product activation failed. | Improve trigger recognition and the first after-failure experience. |
| `>= 3` real evolutions with later reuse evidence | Initial product signal exists. | Expand directory coverage and repeat the proven channel. |

## Daily log

Copy `docs/launch/evidence.example.json` to a private local working file, use
opaque participant IDs, and update only outcomes a participant or public
integration actually confirmed. Then capture the traffic and evidence together:

```bash
node scripts/capture-discovery-snapshot.mjs \
  --evidence .artifacts/discovery/evidence.json
```

The machine-readable channel paths and decision thresholds live in
`docs/launch/experiment.json`. The snapshot records both the GitHub-adjusted
visitor estimate and the stricter confirmed-external lower bound; it never
pretends GitHub disclosed visitor identities.

For each day, record:

- snapshot timestamp and rolling-window boundaries;
- channel action and exact landing path;
- external visitors and referrers where available;
- independently confirmed installs, activations, evolutions, and reuse;
- the single biggest observed stop reason;
- the next hypothesis, without rewriting historical entries.

GitHub cannot identify individual visitors or cloners. Any classification as
external must come from known team exclusions plus explicit user evidence, not
from an attempt to reverse-engineer GitHub's deduplication.
