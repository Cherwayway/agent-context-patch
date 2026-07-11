import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import * as publicRuntime from "../../skills/evolve/runtime/index.mjs";
import { createCommitKernel } from "../../skills/evolve/runtime/internal.mjs";

const { applyPatchPlan, computePlanHash, sha256Text } = publicRuntime;

test("public runtime exports only the documented commit seam", () => {
  assert.deepEqual(Object.keys(publicRuntime).sort(), [
    "applyPatchPlan",
    "computePlanHash",
    "sha256Text",
  ]);
});

test("auto applies a low-risk create and returns a content-free ApplyAttempt", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t, { enabledDomains: [] });
  const configPath = join(workspaceRoot, ".agent-context", "config.yml");
  await writeFile(configPath, `\uFEFF${await readFile(configPath, "utf8")}`, "utf8");

  const content = "# Project Profile\n";
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-create-profile",
    proposalId: "proposal-create-profile",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content,
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(
    await readFile(join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"), "utf8"),
    content,
  );
  assert.equal(attempt.status, "applied");
  assert.equal(attempt.planId, plan.planId);
  assert.equal(attempt.proposalId, plan.proposalId);
  assert.equal(attempt.planHash, plan.planHash);
  assert.deepEqual(attempt.operations.map(({ target }) => target), [
    ".agent-context/PROJECT_PROFILE.md",
  ]);
  assert.equal(JSON.stringify(attempt).includes(content), false);
  assert.equal(JSON.stringify(attempt).includes(workspaceRoot), false);
});

test("auto fails closed unless v1 workspace config explicitly enables it", async (t) => {
  const variants = [
    { name: "missing" },
    { name: "propose", config: { schemaVersion: 1, policy: "propose" } },
    { name: "invalid", rawConfig: "schema_version: nope\ncontext_write_policy: auto\n" },
    {
      name: "missing-domains",
      rawConfig: "schema_version: 1\ncontext_write_policy: auto\n",
    },
    {
      name: "duplicate-domain",
      rawConfig:
        "schema_version: 1\ncontext_write_policy: auto\nenabled_domains:\n  - coding\n  - coding\n",
    },
    {
      name: "invalid-domain",
      rawConfig:
        "schema_version: 1\ncontext_write_policy: auto\nenabled_domains:\n  - Coding\n",
    },
  ];

  for (const variant of variants) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    if (variant.config) await writeWorkspaceConfig(workspaceRoot, variant.config);
    if (variant.rawConfig) {
      const contextRoot = join(workspaceRoot, ".agent-context");
      await mkdir(contextRoot, { recursive: true });
      await writeFile(join(contextRoot, "config.yml"), variant.rawConfig, "utf8");
    }
    const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
    const plan = withPlanHash({
      schemaVersion: 1,
      planId: `plan-auto-config-${variant.name}`,
      proposalId: `proposal-auto-config-${variant.name}`,
      workspaceRoot,
      policy: "auto",
      risk: "low",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: true },
      operations: [
        {
          type: "create",
          target: ".agent-context/PROJECT_PROFILE.md",
          beforeHash: null,
          content: "must remain proposed\n",
        },
      ],
    });

    const attempt = await applyPatchPlan(plan);
    assert.equal(attempt.status, "conflict");
    assert.equal(attempt.reason, "auto_not_enabled");
    await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
  }
});

test("auto accepts a complete v1 config with quoted policy and inline domains", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeWorkspaceConfig(workspaceRoot, {
    policy: "auto",
    enabledDomains: ["coding", "prd"],
    quotedPolicy: true,
    inlineDomains: true,
  });
  const content = "# Coding checklist\n";
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-auto-quoted-config",
    proposalId: "proposal-auto-quoted-config",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/checklists/coding.md",
        beforeHash: null,
        content,
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "applied");
  assert.equal(
    await readFile(join(workspaceRoot, ".agent-context", "checklists", "coding.md"), "utf8"),
    content,
  );
});

test("auto rejects a checklist whose domain is not enabled", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t, { enabledDomains: ["prd"] });
  const target = join(workspaceRoot, ".agent-context", "checklists", "coding.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-disabled-checklist",
    proposalId: "proposal-disabled-checklist",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/checklists/coding.md",
        beforeHash: null,
        content: "disabled domain checklist\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.reason, "domain_not_enabled");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("requested propose cannot escalate to effective auto", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-policy-escalation",
    proposalId: "proposal-policy-escalation",
    workspaceRoot,
    requestedPolicy: "propose",
    policy: "auto",
    policyReason: "invalid_escalation",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "must not escalate\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "invalid_policy_transition");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("auto cannot execute a semantic rewrite", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-auto-rewrite",
    proposalId: "proposal-auto-rewrite",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    semanticOperation: "rewrite",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "rewrite requires approval\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "auto_operation_forbidden");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("apply requires the complete persisted PatchPlan shape", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const basePlan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-required-shape",
    proposalId: "proposal-required-shape",
    workspaceRoot,
    policy: "propose",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "complete shape\n",
      },
    ],
  });
  const variants = [
    {
      reason: "invalid_requested_policy",
      mutate: (plan) => delete plan.requestedPolicy,
    },
    { reason: "invalid_policy_reason", mutate: (plan) => (plan.policyReason = "") },
    { reason: "invalid_risk", mutate: (plan) => (plan.risk = "medium") },
    {
      reason: "invalid_semantic_operation",
      mutate: (plan) => delete plan.semanticOperation,
    },
    {
      reason: "invalid_context_health",
      mutate: (plan) => (plan.contextHealth = { autoAllowed: "yes" }),
    },
    {
      reason: "invalid_context_delta",
      mutate: (plan) => (plan.contextDelta = { activeLinesBefore: 0, activeLinesAfter: -1 }),
    },
  ];

  for (const variant of variants) {
    const plan = structuredClone(basePlan);
    variant.mutate(plan);
    plan.planHash = computePlanHash(plan);
    const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });
    assert.equal(attempt.status, "failed");
    assert.equal(attempt.reason, variant.reason);
  }
  await assert.rejects(
    readFile(join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"), "utf8"),
    { code: "ENOENT" },
  );
});

