import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computePlanHash, sha256Text } from "../../skills/evolve/runtime/index.mjs";
import { reconcileWorkspaceProposalLifecycles } from "../../skills/evolve/runtime/lifecycle.mjs";
import {
  inspectProposalDocument,
  validateProposalDocument,
} from "../../skills/evolve/runtime/proposal.mjs";

const fixtureRoot = join(import.meta.dirname, "..", "verification", "fixtures");

test("reconciliation resumes an exact interrupted auto proposal and completes its audit", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "auto" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-interrupted-auto.md",
  );
  const source = await readFile(
    join(fixtureRoot, "proposals", "valid-auto.md"),
    "utf8",
  );
  let interrupted = source.replace("status: applied", "status: proposed");
  interrupted = replaceSectionContent(interrupted, "Decision Log", "None.");
  interrupted = replaceSectionContent(interrupted, "Apply Attempts", "None.");
  await writeFile(proposalPath, interrupted, "utf8");

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result, {
    status: "settled",
    inspectedCount: 1,
    outcomes: [
      {
        proposalId: "fixture-valid-auto",
        beforeStatus: "proposed",
        afterStatus: "applied",
        action: "resume_exact_auto",
        reason: "applied",
        targets: [".agent-context/PROJECT_PROFILE.md"],
      },
    ],
  });
  assert.equal(
    await readFile(
      join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"),
      "utf8",
    ),
    "# Project Profile\n\nAuto rule.\n",
  );
  const reconciled = await readFile(proposalPath, "utf8");
  assert.deepEqual(validateProposalDocument(reconciled, "reconciled proposal"), []);
  assert.match(reconciled, /^status: applied$/mu);
  assert.match(reconciled, /- decision: policy_auto/u);
  assert.match(reconciled, /- attempt: 1/u);
  assert.match(reconciled, /result: applied/u);
  assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
  assert.equal(JSON.stringify(result).includes("Auto rule"), false);

  assert.deepEqual(
    await reconcileWorkspaceProposalLifecycles({ workspaceRoot }),
    { status: "settled", inspectedCount: 0, outcomes: [] },
  );
});

test("reconciliation preserves exact human approval while every beforeHash still matches", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "propose" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-approved.md",
  );
  const source = await readFile(
    join(fixtureRoot, "proposals", "valid-auto.md"),
    "utf8",
  );
  let approved = source
    .replace("status: applied", "status: approved")
    .replace("- decision: policy_auto", "- decision: approved")
    .replace("decided_by: policy_engine", "decided_by: fixture_user")
    .replace("reason: auto_eligible", "reason: Exact plan approved by the user.");
  approved = replaceSectionContent(approved, "Apply Attempts", "None.");
  await writeFile(proposalPath, approved, "utf8");
  assert.deepEqual(validateProposalDocument(approved, "approved proposal"), []);

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result, {
    status: "settled",
    inspectedCount: 1,
    outcomes: [
      {
        proposalId: "fixture-valid-auto",
        beforeStatus: "approved",
        afterStatus: "applied",
        action: "resume_exact_authorized",
        reason: "applied",
        targets: [".agent-context/PROJECT_PROFILE.md"],
      },
    ],
  });
  const reconciled = await readFile(proposalPath, "utf8");
  assert.deepEqual(validateProposalDocument(reconciled, "reconciled approval"), []);
  assert.equal((reconciled.match(/- decision: approved/gu) ?? []).length, 1);
  assert.match(reconciled, /- attempt: 1/u);
});

test("a stale proposal without audit history is left untouched for semantic regeneration", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "auto" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-stale-proposed.md",
  );
  const interrupted = await interruptedAutoFixture();
  await writeFile(proposalPath, interrupted, "utf8");
  const targetPath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );
  await writeFile(targetPath, "# Project Profile\n\nDifferent live rule.\n", "utf8");

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result.outcomes, [
    {
      proposalId: "fixture-valid-auto",
      beforeStatus: "proposed",
      afterStatus: "proposed",
      action: "regenerate_required",
      reason: "target_state_changed",
      targets: [".agent-context/PROJECT_PROFILE.md"],
    },
  ]);
  assert.equal(result.status, "blocked");
  assert.equal(await readFile(proposalPath, "utf8"), interrupted);
  assert.equal(
    await readFile(targetPath, "utf8"),
    "# Project Profile\n\nDifferent live rule.\n",
  );
});

