import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyProposal, expireWorkspaceState, loadWorkspace, recordConsultation, writeCatalog } from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, KIT, proposal, rule, seed, TODAY } from "./helpers.mjs";

test("all writers honor the same held workspace lock", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "initial", [{ op: "add", rule: rule("one") }]);
    const workspace = await loadWorkspace(root);
    await writeFile(join(root, ".agent-context", ".lock"), "external owner");
    const results = await Promise.all([
      recordConsultation({ workspaceRoot: root, consulted: ["one"] }),
      expireWorkspaceState({ workspaceRoot: root }),
      writeCatalog(workspace),
    ]);
    for (const result of results) assert.deepEqual([result.status, result.reason], ["blocked", "workspace_locked"]);
    assert.equal((await loadWorkspace(root)).rules[0].consulted, 0);
    assert.equal(await readFile(join(root, ".agent-context", ".lock"), "utf8"), "external owner");
  } finally { dispose(); }
});

test("successful simultaneous consults are never lost and concurrent apply reloads under lock", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "initial", [{ op: "add", rule: rule("one") }]);
    const results = await Promise.all(Array.from({ length: 16 }, () => recordConsultation({ workspaceRoot: root, consulted: ["one"], today: TODAY })));
    assert.equal((await loadWorkspace(root)).rules[0].consulted, results.filter(r => r.status === "ok").length);
    const applied = await Promise.all(["two", "three"].map(id => applyProposal({ workspaceRoot: root, proposal: proposal(id, [{ op: "add", rule: rule(id) }]), approved: true, today: TODAY })));
    const workspace = await loadWorkspace(root);
    for (const result of applied.filter(r => r.status === "applied")) assert.ok(workspace.rules.some(r => r.id === result.proposalId));
  } finally { dispose(); }
});

test("expiry during apply archives exactly once; catalog failure leaves no success audit", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "initial", [{ op: "state_set", entry: { id: "old", text: "old state", expires: "2026-09-15" } }]);
    await seed(root, "later", [{ op: "add", rule: rule("new") }], { today: "2026-09-20" });
    const archive = await readFile(join(root, ".agent-context", "archive", "state.yml"), "utf8");
    assert.equal((archive.match(/id: old/g) ?? []).length, 1);
    await expireWorkspaceState({ workspaceRoot: root, today: "2026-09-20" });
    assert.equal(await readFile(join(root, ".agent-context", "archive", "state.yml"), "utf8"), archive);
    await writeFile(join(root, "AGENTS.md"), "<!-- acp-catalog: broken -->");
    const result = await applyProposal({ workspaceRoot: root, proposal: proposal("failure", [{ op: "add", rule: rule("failed") }]), approved: true, today: TODAY, kitVersion: KIT });
    assert.equal(result.status, "failed");
    assert.equal((await loadWorkspace(root)).rules.some(r => r.id === "failed"), false);
    await assert.rejects(readFile(join(root, ".agent-context", "proposals", "failure.md")), { code: "ENOENT" });
  } finally { dispose(); }
});

test("transaction preflight rejects an invalid target before changing any files", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await mkdir(join(root, ".agent-context", "proposals", "failure.md"));
    const result = await applyProposal({ workspaceRoot: root, proposal: proposal("failure", [{ op: "add", rule: rule("failed") }]), today: TODAY });
    assert.equal(result.status, "failed");
    assert.equal((await loadWorkspace(root)).rules.length, 0);
  } finally { dispose(); }
});
