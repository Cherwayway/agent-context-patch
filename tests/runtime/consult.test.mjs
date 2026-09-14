import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkspace, recordConsultation } from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, rule, seed, TODAY } from "./helpers.mjs";

test("recordConsultation bumps counters in rule frontmatter and reports unknown ids", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "p-1", [{ op: "add", rule: rule("used") }, { op: "add", rule: rule("skipped") }]);
    const result = await recordConsultation({ workspaceRoot: root, consulted: ["used", "used"], missed: ["skipped", "ghost"], today: TODAY });
    assert.equal(result.status, "ok");
    assert.deepEqual(result.consulted, ["used"]);
    assert.deepEqual(result.missed, ["skipped"]);
    assert.deepEqual(result.unknown, ["ghost"]);
    assert.equal(result.receipt, "Context use: consulted=used; missed=skipped; unknown=ghost.");

    await recordConsultation({ workspaceRoot: root, consulted: ["used"], today: "2026-09-15" });
    const workspace = await loadWorkspace(root);
    const used = workspace.rules.find((entry) => entry.id === "used");
    const skipped = workspace.rules.find((entry) => entry.id === "skipped");
    assert.deepEqual([used.consulted, used.last_consulted, used.missed], [2, "2026-09-15", 0]);
    assert.deepEqual([skipped.consulted, skipped.last_consulted, skipped.missed], [0, null, 1]);
    assert.equal(used.body, "Body for used.", "rewriting frontmatter keeps the body intact");

    const invalid = await recordConsultation({ workspaceRoot: root, consulted: ["Bad Id"] });
    assert.deepEqual([invalid.status, invalid.reason], ["failed", "invalid_ids"]);
    const empty = await recordConsultation({ workspaceRoot: root, today: TODAY });
    assert.equal(empty.receipt, "Context use: consulted=none.");
  } finally {
    dispose();
  }
});
