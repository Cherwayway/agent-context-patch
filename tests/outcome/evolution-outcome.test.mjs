import assert from "node:assert/strict";
import test from "node:test";

import { finalizeEvolutionOutcome } from "../../skills/evolve/runtime/outcome.mjs";

test("a high-signal trigger with no durable lesson reports a compact no-candidate outcome", () => {
  const result = finalizeEvolutionOutcome({
    detect: { status: "no_candidate", reason: "no_durable_lesson" },
    propose: { status: "not_needed", reason: "no_candidate" },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    detect: { status: "no_candidate", reason: "no_durable_lesson" },
    propose: { status: "not_needed", reason: "no_candidate" },
    apply: { status: "not_attempted", reason: "no_proposal" },
    receipt: {
      kind: "no_candidate",
      text: "Evolution outcome: detect=no_candidate(no_durable_lesson); propose=not_needed(no_candidate); apply=not_attempted(no_proposal).",
    },
  });
});

test("an applied outcome requires the exact proposal lifecycle audit", () => {
  const proposalId = "2026-07-19-verification-recovery";
  const target = ".agent-context/PROJECT_PROFILE.md";

  const result = finalizeEvolutionOutcome({
    detect: {
      status: "candidate",
      reason: "failed_verification_later_passed",
    },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [target],
        },
      ],
    },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    detect: {
      status: "candidate",
      reason: "failed_verification_later_passed",
    },
    propose: { status: "created", reason: "proposal_created" },
    apply: { status: "applied", reason: "applied" },
    proposalId,
    targets: [target],
    receipt: {
      kind: "applied",
      text: `Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=${proposalId}; targets=${target}.`,
    },
  });
});

test("an approval-only proposal is reported as a concise nonblocking exception", () => {
  const proposalId = "2026-07-19-semantic-tighten";
  const target = ".agent-context/PROJECT_PROFILE.md";

  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "explicit_user_correction" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "proposed",
          action: "approval_required",
          reason: "policy_requires_approval",
          targets: [target],
        },
      ],
    },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    detect: { status: "candidate", reason: "explicit_user_correction" },
    propose: { status: "created", reason: "proposal_created" },
    apply: {
      status: "approval_required",
      reason: "policy_requires_approval",
    },
    proposalId,
    targets: [target],
    receipt: {
      kind: "approval_required",
      text: `Evolution outcome: detect=candidate; propose=created; apply=approval_required(policy_requires_approval); proposal=${proposalId}; targets=${target}.`,
    },
  });
});

test("a lifecycle blocker reports one machine reason and a safe next action", () => {
  const proposalId = "2026-07-19-stale-context";
  const target = ".agent-context/PROJECT_CONTEXT_INDEX.md";

  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "blocked",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "proposed",
          action: "regenerate_required",
          reason: "target_state_changed",
          targets: [target],
        },
      ],
    },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    apply: { status: "blocked", reason: "target_state_changed" },
    proposalId,
    targets: [target],
    receipt: {
      kind: "blocked",
      text: `Evolution outcome: detect=candidate; propose=created; apply=blocked(target_state_changed); proposal=${proposalId}; targets=${target}; next=regenerate_proposal.`,
    },
  });
});

for (const detect of [
  { status: "skipped", reason: "unsafe_to_evaluate" },
  { status: "candidate", reason: "independent_qa_defect" },
]) {
  test(`${detect.status} detection can stop before proposal creation`, () => {
    const result = finalizeEvolutionOutcome({
      detect,
      propose: { status: "blocked", reason: "unsafe_semantic_change" },
    });

    assert.deepEqual(result, {
      schemaVersion: 1,
      detect,
      propose: { status: "blocked", reason: "unsafe_semantic_change" },
      apply: { status: "not_attempted", reason: "proposal_blocked" },
      receipt: {
        kind: "blocked",
        text: `Evolution outcome: detect=${detect.status}${detect.status === "skipped" ? "(unsafe_to_evaluate)" : ""}; propose=blocked(unsafe_semantic_change); apply=not_attempted(proposal_blocked).`,
      },
    });
  });
}

