# ADR-0002: Immutable releases and explicit, reversible upgrades

- Status: accepted
- Date: 2026-07-11

Stable installs and upgrades use a GitHub-enforced immutable, versioned Release
rather than a moving development branch. An upgrade must present an exact Upgrade Plan,
preserve a recoverable copy of the installed kit, require explicit approval,
verify the replacement, and restore the prior version on failure. Kit upgrades
and Workspace Schema migrations are separate approvals. During the early
product stage, version discovery is user-initiated or provided by GitHub Release
notifications; the project deliberately has no daemon, background polling,
silent upgrade, behavioral telemetry, or automatic workspace migration. This
keeps the trusted update surface small while leaving a clear seam for future
distribution adapters when real usage justifies them.