test("a current approval-only proposal is actionable without blocking unrelated workflows", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "auto" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-approval-waiting.md",
  );
  const before = "# Project Profile\n\nApproval baseline.\n";
  const proposal = await approvalWaitingTightenFixture({ before });
  await writeFile(proposalPath, proposal, "utf8");
  await writeFile(
    join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"),
    before,
    "utf8",
  );

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result, {
    status: "settled",
    inspectedCount: 1,
    outcomes: [
      {
        proposalId: "fixture-approval-waiting",
        beforeStatus: "proposed",
        afterStatus: "proposed",
        action: "approval_required",
        reason: "policy_requires_approval",
        targets: [".agent-context/PROJECT_PROFILE.md"],
      },
    ],
  });
  assert.equal(await readFile(proposalPath, "utf8"), proposal);
});

test("a stale approval-waiting tighten proposal is marked for regeneration before approval", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "auto" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-stale-approval-waiting.md",
  );
  const before = "# Project Profile\n\nApproval baseline.\n";
  const proposal = await approvalWaitingTightenFixture({ before });
  await writeFile(proposalPath, proposal, "utf8");
  await writeFile(
    join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"),
    "# Project Profile\n\nA later unrelated addition.\n",
    "utf8",
  );

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result.outcomes, [
    {
      proposalId: "fixture-approval-waiting",
      beforeStatus: "proposed",
      afterStatus: "proposed",
      action: "regenerate_required",
      reason: "target_state_changed",
      targets: [".agent-context/PROJECT_PROFILE.md"],
    },
  ]);
  assert.equal(result.status, "blocked");
  assert.equal(await readFile(proposalPath, "utf8"), proposal);
});

test("matching afterHash without an applied audit is reported, never inferred", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "auto" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-audit-gap.md",
  );
  const interrupted = await interruptedAutoFixture();
  await writeFile(proposalPath, interrupted, "utf8");
  await writeFile(
    join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"),
    "# Project Profile\n\nAuto rule.\n",
    "utf8",
  );

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result.outcomes, [
    {
      proposalId: "fixture-valid-auto",
      beforeStatus: "proposed",
      afterStatus: "proposed",
      action: "audit_recovery_required",
      reason: "target_matches_after_hash_without_applied_audit",
      targets: [".agent-context/PROJECT_PROFILE.md"],
    },
  ]);
  assert.equal(await readFile(proposalPath, "utf8"), interrupted);
});

test("an audited stale approval becomes superseded only when its named replacement exists", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "propose" });
  const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
  const stalePath = join(proposalsRoot, "2026-07-10-stale-approved.md");
  const replacementPath = join(proposalsRoot, "2026-07-11-replacement.md");
  const stale = await staleApprovedFixture("fixture-valid-auto");
  await writeFile(stalePath, stale, "utf8");
  await writeFile(
    replacementPath,
    await readFile(join(fixtureRoot, "proposals", "valid-auto.md"), "utf8"),
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"),
    "a newer live profile\n",
    "utf8",
  );
  assert.deepEqual(validateProposalDocument(stale, "stale approval"), []);

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result, {
    status: "settled",
    inspectedCount: 1,
    outcomes: [
      {
        proposalId: "fixture-valid-proposal",
        beforeStatus: "approved",
        afterStatus: "superseded",
        action: "settled",
        reason: "superseded_by_replacement",
        targets: [".agent-context/PROJECT_PROFILE.md"],
      },
    ],
  });
  const superseded = await readFile(stalePath, "utf8");
  assert.match(superseded, /^status: superseded$/mu);
  assert.deepEqual(validateProposalDocument(superseded, "superseded approval"), []);
});

test("a stale approval cannot terminate when the named replacement is missing", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "propose" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-10-missing-replacement.md",
  );
  const stale = await staleApprovedFixture("proposal-that-does-not-exist");
  await writeFile(proposalPath, stale, "utf8");
  await writeFile(
    join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"),
    "a newer live profile\n",
    "utf8",
  );

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result.outcomes, [
    {
      proposalId: "fixture-valid-proposal",
      beforeStatus: "approved",
      afterStatus: "approved",
      action: "superseding_proposal_required",
      reason: "replacement_proposal_not_found",
      targets: [".agent-context/PROJECT_PROFILE.md"],
    },
  ]);
  assert.equal(result.status, "blocked");
  assert.equal(await readFile(proposalPath, "utf8"), stale);
});

