import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyPatchPlan,
  computePlanHash,
} from "../../skills/evolve/runtime/index.mjs";
import { parseYamlSubset } from "./yaml-subset.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("new and dogfood workspaces default eligible context writes to auto", () => {
  for (const path of [
    "templates/.agent-context/config.yml",
    ".agent-context/config.yml",
  ]) {
    const config = parseYamlSubset(read(path), path);
    assert.equal(
      config.context_write_policy,
      "auto",
      `${path} must make gate-eligible application the default`,
    );
  }
});

test("a fresh template config applies an eligible plan without approval", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-auto-default-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  await mkdir(contextRoot);
  await copyFile(
    join(repositoryRoot, "templates", ".agent-context", "config.yml"),
    join(contextRoot, "config.yml"),
  );

  const plan = {
    schemaVersion: 1,
    planId: "fresh-template-auto-plan",
    proposalId: "fresh-template-auto-proposal",
    workspaceRoot,
    requestedPolicy: "auto",
    policy: "auto",
    policyReason: "auto_eligible",
    risk: "low",
    semanticOperation: "add",
    currentFixStatus: "verified",
    privacy: { safe: true },
    contextHealth: { autoAllowed: true },
    contextDelta: { activeLinesBefore: 0, activeLinesAfter: 1 },
    operations: [
      {
        type: "create",
        target: ".agent-context/PROJECT_PROFILE.md",
        beforeHash: null,
        content: "# Project Profile\n\nFresh auto rule.\n",
      },
    ],
  };
  plan.planHash = computePlanHash(plan);

  const attempt = await applyPatchPlan(plan);

  assert.equal(attempt.status, "applied");
  assert.equal(
    await readFile(join(contextRoot, "PROJECT_PROFILE.md"), "utf8"),
    "# Project Profile\n\nFresh auto rule.\n",
  );
});

test("Codex and Claude share the observable delivery checkpoint", () => {
  const paths = [
    "adapters/codex/AGENTS.fragment.md",
    "adapters/claude/CLAUDE.fragment.md",
  ];
  for (const path of paths) {
    const adapter = compact(read(path));
    assert.match(adapter, /Default to `auto`/u, `${path} does not default to auto`);
    assert.match(
      adapter,
      /when (?:every|all)[^.]{0,160}auto[^.]{0,80}gates? pass[^.]{0,160}apply[^.]{0,80}(?:immediately|directly)/iu,
      `${path} does not require actual application after the auto gates pass`,
    );
    assert.match(
      adapter,
      /(?:do not|never) (?:ask|request)[^.]{0,160}approval/iu,
      `${path} still asks for approval on the eligible auto path`,
    );
    assert.match(
      adapter,
      /(?:do not|never) wait[^.]{0,160}user (?:reply|response)/iu,
      `${path} still blocks eligible application on a user reply`,
    );
    assert.match(
      adapter,
      /compact, non-blocking receipt/iu,
      `${path} does not reduce successful auto output to one compact receipt`,
    );
    assert.match(
      adapter,
      /proposal audit[^.]{0,240}before the final response/iu,
      `${path} does not finish the audit before responding`,
    );
    assert.match(
      adapter,
      /proposal ID and (?:workspace-)?relative targets/iu,
      `${path} does not define the compact receipt fields`,
    );
    assert.match(adapter, /delivery checkpoint/iu);
    assert.match(adapter, /current fix (?:is|has been) verified/iu);
    assert.match(adapter, /finalizeEvolutionOutcome/u);
    assert.match(adapter, /detect[^.]{0,100}propose[^.]{0,100}apply/iu);
    assert.match(adapter, /receipt\.text/u);
    for (const trigger of [
      "failed_verification_later_passed",
      "explicit_user_correction",
      "independent_qa_defect",
      "stale_context",
      "first_fix_failed_then_passed",
    ]) {
      assert.match(adapter, new RegExp(`\\b${trigger}\\b`, "u"));
    }
    assert.match(
      adapter,
      /no high-signal trigger[^.]{0,180}silent[^.]{0,180}(?:no|do not create)[^.]{0,100}(?:proposal|durable context write)/iu,
    );
    assert.doesNotMatch(adapter, /Default to `propose`/u);
  }

  const codex = read(paths[0]).replaceAll("AGENTS.md", "INSTRUCTIONS.md");
  const claude = read(paths[1]).replaceAll("CLAUDE.md", "INSTRUCTIONS.md");
  assert.equal(codex, claude, "Agent adapters drifted from the shared contract");
});

test("README and evolve skill publish auto rather than propose as the default", () => {
  for (const path of ["README.md", "skills/evolve/SKILL.md"]) {
    const document = compact(read(path));
    assert.match(
      document,
      /(?:`auto`[^.]{0,120}(?:is|as|the)\s+(?:the\s+)?default|default(?: write policy)?[^.]{0,120}`auto`)/iu,
      `${path} does not publish auto as the default write policy`,
    );
    assert.doesNotMatch(
      document,
      /(?:`propose`[^.]{0,120}(?:is|as|the)\s+(?:the\s+)?default|default(?: write policy)?[^.]{0,120}`propose`)/iu,
      `${path} still publishes propose as the default write policy`,
    );
  }
});

test("evolve finalizes triggered work through the shared Outcome Interface", () => {
  const skill = compact(read("skills/evolve/SKILL.md"));

  assert.match(skill, /delivery checkpoint/iu);
  assert.match(skill, /current fix (?:is|has been) verified/iu);
  assert.match(skill, /finalizeEvolutionOutcome/u);
  assert.match(skill, /runtime\/outcome\.mjs/u);
  assert.match(skill, /receipt\.text/u);
  assert.match(skill, /detect[^.]{0,100}propose[^.]{0,100}apply/iu);
  for (const trigger of [
    "failed_verification_later_passed",
    "explicit_user_correction",
    "independent_qa_defect",
    "stale_context",
    "first_fix_failed_then_passed",
  ]) {
    assert.match(skill, new RegExp(`\\b${trigger}\\b`, "u"));
  }
  assert.match(
    skill,
    /no high-signal trigger[^.]{0,180}silent[^.]{0,180}(?:no|do not create)[^.]{0,100}(?:proposal|durable context write)/iu,
  );
});

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function compact(value) {
  return value.replace(/\s+/gu, " ");
}