test("auto replaces an update only when beforeHash matches", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const before = "old profile\n";
  const after = "new profile\n";
  await mkdir(join(workspaceRoot, ".agent-context"), { recursive: true });
  await writeFile(target, before, "utf8");

  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-update-profile",
    proposalId: "proposal-update-profile",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "update",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: sha256Text(before),
        content: after,
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "applied");
  assert.equal(await readFile(target, "utf8"), after);
  assert.deepEqual(attempt.operations[0], {
    type: "update",
    target: ".agent-context/PROJECT_PROFILE.md",
    beforeHash: sha256Text(before),
    afterHash: sha256Text(after),
  });
});

test("multi-file preflight leaves every target untouched when one beforeHash conflicts", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const contextRoot = join(workspaceRoot, ".agent-context");
  const existingTarget = join(contextRoot, "PROJECT_PROFILE.md");
  const createTarget = join(contextRoot, "PROJECT_CONTEXT_INDEX.md");
  const existing = "current profile\n";
  await mkdir(contextRoot, { recursive: true });
  await writeFile(existingTarget, existing, "utf8");

  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-preflight-conflict",
    proposalId: "proposal-preflight-conflict",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_CONTEXT_INDEX.md",
        beforeHash: null,
        content: "new index\n",
      },
      {
        type: "update",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: sha256Text("stale profile\n"),
        content: "new profile\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.reason, "before_hash_mismatch");
  await assert.rejects(readFile(createTarget, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(existingTarget, "utf8"), existing);
});

test("a symlink inside .agent-context cannot redirect a target outside the workspace", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const outsideRoot = await mkdtemp(join(tmpdir(), "agent-context-outside-"));
  t.after(() => rm(outsideRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  await mkdir(contextRoot, { recursive: true });
  await symlink(
    outsideRoot,
    join(contextRoot, "escaped"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-symlink-escape",
    proposalId: "proposal-symlink-escape",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/escaped/outside.md",
        beforeHash: null,
        content: "must stay inside\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "unsafe_target");
  await assert.rejects(readFile(join(outsideRoot, "outside.md"), "utf8"), { code: "ENOENT" });
});

test("propose policy returns an approval conflict without writing", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-propose-only",
    proposalId: "proposal-propose-only",
    workspaceRoot,
    policy: "propose",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "not approved yet\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.reason, "policy_requires_approval");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("propose policy applies after exact out-of-plan authorization", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeWorkspaceConfig(workspaceRoot, { policy: "propose" });
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const content = "approved profile\n";
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-exact-approval",
    proposalId: "proposal-exact-approval",
    workspaceRoot,
    requestedPolicy: "auto",
    policy: "propose",
    policyReason: "high_risk_requires_approval",
    risk: "high",
    semanticOperation: "rewrite",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content,
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "applied");
  assert.equal(await readFile(target, "utf8"), content);
  assert.equal(JSON.stringify(attempt).includes(content), false);
  assert.equal(JSON.stringify(attempt).includes(workspaceRoot), false);
});

test("exact approval cannot write a non-migration plan in legacy, invalid, or future config", async (t) => {
  const variants = [
    {
      name: "legacy",
      config: "context_write_policy: propose\nenabled_domains: []\n",
      reason: "legacy_workspace_read_only",
    },
    {
      name: "invalid-v1",
      config: "schema_version: 1\ncontext_write_policy: propose\nenabled_domains: []\n",
      reason: "invalid_workspace_config",
    },
    {
      name: "future",
      config: workspaceConfigText({ schemaVersion: 2, policy: "propose" }),
      reason: "future_schema_read_only",
    },
  ];

  for (const variant of variants) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), `agent-context-kernel-${variant.name}-`));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const contextRoot = join(workspaceRoot, ".agent-context");
    await mkdir(contextRoot, { recursive: true });
    await writeFile(join(contextRoot, "config.yml"), variant.config, "utf8");
    const target = join(contextRoot, "PROJECT_PROFILE.md");
    const before = "# Before\n";
    await writeFile(target, before, "utf8");
    const plan = withPlanHash({
      schemaVersion: 1,
      planId: `plan-approved-${variant.name}`,
      proposalId: `proposal-approved-${variant.name}`,
      workspaceRoot,
      policy: "propose",
      risk: "high",
      semanticOperation: "update",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: false },
      operations: [
        {
          type: "update",
          target: ".agent-context/PROJECT_PROFILE.md",
          beforeHash: sha256Text(before),
          content: "# After\n",
        },
      ],
    });

    const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

    assert.equal(attempt.status, "conflict");
    assert.equal(attempt.reason, variant.reason);
    assert.equal(await readFile(target, "utf8"), before);
  }
});

