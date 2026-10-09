import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runtimeRoot } from "./helpers.mjs";

const cli = join(runtimeRoot, "cli.mjs");
const kitVersion = JSON.parse(readFileSync(join(runtimeRoot, "..", "manifest.json"), "utf8")).version;

function evolve(cwd, ...arguments_) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", env: { ...process.env, ACP_WORKSPACE: "" } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json: tryJson(result.stdout) };
}

function tryJson(text) {
  try {
    return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
  } catch {
    return undefined;
  }
}

test("weekly and status agree after a Kit upgrade without rewriting creation metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "acp-cli-upgraded-"));
  try {
    assert.equal(evolve(root, "init", "--workspace", root).status, 0);
    const configPath = join(root, ".agent-context", "config.yml");
    const historicalConfig = readFileSync(configPath, "utf8").replace(/^kit_version: .+$/mu, 'kit_version: "0.7.0"');
    writeFileSync(configPath, historicalConfig);
    const proposalPath = join(root, "proposal.json");
    writeFileSync(proposalPath, JSON.stringify({
      id: "upgraded-fixture", trigger: "stale_context", fix_status: "verified", evidence: "synthetic CLI fixture",
      operations: [{ op: "add", rule: { id: "upgrade-gate", hook: "Version-aware fixture gate", kind: "gate", body: "Verify the synthetic artifact." } }],
    }));
    assert.equal(evolve(root, "apply", "--proposal", `@${proposalPath}`, "--today", "2026-10-09").status, 0);
    const status = evolve(root, "status", "--today", "2026-10-09");
    const weekly = evolve(root, "weekly", "--today", "2026-10-09");
    assert.equal(status.status, 0, status.stderr);
    assert.equal(weekly.status, 0, weekly.stderr);
    assert.equal(status.json.health.catalog.fresh, true);
    assert.equal(weekly.json.summary.health.catalog.fresh, true, "weekly must use the running Kit, not historical creation metadata");
    assert.equal(weekly.json.summary.catalogBytes, status.json.catalogBytes);
    assert.ok(!weekly.json.summary.actions.some(action => action.includes("stale catalog")));

    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, readFileSync(agentsPath, "utf8").replace("Version-aware fixture gate", "Stale fixture hook"));
    assert.equal(evolve(root, "status", "--today", "2026-10-09").json.health.catalog.fresh, false);
    assert.equal(evolve(root, "weekly", "--today", "2026-10-09").json.summary.health.catalog.fresh, false);
    assert.equal(readFileSync(configPath, "utf8"), historicalConfig, "Kit checks must preserve creation metadata");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI drives the whole loop: init, apply, select, consult, status, expire, weekly, receipt", () => {
  const root = mkdtempSync(join(tmpdir(), "acp-cli-"));
  try {
    const init = evolve(root, "init", "--workspace", root);
    assert.equal(init.status, 0, init.stderr);
    assert.match(readFileSync(join(root, ".agent-context", "config.yml"), "utf8"), new RegExp(`kit_version: "${kitVersion.replaceAll(".", "\\.")}"`, "u"));
    assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /acp-catalog: kit=/u);

    const proposalPath = join(root, "proposal.json");
    writeFileSync(proposalPath, JSON.stringify({
      id: "2026-09-14-cli",
      trigger: "user_correction",
      fix_status: "verified",
      evidence: "cli test",
      operations: [
        { op: "add", rule: { id: "cli-gate", hook: "CLI gate hook for sql work", kind: "gate", applies_to: { ops: ["sql"] }, body: "Body." } },
        { op: "state_set", entry: { id: "cli-state", text: "temporary", ttl_days: 1 } },
      ],
    }), "utf8");
    const apply = evolve(root, "apply", "--proposal", `@${proposalPath}`, "--today", "2026-09-14");
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=2026-09-14-cli; targets=\.agent-context\/STATE\.yml,\.agent-context\/rules\/cli-gate\.md; catalog=\d+B\/1 rules\.\n$/u);

    const replay = evolve(root, "apply", "--proposal", `@${proposalPath}`, "--today", "2026-09-14");
    assert.equal(replay.status, 1);
    assert.equal(replay.json.reason, "proposal_exists");

    const nested = join(root, "sub", "dir");
    const select = evolve(root, "select", "--signature", '{"ops":["sql"]}');
    assert.equal(select.status, 0, select.stderr);
    assert.match(select.stdout, /^Context selection: complete; \d+B body text\.\n\n### gate \[cli-gate\] CLI gate hook for sql work\n<!-- ops=sql -->\nBody\.\n$/u);
    const selectJson = evolve(root, "select", "--signature", '{"ops":["docs"]}', "--json");
    assert.deepEqual(selectJson.json.selected, []);
    const badSignature = evolve(root, "select", "--signature", '{"prompt":"raw"}');
    assert.equal(badSignature.status, 1);
    assert.equal(badSignature.json.reason, "invalid_signature");

    const consult = evolve(root, "consult", "--consulted", "cli-gate", "--missed", "nope", "--today", "2026-09-14");
    assert.equal(consult.stdout, "Context use: consulted=cli-gate; unknown=nope.\n");

    const status = evolve(root, "status");
    assert.equal(status.status, 0);
    assert.deepEqual([status.json.rules, status.json.state, status.json.writePolicy], [1, 1, "auto"]);

    const expire = evolve(root, "expire", "--today", "2026-10-01");
    assert.equal(expire.status, 0, expire.stderr);
    assert.deepEqual(expire.json.expired, ["cli-state"]);

    const weekly = evolve(root, "weekly", "--today", "2026-10-01");
    assert.equal(weekly.status, 0, weekly.stderr);
    assert.ok(weekly.json.reportPath.endsWith("weekly-2026-10-01.md"));

    const catalog = evolve(root, "catalog");
    assert.match(catalog.stdout, /^<!-- acp-catalog: kit=/u);

    const receipt = evolve(root, "receipt", "--detect", "no_candidate:no_trigger");
    assert.equal(receipt.stdout, "Evolution outcome: detect=no_candidate(no_trigger); propose=not_needed(unspecified); apply=not_attempted(no_proposal).\n");

    const usage = evolve(root, "bogus");
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /unknown command bogus/u);
    const noWorkspace = evolve(tmpdir(), "status", "--workspace", join(root, "nowhere"));
    assert.equal(noWorkspace.status, 1);
    assert.equal(noWorkspace.json.reason, "workspace_invalid");
    void nested;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
