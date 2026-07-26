import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateConfigDocument } from "./config-contract.mjs";
import { validateProposalDocument } from "./proposal-contract.mjs";
import { parseMarkdownFrontmatter, parseYamlSubset } from "./yaml-subset.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("package, skill manifest, and context schema versions agree", () => {
  const packageJson = readJson("package.json");
  const manifest = readJson("skills/evolve/manifest.json");
  const config = parseYamlSubset(read("templates/.agent-context/config.yml"), "template config");

  assert.equal(packageJson.version, "0.5.3");
  assert.equal(packageJson.engines?.node, ">=20");
  assert.equal(manifest.kit, "agent-context-patch");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(config.schema_version, manifest.schemaVersion);
  assert.equal(config.created_with_kit_version, packageJson.version);
  assert.equal(config.last_migrated_with_kit_version, null);
});

test("workspace template has one active topology and no pre-enabled domain materialization", () => {
  for (const path of [
    "PROJECT_CONTEXT_INDEX.md",
    "PROJECT_PROFILE.md",
    "config.yml",
    "checklists/README.md",
    "proposals/README.md",
    "reports/README.md",
    "archive/README.md",
  ]) {
    assert.ok(existsSync(resolveTemplate(path)), `missing template path: ${path}`);
  }

  for (const obsoletePath of ["mistakes", "receipts"]) {
    assert.equal(
      containsFiles(resolveTemplate(obsoletePath)),
      false,
      `template contains obsolete files under: ${obsoletePath}`,
    );
  }
  for (const domainFile of ["coding.md", "prd.md", "seo.md"]) {
    assert.equal(
      existsSync(resolveTemplate(`checklists/${domainFile}`)),
      false,
      `template prematurely materializes domain checklist: ${domainFile}`,
    );
  }
});

test("the public update surface is release-based, explicit, and workspace-independent", () => {
  const readme = read("README.md");
  const chineseReadme = read("README.zh-CN.md");
  const installGuide = read("AGENT_INSTALL.md");
  const skill = read("skills/evolve/SKILL.md");
  const updatePolicy = read("docs/update-policy.md");
  const powershellInstaller = read("install/install.ps1");
  const bashInstaller = read("install/install.sh");

  for (const document of [readme, chineseReadme, installGuide, skill]) {
    assert.match(document, /releases\/latest/iu);
    assert.match(document, /\$evolve update/iu);
  }
  assert.doesNotMatch(
    readme,
    /Install Agent Context Patch from https:\/\/github\.com\/Cherwayway\/agent-context-patch\.(?:\r?\n|\s)/u,
    "stable install instructions still point at the moving repository root",
  );
  assert.match(powershellInstaller, /UpdateDryRun/iu);
  assert.match(powershellInstaller, /UpdateApply/iu);
  assert.match(bashInstaller, /update-dry-run/iu);
  assert.match(bashInstaller, /update-apply/iu);
  assert.match(skill, /never poll in\s+the background/iu);
  assert.match(skill, /never.*workspace-schema migration/isu);
  assert.match(updatePolicy, /GitHub-enforced immutable Release/iu);
  assert.match(updatePolicy, /Create a draft/iu);
  assert.match(installGuide, /One-time handoff from v0\.2\.0/iu);
  assert.match(readme, /v0\.2\.0 skill predates `\$evolve update`/iu);
});

test("template config expresses the v1 policy and health thresholds", () => {
  const path = "templates/.agent-context/config.yml";
  assert.deepEqual(validateConfigDocument(read(path), path), []);
});

test("personal dogfooding is an installed reference and this repository follows Schema 1", () => {
  const playbookPath = "skills/evolve/references/personal-dogfooding.zh-CN.md";
  const playbook = read(playbookPath);
  const skill = read("skills/evolve/SKILL.md");
  const profile = read(".agent-context/PROJECT_PROFILE.md");

  assert.match(skill, /references\/personal-dogfooding\.zh-CN\.md/u);
  for (const token of [
    "Default Personal Loop",
    "$evolve after-failure",
    "Weekly Review",
    "Promotion Gate",
    "Success Check",
  ]) {
    assert.ok(playbook.includes(token), `${playbookPath} is missing: ${token}`);
  }

  assert.deepEqual(
    validateConfigDocument(read(".agent-context/config.yml"), ".agent-context/config.yml"),
    [],
  );
  assert.match(profile, /0\.5\.1 observable-delivery/u);
  assert.match(profile, /personal-dogfooding\.zh-CN\.md/u);
  assert.equal(
    containsFiles(join(repositoryRoot, ".agent-context", "mistakes")),
    false,
    "dogfood context revived the obsolete mistakes store",
  );
});

