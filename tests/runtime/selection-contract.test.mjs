import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkspace, renderCatalog, selectRules } from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, rule, seed, TODAY } from "./helpers.mjs";

test("selection requires repo disambiguation and rejects unknown ids", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "initial", [
      { op: "add", rule: rule("alpha", { applies_to: { repos: ["alpha"], ops: ["pr"] } }) },
      { op: "add", rule: rule("beta", { applies_to: { repos: ["beta"], ops: ["pr"] } }) },
    ], { approved: true });
    const workspace = await loadWorkspace(root, { today: TODAY });
    const ambiguous = selectRules(workspace, { ops: ["pr"] });
    assert.equal(ambiguous.complete, false);
    assert.deepEqual(ambiguous.selected, []);
    assert.deepEqual(ambiguous.ambiguous, ["alpha", "beta"]);
    assert.equal(selectRules(workspace, { ids: ["ghost"] }).status, "invalid");
    assert.deepEqual(selectRules(workspace, { repos: ["alpha"], paths: ["src/index.js"], ops: ["pr"] }).selected.map(r => r.id), ["alpha"]);
    assert.equal(selectRules(workspace, { repos: ["alpha", "beta"], ops: ["pr"] }).selected.length, 2);
  } finally { dispose(); }
});

test("pages prioritize global gates, count separators, and refuse changed sources", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "initial", [
      { op: "add", rule: rule("global", { kind: "gate" }) },
      { op: "add", rule: rule("scoped", { kind: "gate", applies_to: { repos: ["alpha"], ops: ["pr"] } }) },
      { op: "add", rule: rule("fact", { kind: "fact", applies_to: { repos: ["alpha"], ops: ["pr"] } }) },
    ], { approved: true });
    const workspace = await loadWorkspace(root, { today: TODAY });
    const signature = { repos: ["alpha"], ops: ["pr"] };
    const all = selectRules(workspace, signature);
    assert.equal(all.bytes, Buffer.byteLength(all.text));
    const budget = Buffer.byteLength(all.selected[0].text);
    const first = selectRules(workspace, signature, { bytes: budget });
    assert.equal(first.selected[0].id, "global");
    assert.equal(first.status, "incomplete");
    assert.ok(first.cursor);
    const second = selectRules(workspace, signature, { bytes: budget, cursor: first.cursor });
    assert.equal(second.status, "blocked", "an oversized rule must never be emitted over budget");
    assert.equal(second.reason, "rule_exceeds_budget");
    const paged = selectRules(workspace, signature, { bytes: 110 });
    const next = selectRules(workspace, signature, { bytes: 110, cursor: paged.cursor });
    assert.equal(next.selected[0].id, "scoped");
    workspace.rules[0].body += " changed";
    assert.equal(selectRules(workspace, signature, { bytes: 110, cursor: paged.cursor }).reason, "selection_changed");
  } finally { dispose(); }
});


test("catalog exposes every repo and operation once without hiding secondary scope", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "scope", [{ op: "add", rule: rule("shared", { applies_to: { repos: ["alpha", "beta"], ops: ["pr", "deploy", "coding"] } }) }]);
    const catalog = renderCatalog(await loadWorkspace(root));
    assert.ok(catalog.text.includes("### alpha,beta · pr"));
    assert.ok(catalog.text.includes("(+deploy,coding)"));
    assert.equal(catalog.text.split("[shared]").length - 1, 1);
  } finally { dispose(); }
});