test("an approval hash mismatch writes nothing", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-wrong-approval",
    proposalId: "proposal-wrong-approval",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "not exactly approved\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: "0".repeat(64) });

  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.reason, "approval_hash_mismatch");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("exact approval cannot bypass an unverified current fix", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-unverified-approval",
    proposalId: "proposal-unverified-approval",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    currentFixStatus: "not_started",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "must wait for the current fix\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "current_fix_not_verified");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("exact approval can atomically apply high-risk config and archive changes", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeWorkspaceConfig(workspaceRoot, { policy: "propose" });
  const configTarget = join(workspaceRoot, ".agent-context", "config.yml");
  const oldConfig = await readFile(configTarget, "utf8");
  const contents = [
    workspaceConfigText({ policy: "propose", enabledDomains: ["coding"] }),
    "superseded context\n",
  ];
  const targets = [
    ".agent-context/config.yml",
    ".agent-context/archive/superseded.md",
  ];
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-approved-high-risk",
    proposalId: "proposal-approved-high-risk",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    semanticOperation: "rewrite",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: targets.map((target, index) => ({
      type: index === 0 ? "update" : "create",
      target,
      beforeHash: index === 0 ? sha256Text(oldConfig) : null,
      content: contents[index],
    })),
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "applied");
  for (const [index, target] of targets.entries()) {
    assert.equal(
      await readFile(join(workspaceRoot, ...target.split("/")), "utf8"),
      contents[index],
    );
  }
  assert.deepEqual(attempt.operations.map(({ target }) => target), targets);
  for (const content of contents) assert.equal(JSON.stringify(attempt).includes(content), false);
  assert.equal(JSON.stringify(attempt).includes(workspaceRoot), false);
});

test("archive targets are permanently create-only, even with exact approval", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeWorkspaceConfig(workspaceRoot, { policy: "propose" });
  const archiveTarget = join(workspaceRoot, ".agent-context", "archive", "immutable.md");
  const archiveBeforeText = "immutable archive evidence\r\n";
  const archiveBefore = Buffer.from(archiveBeforeText, "utf8");
  await mkdir(dirname(archiveTarget), { recursive: true });
  await writeFile(archiveTarget, archiveBefore);
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-approved-archive-update",
    proposalId: "proposal-approved-archive-update",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    semanticOperation: "rewrite",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "update",
        target: ".agent-context/archive/immutable.md",
        beforeHash: sha256Text(archiveBeforeText),
        content: "archive rewrite must be rejected\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "archive_create_only");
  assert.deepEqual(await readFile(archiveTarget), archiveBefore);
});

test("exact approval permanently rejects proposal aggregate targets", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = ".agent-context/proposals/history-redaction.md";
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-proposal-target-forbidden",
    proposalId: "proposal-target-forbidden",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    semanticOperation: "rewrite",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target,
        beforeHash: null,
        content: "proposal history must stay outside the kernel\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "target_not_supported");
  await assert.rejects(readFile(join(workspaceRoot, ...target.split("/")), "utf8"), {
    code: "ENOENT",
  });
});

test("every config.yml post-content must be a complete valid v1 envelope", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "config.yml");
  const before = await readFile(target, "utf8");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-invalid-config-content",
    proposalId: "proposal-invalid-config-content",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    semanticOperation: "update",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "update",
        target: ".agent-context/config.yml",
        beforeHash: sha256Text(before),
        content: "schema_version: 1\ncontext_write_policy: propose\nenabled_domains: []\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "invalid_config_content");
  assert.equal(await readFile(target, "utf8"), before);
});

test("exact approval atomically completes a legacy-to-v1 migration", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  const configTarget = join(contextRoot, "config.yml");
  const profileTarget = join(contextRoot, "PROJECT_PROFILE.md");
  const legacyConfig = "context_write_policy: propose\n";
  const legacyProfile = "# Legacy Profile\n";
  const v1Config = workspaceConfigText({
    policy: "propose",
    enabledDomains: ["coding"],
    lastMigratedWithKitVersion: "0.2.0",
  });
  const v1Profile = "# Project Profile\n\nMigrated from legacy_v0.\n";
  const migrationId = "2026-07-11-legacy-v0";
  const backupConfigTarget = `.agent-context/archive/migrations/${migrationId}/config.yml`;
  const backupProfileTarget =
    `.agent-context/archive/migrations/${migrationId}/PROJECT_PROFILE.md`;
  await mkdir(contextRoot, { recursive: true });
  await writeFile(configTarget, legacyConfig, "utf8");
  await writeFile(profileTarget, legacyProfile, "utf8");

  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-legacy-v0-migration",
    proposalId: "proposal-legacy-v0-migration",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    semanticOperation: "migration",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target: backupConfigTarget,
        beforeHash: null,
        content: legacyConfig,
      },
      {
        type: "create",
        target: backupProfileTarget,
        beforeHash: null,
        content: legacyProfile,
      },
      {
        type: "update",
        target: ".agent-context/config.yml",
        beforeHash: sha256Text(legacyConfig),
        content: v1Config,
      },
      {
        type: "update",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: sha256Text(legacyProfile),
        content: v1Profile,
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "applied");
  assert.equal(
    await readFile(join(workspaceRoot, ...backupConfigTarget.split("/")), "utf8"),
    legacyConfig,
  );
  assert.equal(
    await readFile(join(workspaceRoot, ...backupProfileTarget.split("/")), "utf8"),
    legacyProfile,
  );
  assert.equal(await readFile(configTarget, "utf8"), v1Config);
  assert.equal(await readFile(profileTarget, "utf8"), v1Profile);
  assert.deepEqual(
    attempt.operations.map(({ target, beforeHash, afterHash }) => ({
      target,
      beforeHash,
      afterHash,
    })),
    [
      { target: backupConfigTarget, beforeHash: null, afterHash: sha256Text(legacyConfig) },
      { target: backupProfileTarget, beforeHash: null, afterHash: sha256Text(legacyProfile) },
      {
        target: ".agent-context/config.yml",
        beforeHash: sha256Text(legacyConfig),
        afterHash: sha256Text(v1Config),
      },
      {
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: sha256Text(legacyProfile),
        afterHash: sha256Text(v1Profile),
      },
    ],
  );
  assert.equal(JSON.stringify(attempt).includes(v1Profile), false);
  assert.equal(JSON.stringify(attempt).includes(workspaceRoot), false);
});

