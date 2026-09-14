import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildWeeklyReport, recordConsultation } from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, rule, seed } from "./helpers.mjs";

test("buildWeeklyReport ranks use, flags stale and similar rules, and lists expiring state", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "p-1", [
      { op: "add", rule: rule("hot", { hook: "Run the migration gate before every deploy" }) },
      { op: "add", rule: rule("cold", { hook: "Ask for the report id when opening a pull request" }) },
      { op: "add", rule: rule("twin", { hook: "Run the migration gate before each deploy window" }) },
      { op: "state_set", entry: { id: "soon", text: "review closes", expires: "2026-10-16" } },
    ], { today: "2026-08-01", approved: true });
    await recordConsultation({ workspaceRoot: root, consulted: ["hot"], missed: ["cold"], today: "2026-08-02" });
    const result = await buildWeeklyReport({ workspaceRoot: root, today: "2026-10-14", memoryCandidates: [{ file: "x.md", type: "feedback", description: "a lesson" }] });
    assert.equal(result.status, "ok");
    const { summary } = result;
    assert.deepEqual(summary.neverConsulted, ["cold", "twin"]);
    assert.deepEqual(summary.missed, ["cold"]);
    assert.deepEqual(summary.expiringSoon, ["soon"]);
    assert.deepEqual(summary.similarPairs.map((pair) => [pair.left, pair.right]), [["hot", "twin"]]);
    assert.ok(summary.actions.some((action) => action.includes("similar pair")));
    assert.ok(summary.actions.some((action) => action.includes("memory file")));
    const report = readFileSync(result.reportPath, "utf8");
    assert.match(report, /^# Weekly context review 2026-10-14/u);
    assert.match(report, /## Most consulted\n- \[hot\] 1× last 2026-08-02/u);
    assert.match(report, /## Not consulted for 30\+ days\n- \[hot\] last 2026-08-02/u);
    assert.match(report, /- x\.md \(feedback\): a lesson/u);
    assert.ok(result.reportPath.endsWith("/reports/weekly-2026-10-14.md") || result.reportPath.endsWith("\\reports\\weekly-2026-10-14.md"));
  } finally {
    dispose();
  }
});
