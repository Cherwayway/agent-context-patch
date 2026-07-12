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

test("Codex and Claude guidance requires same-turn gate-eligible application", () => {
  for (const path of [
    "adapters/codex/AGENTS.fragment.md",
    "adapters/claude/CLAUDE.fragment.md",
  ]) {
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
      /lesson, proposal ID, and targets/iu,
      `${path} does not define the compact receipt fields`,
    );
    assert.doesNotMatch(adapter, /Default to `propose`/u);
  }
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

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function compact(value) {
  return value.replace(/\s+/gu, " ");
}