test("migration fails closed when any updated legacy file lacks an exact byte backup", async (t) => {
  const variants = [
    { name: "missing", includeProfileBackup: false },
    { name: "mismatched", includeProfileBackup: true, profileBackupContent: "wrong bytes\n" },
  ];

  for (const variant of variants) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), `agent-context-migration-${variant.name}-`));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const contextRoot = join(workspaceRoot, ".agent-context");
    const configTarget = join(contextRoot, "config.yml");
    const profileTarget = join(contextRoot, "PROJECT_PROFILE.md");
    const legacyConfig = "context_write_policy: propose\n";
    const legacyProfile = "# Legacy Profile\r\n";
    await mkdir(contextRoot, { recursive: true });
    await writeFile(configTarget, legacyConfig, "utf8");
    await writeFile(profileTarget, legacyProfile, "utf8");
    const plan = makeMigrationPlan({
      workspaceRoot,
      migrationId: `migration-backup-${variant.name}`,
      legacyConfig,
      legacyProfile,
      includeProfileBackup: variant.includeProfileBackup,
      profileBackupContent: variant.profileBackupContent,
    });

    const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

    assert.equal(attempt.status, "failed");
    assert.equal(attempt.reason, "invalid_migration_backup");
    assert.equal(await readFile(configTarget, "utf8"), legacyConfig);
    assert.equal(await readFile(profileTarget, "utf8"), legacyProfile);
  }
});

test("migration cannot rewrite an existing archive as an unbacked shortcut", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-migration-archive-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  const legacyConfig = "context_write_policy: propose\n";
  const legacyProfile = "# Legacy Profile\n";
  const archiveTarget = join(contextRoot, "archive", "legacy-note.md");
  const archiveBefore = "legacy archive evidence\n";
  await mkdir(dirname(archiveTarget), { recursive: true });
  await writeFile(join(contextRoot, "config.yml"), legacyConfig, "utf8");
  await writeFile(join(contextRoot, "PROJECT_PROFILE.md"), legacyProfile, "utf8");
  await writeFile(archiveTarget, archiveBefore, "utf8");
  const base = makeMigrationPlan({
    workspaceRoot,
    migrationId: "migration-archive-immutable",
    legacyConfig,
    legacyProfile,
  });
  const { planHash: _ignoredPlanHash, ...unhashed } = base;
  const plan = withPlanHash({
    ...unhashed,
    operations: [
      ...base.operations,
      {
        type: "update",
        target: ".agent-context/archive/legacy-note.md",
        beforeHash: sha256Text(archiveBefore),
        content: "rewritten without an archive-safe mapping\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "invalid_migration_backup");
  assert.equal(await readFile(archiveTarget, "utf8"), archiveBefore);
});

test("migration accepts only legacy_v0 and rejects malformed, current, or future config", async (t) => {
  const variants = [
    {
      name: "malformed",
      sourceConfig:
        "schema_version: 1\nschema_version: 1\ncontext_write_policy: propose\n",
      reason: "migration_source_not_legacy",
    },
    {
      name: "current",
      sourceConfig: workspaceConfigText({ policy: "propose" }),
      reason: "migration_source_not_legacy",
    },
    {
      name: "future",
      sourceConfig: workspaceConfigText({ schemaVersion: 2, policy: "propose" }),
      reason: "future_schema_read_only",
    },
  ];

  for (const variant of variants) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), `agent-context-migration-${variant.name}-`));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const contextRoot = join(workspaceRoot, ".agent-context");
    const profile = "# Existing Profile\n";
    await mkdir(contextRoot, { recursive: true });
    await writeFile(join(contextRoot, "config.yml"), variant.sourceConfig, "utf8");
    await writeFile(join(contextRoot, "PROJECT_PROFILE.md"), profile, "utf8");
    const plan = makeMigrationPlan({
      workspaceRoot,
      migrationId: `migration-source-${variant.name}`,
      legacyConfig: variant.sourceConfig,
      legacyProfile: profile,
    });

    const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

    assert.equal(attempt.status, "conflict");
    assert.equal(attempt.reason, variant.reason);
    assert.equal(await readFile(join(contextRoot, "config.yml"), "utf8"), variant.sourceConfig);
    assert.equal(await readFile(join(contextRoot, "PROJECT_PROFILE.md"), "utf8"), profile);
  }
});