test("the auto-first fresh-Agent acceptance evidence is retained", () => {
  const acceptance = read("docs/acceptance/2026-07-12-auto-first-fresh-context.md");

  assert.match(acceptance, /^- Result: PASS$/mu);
  assert.match(acceptance, /No approval turn\s+occurred/u);
  assert.match(acceptance, /production proposal validator returned no failures/u);
  assert.match(acceptance, /Proposal count remained zero/u);
  assert.match(acceptance, /no raw conversation/u);
});

test("the observable delivery fresh-Agent acceptance evidence is retained", () => {
  const acceptance = read(
    "docs/acceptance/2026-07-19-observable-delivery-checkpoint.md",
  );

  assert.match(acceptance, /^- Result: PASS$/mu);
  assert.match(acceptance, /without naming `?\$?evolve`?/iu);
  assert.match(acceptance, /detect=candidate/u);
  assert.match(acceptance, /propose=created/u);
  assert.match(acceptance, /apply=applied/u);
  assert.match(acceptance, /production proposal validator returned no failures/iu);
  assert.match(acceptance, /Proposal count remained zero/u);
  assert.match(acceptance, /no durable context write/iu);
  assert.match(acceptance, /no evolution receipt/iu);
  assert.match(acceptance, /no raw conversation/iu);
  assert.match(acceptance, /no private absolute workspace path/iu);
});

test("semantic generalization remains an Agent-owned reviewed workflow", () => {
  const skill = read("skills/evolve/SKILL.md");
  const cleanupPolicy = read("skills/evolve/references/cleanup-policy.md");
  const fixture = readJson(
    "tests/acceptance/fixtures/review-context-semantic-generalization.json",
  );
  const runtime = [
    "skills/evolve/runtime/index.mjs",
    "skills/evolve/runtime/lifecycle.mjs",
    "skills/evolve/runtime/outcome.mjs",
  ]
    .map(read)
    .join("\n");

  for (const behaviorField of [
    "responsibility",
    "trigger",
    "reachable execution path",
    "intended state or effect",
    "observable verification",
  ]) {
    assert.ok(
      cleanupPolicy.toLowerCase().includes(behaviorField),
      `cleanup policy is missing behavior-shape field: ${behaviorField}`,
    );
  }
  for (const evidenceField of [
    "proposal ids",
    "preserved domain details",
    "counterexamples",
    "behavior lost",
    "net active-context change",
  ]) {
    assert.ok(
      cleanupPolicy.toLowerCase().includes(evidenceField),
      `cleanup policy is missing consolidation evidence: ${evidenceField}`,
    );
  }
  assert.match(skill, /summary-first/iu);
  assert.match(skill, /shortlist/iu);
  assert.match(skill, /same responsibility/iu);
  assert.doesNotMatch(runtime, /embedding|similarity threshold|semantic cluster/iu);

  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.cases.length, 2);
  for (const scenario of fixture.cases) {
    assert.ok(scenario.appliedProposals.length >= 4);
    assert.equal(
      new Set(scenario.appliedProposals.map(({ id }) => id)).size,
      scenario.appliedProposals.length,
    );
    for (const proposal of scenario.appliedProposals) {
      assert.equal(proposal.status, "applied");
      for (const field of [
        "surface",
        "responsibility",
        "trigger",
        "executionPath",
        "intendedEffect",
        "observableVerification",
        "failureStage",
        "domainDetail",
      ]) {
        assert.equal(typeof proposal[field], "string");
        assert.ok(proposal[field].length > 0);
      }
    }
  }
  assert.ok(
    new Set(fixture.cases[0].appliedProposals.map(({ surface }) => surface))
      .size >= 4,
    "positive fixture must cross implementation nouns and domains",
  );
});