test("an existing proposal can reconcile without pretending to create it again", () => {
  const proposalId = "2026-07-19-existing-proposal";
  const target = ".agent-context/checklists/release.md";

  const result = finalizeEvolutionOutcome({
    detect: { status: "skipped", reason: "existing_proposal" },
    propose: { status: "not_needed", reason: "existing_proposal" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "approved",
          afterStatus: "applied",
          action: "resume_exact_authorized",
          reason: "applied",
          targets: [target],
        },
      ],
    },
  });

  assert.equal(result.detect.status, "skipped");
  assert.equal(result.propose.status, "not_needed");
  assert.deepEqual(result.apply, { status: "applied", reason: "applied" });
  assert.equal(result.proposalId, proposalId);
  assert.deepEqual(result.targets, [target]);
  assert.equal(result.receipt.kind, "applied");
});

test("impossible detect and propose combinations fail closed", () => {
  assert.throws(
    () =>
      finalizeEvolutionOutcome({
        detect: { status: "no_candidate", reason: "no_durable_lesson" },
        propose: { status: "created", reason: "proposal_created" },
      }),
    { name: "TypeError", message: "invalid_evolution_outcome" },
  );

  assert.throws(
    () =>
      finalizeEvolutionOutcome({
        detect: { status: "candidate", reason: "stale_context" },
        propose: { status: "created", reason: "proposal_created" },
      }),
    { name: "TypeError", message: "invalid_evolution_outcome" },
  );
});

test("inconsistent applied claims are downgraded instead of reported as success", () => {
  const proposalId = "2026-07-19-unverified-apply";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "first_fix_failed" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "proposed",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [".agent-context/PROJECT_PROFILE.md"],
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "invalid_lifecycle_evidence",
  });
  assert.equal(result.receipt.kind, "blocked");
});

test("a blocked workspace reconciliation cannot hide behind one applied proposal", () => {
  const proposalId = "2026-07-19-partial-workspace";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "blocked",
      inspectedCount: 2,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [".agent-context/PROJECT_PROFILE.md"],
        },
        {
          proposalId: "another-proposal",
          beforeStatus: "proposed",
          afterStatus: "proposed",
          action: "regenerate_required",
          reason: "target_state_changed",
          targets: [".agent-context/PROJECT_CONTEXT_INDEX.md"],
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "workspace_reconciliation_blocked",
  });
  assert.match(result.receipt.text, /retry_reconciliation/u);
});

test("a falsely settled reconciliation cannot hide a blocked sibling outcome", () => {
  const proposalId = "2026-07-19-false-settled-workspace";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 2,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [".agent-context/PROJECT_PROFILE.md"],
        },
        {
          proposalId: "another-proposal",
          beforeStatus: "proposed",
          afterStatus: "proposed",
          action: "regenerate_required",
          reason: "target_state_changed",
          targets: [".agent-context/PROJECT_CONTEXT_INDEX.md"],
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "invalid_lifecycle_evidence",
  });
  assert.equal(result.receipt.kind, "blocked");
});

test("settled reconciliation requires complete consistent sibling outcomes", () => {
  const proposalId = "2026-07-19-complete-sibling-evidence";
  const appliedOutcome = {
    proposalId,
    beforeStatus: "proposed",
    afterStatus: "applied",
    action: "resume_exact_auto",
    reason: "applied",
    targets: [".agent-context/PROJECT_PROFILE.md"],
  };
  const invalidSiblings = [
    {
      proposalId: "incomplete-sibling",
      afterStatus: "applied",
    },
    {
      proposalId: "contradictory-sibling",
      beforeStatus: "proposed",
      afterStatus: "proposed",
      action: "settled",
      reason: "target_state_changed",
      targets: [],
    },
    {
      proposalId: "secret_abcdefghijklmnop",
      beforeStatus: "pending_current_fix",
      afterStatus: "pending_current_fix",
      action: "settled",
      reason: "current_fix_pending",
      targets: [],
    },
  ];

  for (const sibling of invalidSiblings) {
    const result = finalizeEvolutionOutcome({
      detect: { status: "candidate", reason: "stale_context" },
      propose: { status: "created", reason: "proposal_created" },
      proposalId,
      reconciliation: {
        status: "settled",
        inspectedCount: 2,
        outcomes: [appliedOutcome, sibling],
      },
    });

    assert.deepEqual(result.apply, {
      status: "blocked",
      reason: "invalid_lifecycle_evidence",
    });
    assert.equal(result.receipt.kind, "blocked");
  }
});