test("exact approval cannot bypass privacy guards", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const variants = [
    {
      privacy: { safe: true },
      content: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n",
      reason: "privacy_hazard",
    },
    {
      privacy: { safe: false },
      content: "benign content\n",
      reason: "privacy_not_safe",
    },
  ];

  for (const [index, variant] of variants.entries()) {
    const target = `.agent-context/checklists/privacy-${index}.md`;
    const plan = withPlanHash({
      schemaVersion: 1,
      planId: `plan-approved-privacy-${index}`,
      proposalId: `proposal-approved-privacy-${index}`,
      workspaceRoot,
      policy: "propose",
      risk: "high",
      currentFixStatus: "verified",
      privacy: variant.privacy,
      contextHealth: { autoAllowed: false },
      operations: [
        {
          type: "create",
          target,
          beforeHash: null,
          content: variant.content,
        },
      ],
    });

    const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });
    assert.equal(attempt.status, "failed");
    assert.equal(attempt.reason, variant.reason);
    assert.equal(JSON.stringify(attempt).includes(variant.content), false);
    await assert.rejects(readFile(join(workspaceRoot, ...target.split("/")), "utf8"), {
      code: "ENOENT",
    });
  }
});

test("exact approval cannot persist obvious user-home absolute paths", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const homePaths = [
    "Evidence: C:\\Users\\alice\\private\\trace.log\n",
    "Evidence: /home/alice/private/trace.log\n",
    "Evidence: /Users/alice/private/trace.log\n",
  ];

  for (const [index, content] of homePaths.entries()) {
    const target = `.agent-context/checklists/home-path-${index}.md`;
    const plan = withPlanHash({
      schemaVersion: 1,
      planId: `plan-home-path-${index}`,
      proposalId: `proposal-home-path-${index}`,
      workspaceRoot,
      policy: "propose",
      risk: "high",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: false },
      operations: [
        {
          type: "create",
          target,
          beforeHash: null,
          content,
        },
      ],
    });

    const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });
    assert.equal(attempt.status, "failed");
    assert.equal(attempt.reason, "privacy_hazard");
    assert.equal(JSON.stringify(attempt).includes(content), false);
    await assert.rejects(readFile(join(workspaceRoot, ...target.split("/")), "utf8"), {
      code: "ENOENT",
    });
  }
});

test("a later replacement failure rolls back earlier replacements", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const contextRoot = join(workspaceRoot, ".agent-context");
  const updateTarget = join(contextRoot, "PROJECT_PROFILE.md");
  const createTarget = join(contextRoot, "PROJECT_CONTEXT_INDEX.md");
  const checklistTarget = join(contextRoot, "checklists", "coding.md");
  const original = "original profile\n";
  const originalChecklist = "original checklist\n";
  await mkdir(dirname(checklistTarget), { recursive: true });
  await writeFile(updateTarget, original, "utf8");
  await writeFile(checklistTarget, originalChecklist, "utf8");

  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-rollback",
    proposalId: "proposal-rollback",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "update",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: sha256Text(original),
        content: "replacement profile\n",
      },
      {
        type: "create",
        target: ".agent-context/PROJECT_CONTEXT_INDEX.md",
        beforeHash: null,
        content: "replacement index\n",
      },
      {
        type: "update",
        target: ".agent-context/checklists/coding.md",
        beforeHash: sha256Text(originalChecklist),
        content: "replacement checklist\n",
      },
    ],
  });
  const kernel = createCommitKernel({
    replaceFile: async (source, target) => {
      if (target === checklistTarget) {
        const error = new Error("injected replacement failure");
        error.code = "EIO";
        throw error;
      }
      await rename(source, target);
    },
  });

  const attempt = await kernel.applyPatchPlan(plan);

  assert.equal(attempt.status, "rolled_back");
  assert.equal(attempt.reason, "commit_failed");
  assert.equal(await readFile(updateTarget, "utf8"), original);
  await assert.rejects(readFile(createTarget, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(checklistTarget, "utf8"), originalChecklist);
  assert.equal(JSON.stringify(attempt).includes("replacement profile"), false);
  assert.equal(JSON.stringify(attempt).includes(workspaceRoot), false);
});

test("changing a hashed plan returns a conflict without writing", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-hash-conflict",
    proposalId: "proposal-hash-conflict",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "approved content\n",
      },
    ],
  });
  plan.operations[0].content = "changed after approval\n";

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.reason, "plan_hash_mismatch");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("planHash excludes workspaceRoot but binds every semantic plan field", () => {
  const basePlan = {
    schemaVersion: 1,
    planId: "plan-portable-hash",
    proposalId: "proposal-portable-hash",
    workspaceRoot: "C:\\workspace-a",
    requestedPolicy: "propose",
    policy: "propose",
    policyReason: "portable_hash_test",
    risk: "low",
    semanticOperation: "add",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    contextDelta: { activeLinesBefore: 0, activeLinesAfter: 1 },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "portable content\n",
      },
    ],
  };

  const firstHash = computePlanHash(basePlan);
  assert.equal(
    firstHash,
    computePlanHash({ ...basePlan, workspaceRoot: "/different/workspace" }),
  );
  assert.equal(firstHash, computePlanHash({ ...basePlan, planHash: "f".repeat(64) }));
  assert.notEqual(firstHash, computePlanHash({ ...basePlan, risk: "high" }));
  assert.notEqual(
    firstHash,
    computePlanHash({ ...basePlan, semanticOperation: "rewrite" }),
  );
  assert.notEqual(
    firstHash,
    computePlanHash({
      ...basePlan,
      operations: [{ ...basePlan.operations[0], content: "changed content\n" }],
    }),
  );
});

