import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadWorkspace, migrateV1 } from "../../skills/evolve/runtime/index.mjs";
import { draftToRule, extractBullets, splitProfile } from "../../skills/evolve/runtime/migrate-v1.mjs";

const V1_CONFIG = "schema_version: 1\ncreated_with_kit_version: \"0.6.1\"\nlast_migrated_with_kit_version: null\ncontext_write_policy: propose\nenabled_domains:\n  - coding\n";
const V1_PROFILE = `# Project Profile

## Product / Project

- Name: Fixture

## Enabled Domains

- coding

## Active Working Rules

<!-- acp-rule: id=2026-08-01-ship-freeze-1 source=2026-08-01-ship-freeze subsumes=none -->
- Never push after ship submit; the head is frozen and a new push
  requires another review round.
- Use replace-before-add for any reusable failure lesson.

## Verification State

- Last verified at: 2026-08-01
`;

test("extractBullets keeps markers and continuation lines and drops template bullets", () => {
  const bullets = extractBullets(splitProfile(V1_PROFILE).rulesSection, "PROJECT_PROFILE.md");
  assert.equal(bullets.length, 1);
  assert.equal(bullets[0].text, "Never push after ship submit; the head is frozen and a new push requires another review round.");
  assert.deepEqual(bullets[0].marker, { id: "2026-08-01-ship-freeze-1", source: "2026-08-01-ship-freeze" });
  const legacy = extractBullets("<!-- acp-rule: rule-x; source: 2026-07-01-src; subsumes: none -->\n- Always cast SQL parameters.\n", "checklists/coding.md");
  assert.deepEqual(legacy[0].marker, { id: "rule-x", source: "2026-07-01-src" });
});

test("splitProfile drops rule and domain sections and renames the title", () => {
  const { rulesSection, remainder } = splitProfile(V1_PROFILE);
  assert.match(rulesSection, /^## Active Working Rules/u);
  assert.match(remainder, /^# Profile\n/u);
  assert.ok(!remainder.includes("Enabled Domains") && !remainder.includes("acp-rule"));
  assert.match(remainder, /## Verification State/u);
});

test("draftToRule derives id, kind, scope, and a bounded body from a legacy bullet", () => {
  const used = new Set();
  const rule = draftToRule({ text: "Never push after ship submit; PR review restarts.", marker: { id: "x", source: "2026-08-01-ship-freeze" }, origin: "PROJECT_PROFILE.md" }, used, "2026-09-14");
  assert.equal(rule.id, "ship-freeze");
  assert.equal(rule.kind, "gate");
  assert.equal(rule.hook, "Never push after ship submit");
  assert.equal(rule.created, "2026-08-01");
  assert.deepEqual(rule.applies_to.ops, ["pr"]);
  assert.deepEqual(rule.applies_to.skills, ["pawlogic-ship"]);
  assert.equal(rule.needs_rewrite, true);
  assert.match(rule.body, /archive\/PROJECT_PROFILE-v1\.md/u);
  const second = draftToRule({ text: "Never push after ship submit", marker: { id: "y", source: "2026-08-02-ship-freeze" }, origin: "checklists/coding.md" }, used, "2026-09-14");
  assert.equal(second.id, "ship-freeze-2");
  const long = draftToRule({ text: `${"word ".repeat(400)}.`, origin: "checklists/coding.md" }, used, "2026-09-14");
  assert.ok(Buffer.byteLength(long.body) <= 1500);
});

test("migrateV1 converts a Schema 1 workspace in place, archives history, and renders the catalog", async () => {
  const root = mkdtempSync(join(tmpdir(), "acp-migrate-"));
  try {
    const context = join(root, ".agent-context");
    mkdirSync(join(context, "checklists"), { recursive: true });
    mkdirSync(join(context, "proposals"), { recursive: true });
    writeFileSync(join(context, "config.yml"), V1_CONFIG, "utf8");
    writeFileSync(join(context, "PROJECT_PROFILE.md"), V1_PROFILE, "utf8");
    writeFileSync(join(context, "PROJECT_CONTEXT_INDEX.md"), "# index\n", "utf8");
    writeFileSync(join(context, "checklists", "coding.md"), "# Coding\n\n- Run narrow verification and required project checks.\n- Cast every SQL parameter explicitly before EXPLAIN.\n", "utf8");
    writeFileSync(join(context, "proposals", "2026-08-01-ship-freeze.md"), "---\nstatus: applied\n---\n", "utf8");
    writeFileSync(join(root, "AGENTS.md"), "# Repo\n\nKeep.\n", "utf8");

    const result = await migrateV1({ workspaceRoot: root, today: "2026-09-14", kitVersion: "9.9.9" });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual([result.rules, result.fromChecklists, result.fromProfile, result.movedProposals], [2, 1, 1, 1]);
    const workspace = await loadWorkspace(root);
    assert.equal(workspace.status, "ok", JSON.stringify(workspace.failures));
    assert.equal(workspace.config.write_policy, "propose", "the v1 write policy is preserved");
    assert.deepEqual(workspace.rules.map((rule) => rule.id), ["cast-every-sql-parameter-explicitly-before-explain", "ship-freeze"]);
    assert.ok(workspace.rules.every((rule) => rule.needs_rewrite));
    assert.match(workspace.profile, /^# Profile/u);
    for (const gone of ["PROJECT_PROFILE.md", "PROJECT_CONTEXT_INDEX.md", "checklists"]) assert.ok(!existsSync(join(context, gone)), gone);
    assert.ok(existsSync(join(context, "archive", "proposals-v1", "2026-08-01-ship-freeze.md")));
    assert.ok(existsSync(join(context, "archive", "checklists-v1", "coding.md")));
    assert.ok(existsSync(join(context, "archive", "PROJECT_PROFILE-v1.md")));
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith("# Repo\n\nKeep.\n\n<!-- acp-catalog:"));
    assert.match(agents, /- gate \[ship-freeze\] Never push after ship submit/u);

    const again = await migrateV1({ workspaceRoot: root, today: "2026-09-14" });
    assert.deepEqual([again.status, again.reason], ["failed", "not_schema_1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
