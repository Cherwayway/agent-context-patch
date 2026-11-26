import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildStatus, buildWeeklyReport, loadWorkspace, recordConsultation } from "../../skills/evolve/runtime/index.mjs";
import { atomicWrite, commitFiles, withMutation } from "../../skills/evolve/runtime/mutation.mjs";
import { createWorkspace, KIT, rule, seed, TODAY } from "./helpers.mjs";

test("health ignores render time, detects stale hooks, and keeps predecessor use separate", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "initial", [{ op: "add", rule: rule("old") }]);
    await recordConsultation({ workspaceRoot: root, consulted: ["old"], today: TODAY });
    await seed(root, "replace", [{ op: "supersede", replaces: ["old"], rule: rule("new") }]);
    let status = await buildStatus({ workspaceRoot: root, today: "2026-10-20", kitVersion: KIT });
    assert.equal(status.health.catalog.fresh, true);
    assert.equal(status.health.lineage[0].previousConsulted, 1);
    assert.equal(status.health.lineage[0].currentConsulted, 0);
    await writeFile(join(root, ".agent-context", "proposals", "replace.input.json"), JSON.stringify({ id: "replace" }));
    status = await buildStatus({ workspaceRoot: root, today: TODAY, kitVersion: KIT });
    assert.deepEqual(status.health.proposals.pendingInputs, [], "match inputs by envelope id, not filename convention");
    const weekly = await buildWeeklyReport({ workspaceRoot: root, today: "2026-10-20" });
    assert.deepEqual(weekly.summary.neverConsulted, []);
    await writeFile(join(root, "AGENTS.md"), (await readFile(join(root, "AGENTS.md"), "utf8")).replace("Hook new", "stale hook"));
    status = await buildStatus({ workspaceRoot: root, today: TODAY, kitVersion: KIT });
    assert.equal(status.health.catalog.fresh, false);
  } finally { dispose(); }
});

test("optional material-use records bind a safe reference to the exact rule text", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "initial", [{ op: "add", rule: rule("one") }]);
    const args = { workspaceRoot: root, consulted: ["one"], today: TODAY, taskRef: "fixture-pr-42", action: "added_verification" };
    assert.equal((await recordConsultation(args)).status, "ok");
    await recordConsultation(args);
    const observations = JSON.parse(await readFile(join(root, ".agent-context", "reports", `material-use-${TODAY}.json`), "utf8"));
    assert.equal(observations.length, 1);
    assert.match(observations[0].ruleHash, /^[a-f0-9]{64}$/u);
    let status = await buildStatus({ workspaceRoot: root, today: TODAY });
    assert.equal(status.health.materialUse.observations, 1);
    assert.equal(status.health.materialUse.rules[0].currentVersion, true);
    assert.equal(status.health.materialUse.opportunityCoverage, "unknown");
    await seed(root, "replace", [{ op: "supersede", replaces: ["one"], rule: rule("two") }]);
    status = await buildStatus({ workspaceRoot: root, today: TODAY });
    assert.equal(status.health.materialUse.rules[0].currentVersion, false, "historical material use is not attributed to new rule text");
    assert.equal((await recordConsultation({ ...args, taskRef: "/Users/private/raw" })).status, "failed");
  } finally { dispose(); }
});

test("health and weekly detect overpacked lineages, graduated rules, and flagged_stale observations", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await writeFile(join(root, "check.mjs"), "// gate\n", "utf8");
    await seed(root, "p-0", [
      { op: "add", rule: rule("r0", { hook: "Initial hook zero" }) },
      { op: "add", rule: rule("grad-me", { hook: "Enforced check to graduate" }) },
    ], { approved: true });
    for (let i = 1; i <= 8; i += 1) {
      const body = i === 8 ? "Packed clause. ".repeat(90).trim() : `Step ${i}`;
      await seed(root, `p-${i}`, [
        { op: "supersede", replaces: [`r${i - 1}`], rule: rule(`r${i}`, { hook: `Hook step ${i}`, body }) },
      ], { approved: true });
    }
    await seed(root, "p-grad", [
      { op: "graduate", id: "grad-me", graduated_to: "check.mjs", reason: "moved to check.mjs" },
    ]);
    await recordConsultation({ workspaceRoot: root, consulted: ["r8"], today: TODAY, taskRef: "audit-1", action: "flagged_stale" });

    const status = await buildStatus({ workspaceRoot: root, today: TODAY, kitVersion: KIT });
    assert.equal(status.health.graduatedRules, 1);
    const r8Lineage = status.health.lineage.find((item) => item.id === "r8");
    assert.equal(r8Lineage.ancestors.length, 8);
    assert.equal(r8Lineage.lineageDepth, 8);
    assert.equal(r8Lineage.overpacked, true);
    assert.deepEqual(status.health.materialUse.flaggedStale, ["r8"]);

    const weekly = await buildWeeklyReport({ workspaceRoot: root, today: TODAY, kitVersion: KIT });
    assert.deepEqual(weekly.summary.overpacked, ["r8"]);
    assert.deepEqual(weekly.summary.flaggedStale, ["r8"]);
    const reportText = await readFile(weekly.reportPath, "utf8");
    assert.match(reportText, /graduated to code\/skills: 1/u);
    assert.match(reportText, /## Overpacked lineages[\s\S]*\[r8\] ancestors=8, depth=8/u);
    assert.match(reportText, /## Flagged stale during tasks\n- \[r8\]/u);
  } finally { dispose(); }
});

test("a failure after earlier writes restores all bytes, including an audit", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    const path = join(root, ".agent-context", "PROFILE.md");
    const before = await readFile(path, "utf8");
    const workspace = await loadWorkspace(root);
    const result = await commitFiles(workspace, [
      { target: ".agent-context/PROFILE.md", after: "changed" },
      { target: ".agent-context/proposals/partial.md", after: "false success" },
      { target: ".agent-context/reports/failure.md", after: {} },
    ]);
    assert.deepEqual([result.status, result.reason, result.rollback.complete], ["failed", "commit_failed", true]);
    assert.equal(await readFile(path, "utf8"), before);
    await assert.rejects(readFile(join(root, ".agent-context", "proposals", "partial.md")), { code: "ENOENT" });
  } finally { dispose(); }
});


test("failed rollback reports the residual paths and keeps the workspace locked", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    let writes = 0;
    const result = await withMutation(root, {}, workspace => commitFiles(workspace, [
      { target: ".agent-context/PROFILE.md", after: "residual change" },
      { target: ".agent-context/reports/fault.md", after: "failure" },
    ], { write: async (path, content) => {
      writes += 1;
      if (writes >= 2) throw new Error("injected write/restore failure");
      await atomicWrite(path, content);
    } }));
    assert.equal(result.reason, "rollback_failed");
    assert.equal(result.rollback.complete, false);
    assert.deepEqual(result.rollback.failed, [".agent-context/PROFILE.md"]);
    assert.equal((await recordConsultation({ workspaceRoot: root })).reason, "workspace_locked");
    assert.equal(await readFile(join(root, ".agent-context", "PROFILE.md"), "utf8"), "residual change");
  } finally { dispose(); }
});
