import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computePlanHash, sha256Text } from "../../skills/evolve/runtime/index.mjs";
import { inspectPatchPlanTargets } from "../../skills/evolve/runtime/internal.mjs";

test("target inspection classifies a mixed multi-file state without returning content", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-target-state-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  await mkdir(contextRoot, { recursive: true });
  const profileBefore = "profile before\n";
  const profileAfter = "profile after\n";
  const indexBefore = "index before\n";
  const indexAfter = "index after\n";
  await writeFile(join(contextRoot, "PROJECT_PROFILE.md"), profileBefore, "utf8");
  await writeFile(join(contextRoot, "PROJECT_CONTEXT_INDEX.md"), indexAfter, "utf8");
  const plan = withPlanHash({
    workspaceRoot,
    operations: [
      {
        type: "update",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: sha256Text(profileBefore),
        content: profileAfter,
      },
      {
        type: "update",
        target: ".agent-context/PROJECT_CONTEXT_INDEX.md",
        beforeHash: sha256Text(indexBefore),
        content: indexAfter,
      },
    ],
  });

  const inspection = await inspectPatchPlanTargets(plan);

  assert.equal(inspection.status, "ready");
  assert.equal(inspection.relation, "mixed");
  assert.deepEqual(
    inspection.operations.map(({ target, state }) => ({ target, state })),
    [
      { target: ".agent-context/PROJECT_PROFILE.md", state: "before" },
      { target: ".agent-context/PROJECT_CONTEXT_INDEX.md", state: "after" },
    ],
  );
  assert.equal(JSON.stringify(inspection).includes(profileBefore), false);
  assert.equal(JSON.stringify(inspection).includes(profileAfter), false);
  assert.equal(JSON.stringify(inspection).includes(workspaceRoot), false);
});

function withPlanHash({ workspaceRoot, operations }) {
  const plan = {
    schemaVersion: 1,
    planId: "plan-target-state",
    proposalId: "proposal-target-state",
    workspaceRoot,
    requestedPolicy: "propose",
    policy: "propose",
    policyReason: "test_fixture",
    semanticOperation: "update",
    risk: "high",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: false },
    contextDelta: { activeLinesBefore: 2, activeLinesAfter: 2 },
    operations,
  };
  return { ...plan, planHash: computePlanHash(plan) };
}