test("the kernel snapshots a plan before asynchronous file work", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const approvedContent = "approved snapshot\n";
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-snapshot",
    proposalId: "proposal-snapshot",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: approvedContent,
      },
    ],
  });

  const attemptPromise = applyPatchPlan(plan);
  plan.operations[0].content = "mutated after invocation\n";
  const attempt = await attemptPromise;

  assert.equal(attempt.status, "applied");
  assert.equal(await readFile(target, "utf8"), approvedContent);
});

test("path traversal cannot leave .agent-context", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const outsideTarget = join(workspaceRoot, "outside.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-path-traversal",
    proposalId: "proposal-path-traversal",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/../outside.md",
        beforeHash: null,
        content: "escaped content\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "unsafe_target");
  await assert.rejects(readFile(outsideTarget, "utf8"), { code: "ENOENT" });
});

test("auto rejects non-low-risk, unverified, privacy-unsafe, or context-unhealthy plans", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const unsafeVariants = [
    { override: { risk: "high" }, reason: "auto_guard_failed" },
    {
      override: { currentFixStatus: "in_progress" },
      reason: "current_fix_not_verified",
    },
    { override: { privacy: { safe: false } }, reason: "privacy_not_safe" },
    {
      override: { contextHealth: { autoAllowed: false } },
      reason: "auto_guard_failed",
    },
  ];

  for (const [index, { override, reason }] of unsafeVariants.entries()) {
    const plan = withPlanHash({
      schemaVersion: 1,
      planId: `plan-auto-guard-${index}`,
      proposalId: `proposal-auto-guard-${index}`,
      workspaceRoot,
      policy: "auto",
      risk: "low",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: true },
      operations: [
        {
          type: "create",
          target: `.agent-context/guard-${index}.md`,
          beforeHash: null,
          content: "must not be written\n",
        },
      ],
      ...override,
    });

    const attempt = await applyPatchPlan(plan);
    assert.equal(attempt.status, "failed");
    assert.equal(attempt.reason, reason);
    await assert.rejects(
      readFile(join(workspaceRoot, ".agent-context", `guard-${index}.md`), "utf8"),
      { code: "ENOENT" },
    );
  }
});

test("every plan requires an explicit context-health declaration", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-missing-context-health",
    proposalId: "proposal-missing-context-health",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "not eligible\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "invalid_context_health");
  await assert.rejects(
    readFile(join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md"), "utf8"),
    { code: "ENOENT" },
  );
});

test("mechanical privacy hazards block auto without echoing content", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const hazards = [
    {
      target: ".agent-context/PROJECT_PROFILE.md",
      content: "-----BEGIN ENCRYPTED PRIVATE KEY-----\nnot-a-real-key\n",
    },
    {
      target: ".agent-context/PROJECT_CONTEXT_INDEX.md",
      content: 'OPENAI_API_KEY = "sk-test-1234567890abcdef"\n',
    },
  ];

  for (const [index, hazard] of hazards.entries()) {
    const plan = withPlanHash({
      schemaVersion: 1,
      planId: `plan-privacy-hazard-${index}`,
      proposalId: `proposal-privacy-hazard-${index}`,
      workspaceRoot,
      policy: "auto",
      risk: "low",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: true },
      operations: [
        {
          type: "create",
          target: hazard.target,
          beforeHash: null,
          content: hazard.content,
        },
      ],
    });

    const attempt = await applyPatchPlan(plan);
    assert.equal(attempt.status, "failed");
    assert.equal(attempt.reason, "privacy_hazard");
    assert.equal(JSON.stringify(attempt).includes(hazard.content), false);
    await assert.rejects(
      readFile(join(workspaceRoot, ...hazard.target.split("/")), "utf8"),
      { code: "ENOENT" },
    );
  }
});

test("auto cannot write approval-only targets and proposals are never kernel targets", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const configPath = join(workspaceRoot, ".agent-context", "config.yml");
  const originalConfig = await readFile(configPath, "utf8");
  const forbiddenTargets = [
    ".agent-context/config.yml",
    ".agent-context/archive/superseded.md",
    ".agent-context/proposals/auto-audit.md",
  ];

  for (const [index, target] of forbiddenTargets.entries()) {
    const plan = withPlanHash({
      schemaVersion: 1,
      planId: `plan-forbidden-target-${index}`,
      proposalId: `proposal-forbidden-target-${index}`,
      workspaceRoot,
      policy: "auto",
      risk: "low",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: true },
      operations: [
        {
          type: "create",
          target,
          beforeHash: null,
          content: "must require human approval\n",
        },
      ],
    });

    const attempt = await applyPatchPlan(plan);
    assert.equal(attempt.status, "failed");
    assert.equal(
      attempt.reason,
      target.startsWith(".agent-context/proposals/")
        ? "target_not_supported"
        : "auto_target_forbidden",
    );
    const absoluteTarget = join(workspaceRoot, ...target.split("/"));
    if (target === ".agent-context/config.yml") {
      assert.equal(await readFile(absoluteTarget, "utf8"), originalConfig);
    } else {
      await assert.rejects(readFile(absoluteTarget, "utf8"), { code: "ENOENT" });
    }
  }
});