test("unsafe lifecycle detail is stripped from the observable outcome", () => {
  const proposalId = "2026-07-19-private-path";
  const privatePath = "C:\\Users\\someone\\secret.txt";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      diagnostics: "private proposal prose",
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [privatePath],
          lesson: "private lesson prose",
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "unsafe_lifecycle_targets",
  });
  assert.equal(JSON.stringify(result).includes(privatePath), false);
  assert.equal(JSON.stringify(result).includes("private"), true);
  assert.equal(JSON.stringify(result).includes("private proposal prose"), false);
  assert.equal(JSON.stringify(result).includes("private lesson prose"), false);
  assert.equal("targets" in result, false);
});

test("observable targets are normalized and lifecycle prose is ignored", () => {
  const proposalId = "2026-07-19-safe-output";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "independent_qa_defect" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [
            ".agent-context/checklists/z-last.md",
            ".agent-context/PROJECT_PROFILE.md",
          ],
          lesson: "do not expose this lesson",
        },
      ],
    },
  });

  assert.deepEqual(result.targets, [
    ".agent-context/PROJECT_PROFILE.md",
    ".agent-context/checklists/z-last.md",
  ]);
  assert.equal(JSON.stringify(result).includes("do not expose"), false);
});

test("applied requires at least one audited workspace target", () => {
  const proposalId = "2026-07-19-empty-apply";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [],
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "unverified_applied_state",
  });
});

test("approval-required outcomes may omit workspace targets", () => {
  const proposalId = "2026-07-19-user-global";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "explicit_user_correction" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "proposed",
          action: "approval_required",
          reason: "user_global_adapter_required",
          targets: [],
        },
      ],
    },
  });

  assert.equal(result.apply.status, "approval_required");
  assert.equal("targets" in result, false);
});

test("missing and ambiguous lifecycle evidence are stable blockers", () => {
  const base = {
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId: "2026-07-19-missing-evidence",
  };

  assert.equal(
    finalizeEvolutionOutcome(base).apply.reason,
    "lifecycle_evidence_missing",
  );

  const duplicate = {
    proposalId: base.proposalId,
    beforeStatus: "proposed",
    afterStatus: "proposed",
    action: "regenerate_required",
    reason: "target_state_changed",
    targets: [".agent-context/PROJECT_PROFILE.md"],
  };
  assert.equal(
    finalizeEvolutionOutcome({
      ...base,
      reconciliation: {
        status: "blocked",
        inspectedCount: 2,
        outcomes: [duplicate, { ...duplicate }],
      },
    }).apply.reason,
    "ambiguous_proposal_outcome",
  );
});

test("stage reasons must remain machine-readable", () => {
  assert.throws(
    () =>
      finalizeEvolutionOutcome({
        detect: {
          status: "no_candidate",
          reason: "No lesson because token=secret",
        },
        propose: { status: "not_needed", reason: "no_candidate" },
      }),
    { name: "TypeError", message: "invalid_evolution_outcome" },
  );
});

test("an applied receipt rejects a terminal-to-terminal pseudo transition", () => {
  const proposalId = "2026-07-19-terminal-pseudo-transition";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "applied",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [".agent-context/PROJECT_PROFILE.md"],
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "invalid_lifecycle_evidence",
  });
});