test("semantic generalization has positive and negative fresh-Agent evidence", () => {
  const acceptance = read(
    "docs/acceptance/2026-07-26-semantic-generalization.md",
  );

  assert.match(acceptance, /^- Candidate Kit Version: 0\.5\.3$/mu);
  assert.match(acceptance, /^- Fresh Agents: 2$/mu);
  assert.match(acceptance, /^- Result: PASS$/mu);
  assert.match(acceptance, /Case A[\s\S]*decision: `candidate`/u);
  assert.match(acceptance, /four rules to\s+one invariant/u);
  assert.match(acceptance, /human approval/u);
  assert.match(acceptance, /Case B[\s\S]*decision: `no_candidate`/u);
  assert.match(acceptance, /net active-context change was zero/u);
  for (const proposalId of [
    "2026-07-01-visible-control-dispatch",
    "2026-07-02-cli-option-execution",
    "2026-07-03-extension-hook-invocation",
    "2026-07-04-scheduled-job-execution",
  ]) {
    assert.ok(acceptance.includes(proposalId));
  }
  assert.match(acceptance, /no raw conversation/iu);
  assert.match(acceptance, /no private absolute path/iu);
});

test("lifecycle transitions have one Coordinator-owned runtime contract", () => {
  const contract = read("skills/evolve/runtime/lifecycle-contract.mjs");
  const coordinator = read("skills/evolve/runtime/lifecycle.mjs");
  const outcome = read("skills/evolve/runtime/outcome.mjs");

  assert.match(contract, /function isLifecycleOutcome/u);
  assert.match(contract, /function deriveLifecycleReconciliationStatus/u);
  assert.match(coordinator, /from "\.\/lifecycle-contract\.mjs"/u);
  assert.match(coordinator, /deriveLifecycleReconciliationStatus/u);
  assert.match(outcome, /from "\.\/lifecycle-contract\.mjs"/u);
  assert.match(outcome, /isLifecycleOutcome/u);
  assert.doesNotMatch(outcome, /function validCoordinatorTransition/u);
});

test("the applied demo proposal is a valid v1 evolution aggregate", () => {
  const proposalPath =
    "demos/fake-js-repo/.agent-context/proposals/2026-07-09-greeting-contract.md";
  const source = read(proposalPath);
  const { data } = parseMarkdownFrontmatter(source, proposalPath);

  assert.equal(data.status, "applied", "demo must exercise the applied audit path");
  assert.match(source, /"requestedPolicy": "auto"/u);
  assert.match(source, /"policy": "auto"/u);
  assert.match(source, /^- decision: policy_auto$/mu);
  assert.match(source, /^  result: applied$/mu);
  assert.deepEqual(validateProposalDocument(source, proposalPath), []);
});

test("the demo Apply Attempt hashes describe its actual two-file transition", () => {
  const proposal = read(
    "demos/fake-js-repo/.agent-context/proposals/2026-07-09-greeting-contract.md",
  );
  const transitions = [
    {
      target: ".agent-context/PROJECT_PROFILE.md",
      repositoryPath: "demos/fake-js-repo/.agent-context/PROJECT_PROFILE.md",
      addedLine: "- Greeting output must preserve caller-provided names.\n",
    },
    {
      target: ".agent-context/checklists/coding.md",
      repositoryPath: "demos/fake-js-repo/.agent-context/checklists/coding.md",
      addedLine: "- Preserve caller-provided names in greeting output.\n",
    },
  ];

  for (const { target, repositoryPath, addedLine } of transitions) {
    const after = readFileSync(join(repositoryRoot, repositoryPath));
    const addition = Buffer.from(addedLine, "utf8");
    const additionAt = after.indexOf(addition);
    assert.notEqual(additionAt, -1, `${repositoryPath} is missing its demonstrated addition`);
    const before = Buffer.concat([
      after.subarray(0, additionAt),
      after.subarray(additionAt + addition.length),
    ]);
    assert.match(
      proposal,
      new RegExp(`${escapeRegExp(target)}:\\s+${sha256(before)}`, "u"),
      `proposal before_hash does not reconstruct ${target}`,
    );
    assert.match(
      proposal,
      new RegExp(`${escapeRegExp(target)}:\\s+${sha256(after)}`, "u"),
      `proposal after_hash does not match ${target}`,
    );
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function resolveTemplate(relativePath) {
  return join(repositoryRoot, "templates", ".agent-context", relativePath);
}

function containsFiles(path) {
  if (!existsSync(path)) return false;
  if (statSync(path).isFile()) return true;
  return readdirSync(path).some((entry) => containsFiles(join(path, entry)));
}