test("the kernel never creates a missing workspace root", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "agent-context-kernel-parent-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const workspaceRoot = join(parent, "missing-workspace");
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-missing-workspace",
    proposalId: "proposal-missing-workspace",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "must not create a workspace\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "invalid_workspace_root");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("a workspace commit lock permits only one concurrent plan", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const contextRoot = join(workspaceRoot, ".agent-context");
  const target = join(contextRoot, "PROJECT_PROFILE.md");
  const before = "shared before state\n";
  await mkdir(contextRoot, { recursive: true });
  await writeFile(target, before, "utf8");
  const enteredReplace = deferred();
  const releaseReplace = deferred();
  let firstReplace = true;
  const kernel = createCommitKernel({
    replaceFile: async (source, destination) => {
      if (firstReplace) {
        firstReplace = false;
        enteredReplace.resolve();
        await releaseReplace.promise;
      }
      await rename(source, destination);
    },
  });
  const makePlan = (suffix, content) =>
    withPlanHash({
      schemaVersion: 1,
      planId: `plan-concurrent-${suffix}`,
      proposalId: `proposal-concurrent-${suffix}`,
      workspaceRoot,
      policy: "auto",
      risk: "low",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: true },
      operations: [
        {
          type: "update",
          target: ".agent-context/PROJECT_PROFILE.md",
          beforeHash: sha256Text(before),
          content,
        },
      ],
    });
  const firstPlan = makePlan("first", "first winner\n");
  const secondPlan = makePlan("second", "second winner\n");

  const firstPromise = kernel.applyPatchPlan(firstPlan);
  await enteredReplace.promise;
  const secondAttempt = await kernel.applyPatchPlan(secondPlan);
  releaseReplace.resolve();
  const firstAttempt = await firstPromise;

  assert.equal(firstAttempt.status, "applied");
  assert.equal(secondAttempt.status, "conflict");
  assert.equal(secondAttempt.reason, "commit_locked");
  assert.equal(await readFile(target, "utf8"), "first winner\n");
  for (const attempt of [firstAttempt, secondAttempt]) {
    assert.equal(JSON.stringify(attempt).includes("winner"), false);
    assert.equal(JSON.stringify(attempt).includes(workspaceRoot), false);
  }
  await assert.rejects(readFile(join(contextRoot, ".commit-kernel.lock"), "utf8"), {
    code: "ENOENT",
  });
});

test("auto revalidates workspace config after acquiring the commit lock", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  const kernel = createCommitKernel({
    afterLockAcquired: () =>
      writeWorkspaceConfig(workspaceRoot, {
        schemaVersion: 1,
        policy: "propose",
        enabledDomains: ["coding"],
      }),
  });
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-config-revalidation",
    proposalId: "proposal-config-revalidation",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "must observe locked config\n",
      },
    ],
  });

  const attempt = await kernel.applyPatchPlan(plan);

  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.reason, "auto_not_enabled");
  await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
});

test("a failed commit releases the workspace lock", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const target = join(workspaceRoot, ".agent-context", "PROJECT_PROFILE.md");
  let failNextReplace = true;
  const kernel = createCommitKernel({
    replaceFile: async (source, destination) => {
      if (failNextReplace) {
        failNextReplace = false;
        const error = new Error("injected replacement failure");
        error.code = "EIO";
        throw error;
      }
      await rename(source, destination);
    },
  });
  const makePlan = (suffix, content) =>
    withPlanHash({
      schemaVersion: 1,
      planId: `plan-lock-release-${suffix}`,
      proposalId: `proposal-lock-release-${suffix}`,
      workspaceRoot,
      policy: "auto",
      risk: "low",
      currentFixStatus: "verified",
      privacy: { safe: true },
      contextHealth: { autoAllowed: true },
      operations: [
        {
          type: "create",
          target: ".agent-context/PROJECT_PROFILE.md",
          beforeHash: null,
          content,
        },
      ],
    });

  const failedAttempt = await kernel.applyPatchPlan(makePlan("failed", "first content\n"));
  const appliedAttempt = await kernel.applyPatchPlan(makePlan("retry", "retry content\n"));

  assert.equal(failedAttempt.status, "failed");
  assert.equal(failedAttempt.reason, "filesystem_error");
  assert.equal(appliedAttempt.status, "applied");
  assert.equal(await readFile(target, "utf8"), "retry content\n");
  await assert.rejects(
    readFile(join(workspaceRoot, ".agent-context", ".commit-kernel.lock"), "utf8"),
    { code: "ENOENT" },
  );
});

test("kernel-reserved commit paths remain forbidden after exact approval", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeWorkspaceConfig(workspaceRoot, { policy: "propose" });
  const target = ".agent-context/.commit-user-content";
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-reserved-target",
    proposalId: "proposal-reserved-target",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target,
        beforeHash: null,
        content: "not a kernel artifact\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "kernel_reserved_target");
  await assert.rejects(readFile(join(workspaceRoot, ...target.split("/")), "utf8"), {
    code: "ENOENT",
  });
});

test("exact approval cannot write outside the v1 context topology", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeWorkspaceConfig(workspaceRoot, { policy: "propose" });
  const target = ".agent-context/custom.md";
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-unsupported-target",
    proposalId: "proposal-unsupported-target",
    workspaceRoot,
    policy: "propose",
    risk: "high",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations: [
      {
        type: "create",
        target,
        beforeHash: null,
        content: "unsupported topology\n",
      },
    ],
  });

  const attempt = await applyPatchPlan(plan, { approvedPlanHash: plan.planHash });

  assert.equal(attempt.status, "failed");
  assert.equal(attempt.reason, "target_not_supported");
  await assert.rejects(readFile(join(workspaceRoot, ...target.split("/")), "utf8"), {
    code: "ENOENT",
  });
});

