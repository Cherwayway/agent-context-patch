import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadWorkspace, renderCatalog, replaceCatalogBlock, writeCatalog } from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, KIT, rule, seed, TODAY } from "./helpers.mjs";

test("renderCatalog groups by repo and op, orders gate before advice, and lists active state", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "p-1", [
      { op: "add", rule: rule("ilands-advice", { hook: "Advice for ilands sql", applies_to: { repos: ["ilands"], ops: ["sql"] } }) },
      { op: "add", rule: rule("ilands-gate", { hook: "Gate for ilands sql", kind: "gate", applies_to: { repos: ["ilands"], ops: ["sql"] } }) },
      { op: "add", rule: rule("global-fact", { hook: "A fact about everything", kind: "fact" }) },
      { op: "state_set", entry: { id: "pr-open", text: "PR 42 awaits review", repos: ["ilands"], ttl_days: 3 } },
      { op: "state_set", entry: { id: "old", text: "already gone", expires: "2026-09-01" } },
    ], { approved: true });
    const workspace = await loadWorkspace(root, { today: TODAY });
    const catalog = renderCatalog(workspace, { renderedAt: "2026-09-14T00:00:00.000Z", kitVersion: KIT });
    assert.equal(catalog.rules, 3);
    assert.equal(catalog.state, 1, "expired state entries are not rendered");
    const lines = catalog.text.split("\n");
    assert.equal(lines[0], `<!-- acp-catalog: kit=${KIT} schema=2 rendered=2026-09-14T00:00:00.000Z rules=3 state=1 -->`);
    assert.equal(lines.at(-2), "<!-- /acp-catalog -->");
    const ilands = lines.indexOf("### ilands · sql");
    const any = lines.indexOf("### any · general");
    assert.ok(ilands !== -1 && any !== -1 && ilands < any, "named repos precede the global group");
    assert.equal(lines[ilands + 1], "- gate [ilands-gate] Gate for ilands sql");
    assert.equal(lines[ilands + 2], "- advice [ilands-advice] Advice for ilands sql");
    assert.equal(lines[any + 1], "- fact [global-fact] A fact about everything");
    assert.ok(catalog.text.includes("### STATE (auto-expires)\n- (09-17) ilands: PR 42 awaits review"));
    assert.equal(catalog.bytes, Buffer.byteLength(catalog.text));
  } finally {
    dispose();
  }
});

test("replaceCatalogBlock appends when absent, replaces in place, and rejects unbalanced blocks", () => {
  const block = "<!-- acp-catalog: kit=1 schema=2 rendered=x rules=0 state=0 -->\nbody\n<!-- /acp-catalog -->\n";
  assert.equal(replaceCatalogBlock("", block), block);
  assert.equal(replaceCatalogBlock("# Title\n", block), `# Title\n\n${block}`);
  const source = `# Title\n\nintro\n\n${block}\n## After\n`;
  const next = replaceCatalogBlock(source, block.replace("body", "new body"));
  assert.equal(next, `# Title\n\nintro\n\n${block.replace("body", "new body")}\n## After\n`);
  assert.equal(replaceCatalogBlock(source.replaceAll("\n", "\r\n"), block).includes("\r\n"), false, "output is LF-normalized");
  assert.throws(() => replaceCatalogBlock("<!-- acp-catalog: x -->\nno close\n", block), /unbalanced acp-catalog block/u);
});

test("writeCatalog only touches the managed block of the instruction file", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "# Hand-written\n\nKeep me.\n", "utf8");
    await seed(root, "p-1", [{ op: "add", rule: rule("one") }]);
    const written = readFileSync(agentsPath, "utf8");
    assert.ok(written.startsWith("# Hand-written\n\nKeep me.\n\n<!-- acp-catalog:"));
    const workspace = await loadWorkspace(root, { today: TODAY });
    const again = await writeCatalog(workspace, { kitVersion: KIT, renderedAt: "2026-09-14T00:00:00.000Z" });
    assert.equal(again.changed, true, "a new rendered timestamp rewrites the block");
    const third = await writeCatalog(workspace, { kitVersion: KIT, renderedAt: "2026-09-14T00:00:00.000Z" });
    assert.equal(third.changed, false, "an identical render is a no-op");
    assert.equal((readFileSync(agentsPath, "utf8").match(/acp-catalog:/gu) ?? []).length, 1);
  } finally {
    dispose();
  }
});