test("naming a valid replacement prevents a stale approval from reviving after targets revert", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "auto" });
  const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
  const stalePath = join(proposalsRoot, "2026-07-10-reverted-stale.md");
  await writeFile(
    stalePath,
    await staleAutoCreateFixture("fixture-valid-proposal"),
    "utf8",
  );
  await writeFile(
    join(proposalsRoot, "2026-07-11-valid-replacement.md"),
    await readFile(join(fixtureRoot, "proposals", "valid.md"), "utf8"),
    "utf8",
  );
  const targetPath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );

  const result = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(result.outcomes, [
    {
      proposalId: "fixture-valid-auto",
      beforeStatus: "approved",
      afterStatus: "superseded",
      action: "settled",
      reason: "superseded_by_replacement",
      targets: [".agent-context/PROJECT_PROFILE.md"],
    },
  ]);
  await assert.rejects(readFile(targetPath, "utf8"), { code: "ENOENT" });
  assert.match(await readFile(stalePath, "utf8"), /^status: superseded$/mu);
});

test("an existing lifecycle lock blocks reconciliation and is never aged out", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "auto" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-locked.md",
  );
  const interrupted = await interruptedAutoFixture();
  await writeFile(proposalPath, interrupted, "utf8");
  const lockPath = join(
    workspaceRoot,
    ".agent-context",
    ".lifecycle-coordinator.lock",
  );
  const lock = JSON.stringify({
    schemaVersion: 1,
    token: "existing-owner",
    pid: 1,
    createdAt: "2000-01-01T00:00:00Z",
  });
  await writeFile(lockPath, lock, "utf8");

  assert.deepEqual(
    await reconcileWorkspaceProposalLifecycles({ workspaceRoot }),
    {
      status: "blocked",
      inspectedCount: 0,
      outcomes: [],
      blockingReason: "lifecycle_locked",
    },
  );
  assert.equal(await readFile(lockPath, "utf8"), lock);
  assert.equal(await readFile(proposalPath, "utf8"), interrupted);
});

test("a blocked auto attempt is audited and the exact decision can resume later", async (t) => {
  const workspaceRoot = await createWorkspace(t, { policy: "propose" });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    "2026-07-11-auto-retry.md",
  );
  await writeFile(proposalPath, await interruptedAutoFixture(), "utf8");

  const blocked = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(blocked.outcomes, [
    {
      proposalId: "fixture-valid-auto",
      beforeStatus: "proposed",
      afterStatus: "approved",
      action: "resume_exact_auto",
      reason: "auto_not_enabled",
      targets: [".agent-context/PROJECT_PROFILE.md"],
    },
  ]);
  let proposal = await readFile(proposalPath, "utf8");
  assert.deepEqual(validateProposalDocument(proposal, "blocked auto proposal"), []);
  assert.match(proposal, /- attempt: 1/u);
  assert.match(proposal, /result: conflict/u);
  assert.match(proposal, /error_summary: auto_not_enabled/u);

  const configPath = join(workspaceRoot, ".agent-context", "config.yml");
  const config = await readFile(configPath, "utf8");
  await writeFile(
    configPath,
    config.replace(
      'context_write_policy: "propose"',
      'context_write_policy: "auto"',
    ),
    "utf8",
  );
  const resumed = await reconcileWorkspaceProposalLifecycles({ workspaceRoot });

  assert.deepEqual(resumed.outcomes, [
    {
      proposalId: "fixture-valid-auto",
      beforeStatus: "approved",
      afterStatus: "applied",
      action: "resume_exact_auto",
      reason: "applied",
      targets: [".agent-context/PROJECT_PROFILE.md"],
    },
  ]);
  proposal = await readFile(proposalPath, "utf8");
  assert.deepEqual(validateProposalDocument(proposal, "resumed auto proposal"), []);
  assert.match(proposal, /- attempt: 2/u);
  assert.equal((proposal.match(/- decision: policy_auto/gu) ?? []).length, 1);
});