test("lock ownership loss is reported instead of silently released", async (t) => {
  const workspaceRoot = await createAutoWorkspace(t);
  const contextRoot = join(workspaceRoot, ".agent-context");
  const lockPath = join(contextRoot, ".commit-kernel.lock");
  const target = join(contextRoot, "PROJECT_PROFILE.md");
  const kernel = createCommitKernel({
    replaceFile: async (source, destination) => {
      await writeFile(lockPath, JSON.stringify({ token: "different-owner" }), "utf8");
      await rename(source, destination);
    },
  });
  const plan = withPlanHash({
    schemaVersion: 1,
    planId: "plan-lock-ownership-loss",
    proposalId: "proposal-lock-ownership-loss",
    workspaceRoot,
    policy: "auto",
    risk: "low",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "committed before lock release failed\n",
      },
    ],
  });

  const attempt = await kernel.applyPatchPlan(plan);

  assert.equal(attempt.status, "applied");
  assert.equal(attempt.reason, "lock_release_failed");
  assert.equal(attempt.lockRelease, "failed");
  assert.equal(await readFile(target, "utf8"), "committed before lock release failed\n");
  assert.equal(JSON.stringify(attempt).includes(workspaceRoot), false);
  assert.equal(JSON.stringify(attempt).includes("committed before"), false);
  assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "different-owner");
});

async function createAutoWorkspace(t, { enabledDomains = ["coding"] } = {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-kernel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeWorkspaceConfig(workspaceRoot, {
    schemaVersion: 1,
    policy: "auto",
    enabledDomains,
  });
  return workspaceRoot;
}

async function writeWorkspaceConfig(
  workspaceRoot,
  options = {},
) {
  const contextRoot = join(workspaceRoot, ".agent-context");
  await mkdir(contextRoot, { recursive: true });
  await writeFile(join(contextRoot, "config.yml"), workspaceConfigText(options), "utf8");
}

function workspaceConfigText({
  schemaVersion = 1,
  policy = "auto",
  enabledDomains = [],
  quotedPolicy = false,
  inlineDomains = false,
  lastMigratedWithKitVersion = null,
} = {}) {
  const policyValue = quotedPolicy ? JSON.stringify(policy) : policy;
  const domainLines = inlineDomains
    ? [`enabled_domains: [${enabledDomains.map((domain) => JSON.stringify(domain)).join(", ")}]`]
    : enabledDomains.length === 0
      ? ["enabled_domains: []"]
      : ["enabled_domains:", ...enabledDomains.map((domain) => `  - ${domain}`)];
  return [
    `schema_version: ${schemaVersion}`,
    'created_with_kit_version: "0.2.0"',
    `last_migrated_with_kit_version: ${
      lastMigratedWithKitVersion === null ? "null" : JSON.stringify(lastMigratedWithKitVersion)
    }`,
    `context_write_policy: ${policyValue}`,
    ...domainLines,
    "budgets:",
    "  active_context:",
    "    unit: lines",
    "    warn: 500",
    "    block_auto: 800",
    "  single_proposal:",
    "    unit: lines",
    "    warn: 220",
    "  pending_proposals:",
    "    unit: count",
    "    warn: 8",
    "    block_auto: 12",
    "privacy:",
    "  raw_conversation_stored: false",
    "  full_logs_stored: false",
    "  secrets_stored: false",
    "  customer_data_stored: false",
    "  absolute_user_paths_stored: false",
    "",
  ].join("\n");
}

function makeMigrationPlan({
  workspaceRoot,
  migrationId,
  legacyConfig,
  legacyProfile,
  includeProfileBackup = true,
  profileBackupContent = legacyProfile,
}) {
  const prefix = `.agent-context/archive/migrations/${migrationId}`;
  const operations = [
    {
      type: "create",
      target: `${prefix}/config.yml`,
      beforeHash: null,
      content: legacyConfig,
    },
  ];
  if (includeProfileBackup) {
    operations.push({
      type: "create",
      target: `${prefix}/PROJECT_PROFILE.md`,
      beforeHash: null,
      content: profileBackupContent,
    });
  }
  operations.push(
    {
      type: "update",
      target: ".agent-context/config.yml",
      beforeHash: sha256Text(legacyConfig),
      content: workspaceConfigText({
        policy: "propose",
        lastMigratedWithKitVersion: "0.2.0",
      }),
    },
    {
      type: "update",
      target: ".agent-context/PROJECT_PROFILE.md",
      beforeHash: sha256Text(legacyProfile),
      content: "# Migrated Profile\n",
    },
  );
  return withPlanHash({
    schemaVersion: 1,
    planId: `plan-${migrationId}`,
    proposalId: `proposal-${migrationId}`,
    workspaceRoot,
    policy: "propose",
    risk: "high",
    semanticOperation: "migration",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    operations,
  });
}

function withPlanHash(plan) {
  const completePlan = {
    requestedPolicy: plan.policy,
    policyReason: "test_fixture",
    semanticOperation: "add",
    contextDelta: { activeLinesBefore: 0, activeLinesAfter: 0 },
    ...plan,
  };
  return { ...completePlan, planHash: computePlanHash(completePlan) };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