test("malformed coordinator accounting cannot authorize an applied receipt", () => {
  const proposalId = "2026-07-19-malformed-accounting";
  for (const inspectedCount of [0, 2]) {
    const result = finalizeEvolutionOutcome({
      detect: { status: "candidate", reason: "stale_context" },
      propose: { status: "created", reason: "proposal_created" },
      proposalId,
      reconciliation: {
        status: "settled",
        inspectedCount,
        outcomes: [
          {
            proposalId,
            beforeStatus: "proposed",
            afterStatus: "applied",
            action: "resume_exact_auto",
            reason: "applied",
            targets: [".agent-context/PROJECT_PROFILE.md"],
          },
        ],
      },
    });

    assert.deepEqual(result.apply, {
      status: "blocked",
      reason: "invalid_lifecycle_evidence",
    });
  }
});

test("workspace-relative targets cannot inject receipt fields", () => {
  const proposalId = "2026-07-19-receipt-injection";
  const injectedTarget = ".agent-context/checklists/x.md;apply=applied";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [injectedTarget],
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "unsafe_lifecycle_targets",
  });
  assert.equal(JSON.stringify(result).includes(injectedTarget), false);
});

test("workspace-relative targets cannot carry obvious secrets", () => {
  const proposalId = "2026-07-19-secret-target";
  const secret = "sk_live_1234567890abcdef";
  const secretTarget = `.agent-context/checklists/${secret}.md`;
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "settled",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "applied",
          action: "resume_exact_auto",
          reason: "applied",
          targets: [secretTarget],
        },
      ],
    },
  });

  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "unsafe_lifecycle_targets",
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("machine-shaped reasons and identifiers cannot carry obvious secrets", () => {
  const secret = "sk_live_1234567890abcdef";

  assert.throws(
    () =>
      finalizeEvolutionOutcome({
        detect: { status: "no_candidate", reason: `secret_${secret}` },
        propose: { status: "not_needed", reason: "no_candidate" },
      }),
    { name: "TypeError", message: "invalid_evolution_outcome" },
  );

  assert.throws(
    () =>
      finalizeEvolutionOutcome({
        detect: { status: "candidate", reason: "stale_context" },
        propose: { status: "created", reason: "proposal_created" },
        proposalId: `proposal_${secret}`,
      }),
    { name: "TypeError", message: "invalid_evolution_outcome" },
  );

  const proposalId = "2026-07-19-safe-proposal";
  const result = finalizeEvolutionOutcome({
    detect: { status: "candidate", reason: "stale_context" },
    propose: { status: "created", reason: "proposal_created" },
    proposalId,
    reconciliation: {
      status: "blocked",
      inspectedCount: 1,
      outcomes: [
        {
          proposalId,
          beforeStatus: "proposed",
          afterStatus: "proposed",
          action: "manual_recovery_required",
          reason: `token_${secret}`,
          targets: [".agent-context/PROJECT_PROFILE.md"],
        },
      ],
    },
  });

  assert.equal(result.apply.reason, "invalid_lifecycle_evidence");
  assert.equal(JSON.stringify(result).includes(secret), false);

  for (const alphabeticSecret of [
    "secret_abcdefghijklmnop",
    "api_key_abcdefghijkl",
    "password_correcthorsebattery",
  ]) {
    assert.throws(
      () =>
        finalizeEvolutionOutcome({
          detect: { status: "no_candidate", reason: alphabeticSecret },
          propose: { status: "not_needed", reason: "no_candidate" },
        }),
      { name: "TypeError", message: "invalid_evolution_outcome" },
    );

    assert.throws(
      () =>
        finalizeEvolutionOutcome({
          detect: { status: "candidate", reason: "stale_context" },
          propose: { status: "created", reason: "proposal_created" },
          proposalId: `proposal_${alphabeticSecret}`,
        }),
      { name: "TypeError", message: "invalid_evolution_outcome" },
    );
  }
});
