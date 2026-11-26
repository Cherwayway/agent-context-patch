import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkspace, normalizeSignature, selectRules } from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, rule, seed, TODAY } from "./helpers.mjs";

test("normalizeSignature validates paths; selection resolves known repo prefixes and rejects unknown keys", () => {
  const { failures, value } = normalizeSignature({ paths: ["./ilands/migrations/1.sql", "README.md"], ops: ["sql"] });
  assert.deepEqual(failures, []);
  assert.deepEqual(value, { repos: [], paths: ["ilands/migrations/1.sql", "README.md"], ops: ["sql"], skills: [], ids: [] });
  assert.match(normalizeSignature({ prompt: "raw text" }).failures.join("\n"), /unsupported signature key prompt/u);
  assert.match(normalizeSignature({ ids: ["Bad Id"] }).failures.join("\n"), /invalid identifier/u);
  assert.match(normalizeSignature({ paths: "x" }).failures.join("\n"), /signature\.paths must be a list of strings/u);
  assert.match(normalizeSignature([]).failures.join("\n"), /signature must be an object/u);
});

async function seededWorkspace() {
  const { root, dispose } = await createWorkspace();
  await seed(root, "p-1", [
    { op: "add", rule: rule("ilands-sql-gate", { hook: "Cast every SQL parameter explicitly", kind: "gate", applies_to: { repos: ["ilands"], ops: ["sql"] } }) },
    { op: "add", rule: rule("ilands-migration-paths", { hook: "Migrations need CONCURRENTLY", applies_to: { repos: ["ilands"], paths: ["ilands/migrations/**"] } }) },
    { op: "add", rule: rule("pi-mono-sql", { hook: "pi-mono SQL runs on sqlite", applies_to: { repos: ["pi-mono"], ops: ["sql"] } }) },
    { op: "add", rule: rule("ship-skill", { hook: "ship submit freezes the head", applies_to: { skills: ["pawlogic-ship"] } }) },
    { op: "add", rule: rule("global-gate", { hook: "Never push to main directly", kind: "gate" }) },
    { op: "add", rule: rule("global-advice", { hook: "Prefer small diffs" }) },
    { op: "add", rule: rule("ilands-only", { hook: "ilands deploys are manual", applies_to: { repos: ["ilands"] } }) },
  ]);
  return { root, dispose };
}

test("selectRules filters by repo, matches any scoped dimension, and includes only global gates", async () => {
  const { root, dispose } = await seededWorkspace();
  try {
    const workspace = await loadWorkspace(root, { today: TODAY });
    const result = selectRules(workspace, { paths: ["ilands/migrations/2026-09-14-add-index.sql"], ops: ["sql"] });
    assert.equal(result.status, "ok");
    const ids = result.selected.map((entry) => entry.id);
    assert.deepEqual(ids, ["global-gate", "ilands-sql-gate", "ilands-migration-paths", "ilands-only"], "gates first, higher score first within a kind");
    assert.ok(!ids.includes("pi-mono-sql"), "other repos are filtered out");
    assert.ok(!ids.includes("global-advice"), "global advice is served by the catalog hook only");
    assert.ok(!ids.includes("ship-skill"), "skill-scoped rules need the skill in the signature");
    const gate = result.selected.find((entry) => entry.id === "ilands-sql-gate");
    assert.deepEqual(gate.reasons, ["repos", "ops"]);
    assert.equal(gate.score, 2);
    assert.match(gate.text, /^### gate \[ilands-sql-gate\] Cast every SQL parameter explicitly\n<!-- repos=ilands ops=sql -->\nBody for ilands-sql-gate\.\n$/u);
    assert.equal(result.text, result.selected.map((entry) => entry.text).join("\n"));
  } finally {
    dispose();
  }
});

test("selectRules honors skills, explicit ids, and the select byte budget with gates first", async () => {
  const { root, dispose } = await seededWorkspace();
  try {
    const workspace = await loadWorkspace(root, { today: TODAY });
    const bySkill = selectRules(workspace, { skills: ["pawlogic-ship"], ids: ["global-advice"] });
    assert.deepEqual(bySkill.selected.map((entry) => entry.id), ["global-gate", "global-advice", "ship-skill"]);
    assert.deepEqual(bySkill.selected.find((entry) => entry.id === "global-advice").reasons, ["id"]);

    const tight = { ...workspace, config: { ...workspace.config, budgets: { ...workspace.config.budgets, select_bytes: 200 } } };
    const capped = selectRules(tight, { paths: ["ilands/migrations/x.sql"], ops: ["sql"] });
    assert.deepEqual(capped.selected.map((entry) => entry.id), ["global-gate", "ilands-sql-gate"]);
    assert.deepEqual(capped.omitted, ["ilands-migration-paths", "ilands-only"]);
    assert.ok(capped.bytes <= 200);

    const invalid = selectRules(workspace, { nope: [] });
    assert.equal(invalid.status, "invalid");
    const nothing = selectRules(workspace, {});
    assert.deepEqual(nothing.selected.map((entry) => entry.id), ["global-gate"], "an empty signature still returns global gates");
  } finally {
    dispose();
  }
});

test("selectRules ranks path and skill matches ahead of generic ops at equal score and supports stage filtering", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "p-1", [
      { op: "add", rule: rule("a-generic-op", { hook: "Generic coding advice", applies_to: { repos: ["ilands"], ops: ["coding"] } }) },
      { op: "add", rule: rule("m-skill-match", { hook: "Skill specific advice", applies_to: { repos: ["ilands"], skills: ["cloud-sql"] } }) },
      { op: "add", rule: rule("z-path-match", { hook: "Exact file path advice", applies_to: { repos: ["ilands"], paths: ["ilands/migrations/**"] } }) },
      { op: "add", rule: rule("pr-stage-only", { hook: "PR review checklist", applies_to: { repos: ["ilands"], ops: ["pr"] } }) },
    ], { approved: true });
    const workspace = await loadWorkspace(root, { today: TODAY });
    const ranked = selectRules(workspace, {
      repos: ["ilands"],
      paths: ["ilands/migrations/001.sql"],
      ops: ["coding", "pr"],
      skills: ["cloud-sql"],
    });
    assert.deepEqual(
      ranked.selected.map((entry) => entry.id),
      ["z-path-match", "m-skill-match", "a-generic-op", "pr-stage-only"],
      "within equal kind and score (2), paths outrank skills which outrank generic ops",
    );

    const editStage = selectRules(workspace, { repos: ["ilands"], ops: ["coding", "pr"] }, { stage: "edit" });
    assert.deepEqual(editStage.selected.map((entry) => entry.id), ["a-generic-op"]);

    const prStage = selectRules(workspace, { repos: ["ilands"] }, { stage: "pr" });
    assert.deepEqual(prStage.selected.map((entry) => entry.id), ["pr-stage-only"]);

    assert.equal(selectRules(workspace, { repos: ["ilands"] }, { stage: "unknown" }).status, "invalid");
  } finally {
    dispose();
  }
});