async function createWorkspace(t, { policy }) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-lifecycle-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  await mkdir(join(contextRoot, "proposals"), { recursive: true });
  const config = await readFile(
    join(fixtureRoot, "config", "valid-auto-inline.yml"),
    "utf8",
  );
  await writeFile(
    join(contextRoot, "config.yml"),
    config.replace('context_write_policy: "auto"', `context_write_policy: "${policy}"`),
    "utf8",
  );
  return workspaceRoot;
}

function replaceSectionContent(source, heading, content) {
  const headingMarker = `## ${heading}`;
  const start = source.indexOf(headingMarker);
  assert.notEqual(start, -1, `fixture is missing ${headingMarker}`);
  const next = source.indexOf("\n## ", start + headingMarker.length);
  const end = next === -1 ? source.length : next;
  return `${source.slice(0, start + headingMarker.length)}\n\n${content}\n${source.slice(end)}`;
}

async function interruptedAutoFixture() {
  const source = await readFile(
    join(fixtureRoot, "proposals", "valid-auto.md"),
    "utf8",
  );
  let interrupted = source.replace("status: applied", "status: proposed");
  interrupted = replaceSectionContent(interrupted, "Decision Log", "None.");
  return replaceSectionContent(interrupted, "Apply Attempts", "None.");
}

async function staleApprovedFixture(replacementId) {
  const applied = await readFile(
    join(fixtureRoot, "proposals", "valid.md"),
    "utf8",
  );
  let stale = applied
    .replace("status: applied", "status: approved")
    .replace("result: applied", "result: conflict")
    .replace("  applied_at: 2026-07-10T00:00:01Z\r\n", "")
    .replace("  applied_at: 2026-07-10T00:00:01Z\n", "")
    .replace("error_summary: null", "error_summary: before_hash_mismatch");
  stale = replaceSectionContent(stale, "Supersession", replacementId);
  return stale;
}

async function staleAutoCreateFixture(replacementId) {
  const applied = await readFile(
    join(fixtureRoot, "proposals", "valid-auto.md"),
    "utf8",
  );
  let stale = applied
    .replace("status: applied", "status: approved")
    .replace("result: applied", "result: conflict")
    .replace("  applied_at: 2026-07-11T00:00:01Z\r\n", "")
    .replace("  applied_at: 2026-07-11T00:00:01Z\n", "")
    .replace("error_summary: null", "error_summary: target_exists");
  stale = replaceSectionContent(stale, "Supersession", replacementId);
  return stale;
}

async function approvalWaitingTightenFixture({ before }) {
  const source = await interruptedAutoFixture();
  const inspected = inspectProposalDocument(source, "approval fixture base");
  assert.deepEqual(inspected.failures, []);
  const plan = structuredClone(inspected.value.plan);
  plan.planId = "plan-fixture-approval-waiting";
  plan.proposalId = "fixture-approval-waiting";
  plan.semanticOperation = "tighten";
  plan.requestedPolicy = "auto";
  plan.policy = "propose";
  plan.policyReason = "semantic_overlap_requires_approval";
  plan.risk = "high";
  plan.contextHealth.autoAllowed = false;
  plan.operations = [
    {
      type: "update",
      target: ".agent-context/PROJECT_PROFILE.md",
      beforeHash: sha256Text(before),
      content: "# Project Profile\n\nTightened approved rule.\n",
    },
  ];
  const planHash = computePlanHash(plan);
  return replacePatchPlan(
    source
      .replace("id: fixture-valid-auto", "id: fixture-approval-waiting")
      .replace("operation: add", "operation: tighten")
      .replace(/^plan_hash:[^\r\n]*$/mu, `plan_hash: ${planHash}`),
    plan,
  );
}

function replacePatchPlan(source, plan) {
  const opening = source.indexOf("~~~~json");
  assert.notEqual(opening, -1);
  const jsonStart = source.indexOf("\n", opening) + 1;
  const closing = source.indexOf("\n~~~~", jsonStart);
  assert.notEqual(closing, -1);
  return `${source.slice(0, jsonStart)}${JSON.stringify(plan, null, 2)}${source.slice(closing)}`;
}
