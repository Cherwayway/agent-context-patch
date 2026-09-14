import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, inspectConfig, inspectRule, inspectStateEntry, loadWorkspace } from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, KIT, rule, seed, TODAY } from "./helpers.mjs";

test("inspectConfig enforces the Schema 2 contract", () => {
  const good = { ...DEFAULT_CONFIG, kit_version: "0.7.0", budgets: { ...DEFAULT_CONFIG.budgets }, state: { ...DEFAULT_CONFIG.state } };
  assert.deepEqual(inspectConfig(good).failures, []);
  assert.match(inspectConfig({ ...good, schema_version: 1 }).failures.join("\n"), /schema_version must be 2/u);
  assert.match(inspectConfig({ ...good, write_policy: "ask" }).failures.join("\n"), /write_policy must be auto or propose/u);
  assert.match(inspectConfig({ ...good, agents_file: "../AGENTS.md" }).failures.join("\n"), /agents_file must be a bare file name/u);
  assert.match(inspectConfig({ ...good, extra: 1 }).failures.join("\n"), /unsupported keys: extra/u);
  assert.match(inspectConfig({ ...good, budgets: { ...good.budgets, similarity_block: 2 } }).failures.join("\n"), /similarity_block/u);
  assert.match(inspectConfig({ ...good, state: { default_ttl_days: 100, max_ttl_days: 90 } }).failures.join("\n"), /must not exceed max_ttl_days/u);
});

test("inspectRule enforces ids, kinds, scope keys, and byte budgets", () => {
  const base = { id: "a-rule", hook: "Hook", kind: "gate", applies_to: {}, supersedes: [], source: "p", created: "2026-09-01" };
  assert.deepEqual(inspectRule(base, "body", DEFAULT_CONFIG.budgets, "a-rule"), []);
  assert.match(inspectRule(base, "body", DEFAULT_CONFIG.budgets, "other").join("\n"), /id must equal the file name/u);
  assert.match(inspectRule({ ...base, kind: "law" }, "", DEFAULT_CONFIG.budgets).join("\n"), /kind must be one of gate, advice, fact/u);
  assert.match(inspectRule({ ...base, applies_to: { files: [] } }, "", DEFAULT_CONFIG.budgets).join("\n"), /applies_to\.files is not supported/u);
  assert.match(inspectRule({ ...base, hook: "x".repeat(161) }, "", DEFAULT_CONFIG.budgets).join("\n"), /hook exceeds 160 bytes/u);
  assert.match(inspectRule(base, "x".repeat(1501), DEFAULT_CONFIG.budgets).join("\n"), /body exceeds 1500 bytes/u);
  assert.match(inspectRule({ ...base, hook: "two\nlines" }, "", DEFAULT_CONFIG.budgets).join("\n"), /hook must be one non-empty line/u);
  assert.match(inspectRule({ ...base, secret: true }, "", DEFAULT_CONFIG.budgets).join("\n"), /unsupported key secret/u);
});

test("inspectStateEntry bounds text length and TTL", () => {
  const entry = { id: "s", expires: "2026-09-20", text: "waiting on review", repos: ["ilands"], created: TODAY };
  assert.deepEqual(inspectStateEntry(entry, DEFAULT_CONFIG.state, TODAY), []);
  assert.match(inspectStateEntry({ ...entry, expires: "2027-09-20" }, DEFAULT_CONFIG.state, TODAY).join("\n"), /exceeds max_ttl_days \(90\)/u);
  assert.match(inspectStateEntry({ ...entry, text: "x".repeat(241) }, DEFAULT_CONFIG.state, TODAY).join("\n"), /text exceeds 240 bytes/u);
  assert.match(inspectStateEntry({ ...entry, id: "Bad" }, DEFAULT_CONFIG.state, TODAY).join("\n"), /id must be/u);
});

test("loadWorkspace returns missing, invalid (with schemaVersion), and ok with normalized rules", async () => {
  const missing = await loadWorkspace("/nonexistent/path/for/acp");
  assert.equal(missing.status, "missing");

  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "p-1", [{ op: "add", rule: rule("first", { kind: "gate", applies_to: { repos: ["ilands"], ops: ["sql"] } }) }]);
    const workspace = await loadWorkspace(root, { today: TODAY });
    assert.equal(workspace.status, "ok");
    assert.equal(workspace.config.kit_version, KIT);
    assert.equal(workspace.rules.length, 1);
    const [first] = workspace.rules;
    assert.deepEqual(first.applies_to, { repos: ["ilands"], paths: [], ops: ["sql"], skills: [] });
    assert.equal(first.consulted, 0);
    assert.equal(first.body, "Body for first.");
    assert.equal(first.source, "p-1");
    assert.match(first.raw, /^---\nid: first\n/u);
    assert.equal(workspace.today, TODAY);
    assert.deepEqual(workspace.state, []);

    writeFileSync(join(root, ".agent-context", "rules", "broken.md"), "---\nid: broken\n---\n", "utf8");
    const invalid = await loadWorkspace(root);
    assert.equal(invalid.status, "invalid");
    assert.match(invalid.failures.join("\n"), /rules\/broken\.md: missing key hook/u);

    writeFileSync(join(root, ".agent-context", "config.yml"), "schema_version: 1\n", "utf8");
    const legacy = await loadWorkspace(root);
    assert.equal(legacy.status, "invalid");
    assert.equal(legacy.schemaVersion, 1);
  } finally {
    dispose();
  }
});

test("loadWorkspace rejects duplicate rule ids and malformed STATE", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    mkdirSync(join(root, ".agent-context", "rules"), { recursive: true });
    const text = "---\nid: dup\nhook: h\nkind: advice\napplies_to: {}\nsupersedes: []\nsource: s\ncreated: 2026-09-01\n---\n";
    writeFileSync(join(root, ".agent-context", "rules", "dup.md"), text, "utf8");
    writeFileSync(join(root, ".agent-context", "STATE.yml"), "- id: x\n  text: missing expires\n", "utf8");
    const workspace = await loadWorkspace(root);
    assert.equal(workspace.status, "invalid");
    assert.match(workspace.failures.join("\n"), /STATE\.yml\[0\]: expires must be an ISO date/u);
  } finally {
    dispose();
  }
});
