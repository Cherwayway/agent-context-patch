import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "./json-schema-subset.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const reviewRunnerPath =
  "tests/acceptance/context-effectiveness-review.runner.json";
const impactRunnerPath = "tests/acceptance/context-rule-impact.runner.json";

test("stable rule lineage is an incremental schema-1 Markdown convention", () => {
  const adr = read("docs/adr/0007-agent-owned-context-effectiveness-review.md");
  const marker = adr.match(
    /<!-- acp-rule: ([a-z0-9-]+#([1-9][0-9]*)); source: ([a-z0-9-]+); subsumes: ([a-z0-9,#-]+) -->/iu,
  );

  assert.ok(marker, "ADR must contain one mechanically parseable lineage marker");
  assert.equal(marker[1], `${marker[3]}#${marker[2]}`);
  assert.equal(marker[4], "none");
  assert.match(adr, /existing unmarked rules remain valid/iu);
  assert.match(adr, /Workspace Schema 1 compatible/iu);
});

test("bounded effectiveness review has a content-safe fresh-Agent contract", () => {
  const runner = readJson(reviewRunnerPath);
  const schema = readJson(runner.resultSchemaPath);

  validateRunner(runner, 2);
  assert.ok(runner.forbiddenInputs.includes("raw task transcripts"));
  assert.equal(schema.properties?.schemaVersion?.const, 1);
  assert.deepEqual(
    new Set(schema.properties.ruleReviews.items.properties.evidenceState.enum),
    new Set([
      "material_use",
      "loaded_only",
      "relevant_but_missed",
      "not_applicable",
      "unknown",
    ]),
  );
});

test("fresh Agents distinguish material use, loaded-only, recurrence, non-applicability, and unknowns", () => {
  const runner = readJson(reviewRunnerPath);
  const fixture = readJson(
    "tests/acceptance/fixtures/context-effectiveness-review.json",
  );
  const schema = readJson(runner.resultSchemaPath);
  const casesById = new Map(fixture.cases.map((scenario) => [scenario.id, scenario]));

  const results = runner.runs.map(({ caseId, resultPath }) => {
    const result = readJson(resultPath);
    assert.deepEqual(validateJsonSchema(result, schema), []);
    validateBoundResult(result, runner, caseId);
    assert.deepEqual(result.privacy, {
      rawTaskStored: false,
      fullTraceStored: false,
      absolutePathStored: false,
      secretsStored: false,
    });

    const scenario = casesById.get(caseId);
    assert.ok(scenario);
    assert.deepEqual(
      new Set(result.ruleReviews.map(({ ruleId }) => ruleId)),
      new Set(scenario.activeRules.map(({ id }) => id)),
      "fresh review must classify every active rule exactly once",
    );
    return result;
  });

  const mixed = results.find(({ caseId }) => caseId === "mixed-bounded-evidence");
  const absence = results.find(({ caseId }) => caseId === "absence-is-not-disuse");

  assert.equal(
    stateFor(mixed, "2026-07-10-isolated-verification#1"),
    "material_use",
  );
  assert.equal(
    stateFor(mixed, "2026-07-12-context-index-before-claims#1"),
    "relevant_but_missed",
  );
  assert.equal(
    stateFor(mixed, "2026-07-14-release-check#1"),
    "not_applicable",
  );
  assert.equal(
    stateFor(mixed, "2026-07-16-rollback-copy#1"),
    "unknown",
  );
  assert.equal(
    stateFor(mixed, "2026-07-18-full-suite-before-merge#1"),
    "loaded_only",
  );
  assert.equal(mixed.semanticReviewScheduled, true);
  assert.equal(mixed.cleanupProposalWouldBeCreated, true);

  assert.equal(
    stateFor(absence, "2026-07-20-destructive-target-check#1"),
    "unknown",
  );
  assert.equal(
    stateFor(absence, "2026-07-21-release-rollback#1"),
    "not_applicable",
  );
  assert.equal(absence.semanticReviewScheduled, false);
  assert.equal(absence.cleanupProposalWouldBeCreated, false);
  for (const review of [...mixed.ruleReviews, ...absence.ruleReviews]) {
    assert.equal(review.cleanupRequiresApproval, true);
    assert.ok(review.reason.length >= 20);
  }
});

test("paired fresh Agents show scoped rule impact without over-constraining prose", () => {
  const runner = readJson(impactRunnerPath);
  const schema = readJson(runner.resultSchemaPath);
  validateImpactRunner(runner);
  const results = new Map();

  for (const run of runner.runs) {
    const fixture = readJson(run.inputPath);
    const result = readJson(run.resultPath);
    assert.deepEqual(validateJsonSchema(result, schema), []);
    validateBoundResult(result, runner, run.caseId, [run.inputPath]);
    assert.equal(result.variant, run.variant);
    assert.equal(fixture.caseId, run.caseId);
    assert.equal(fixture.variant, run.variant);
    assert.deepEqual(result.privacy, {
      rawTraceStored: false,
      absolutePathStored: false,
      secretsStored: false,
    });
    assert.ok(result.reason.length >= 20);

    const action = fixture.actions[result.selectedAction];
    assert.ok(action, "result must select a fixture action");
    const meetsOutcome =
      action[fixture.requiredOutcomeField] === fixture.requiredOutcomeValue;
    results.set(`${run.caseId}:${run.variant}`, { result, meetsOutcome });
  }

  assert.equal(
    results.get("package-metadata-change:baseline").meetsOutcome,
    false,
    "the no-rule baseline should expose the package-boundary failure",
  );
  assert.equal(
    results.get("package-metadata-change:candidate").meetsOutcome,
    true,
    "the candidate rule should select verification that observes the package boundary",
  );

  const proseBaseline = results.get("prose-only-change:baseline");
  const proseCandidate = results.get("prose-only-change:candidate");
  assert.equal(proseBaseline.meetsOutcome, true);
  assert.equal(proseCandidate.meetsOutcome, true);
  assert.equal(proseBaseline.result.selectedAction, "docs_check");
  assert.equal(proseCandidate.result.selectedAction, "docs_check");
});

test("effectiveness acceptance prose is derived from retained structured results", () => {
  const acceptance = read("docs/acceptance/2026-08-11-context-effectiveness.md");

  assert.match(acceptance, /^- Result: PASS$/mu);
  for (const runnerPath of [reviewRunnerPath, impactRunnerPath]) {
    const runner = readJson(runnerPath);
    for (const run of runner.runs) {
      const result = readJson(run.resultPath);
      assert.ok(acceptance.includes(`\`${run.resultPath}\``));
      assert.ok(acceptance.includes(`\`${run.caseId}\``));
      if ("variant" in run) {
        assert.ok(acceptance.includes(`\`${run.variant}\``));
        assert.ok(acceptance.includes(`\`${result.selectedAction}\``));
      }
    }
  }
  assert.match(acceptance, /no raw task or conversation/iu);
  assert.match(acceptance, /no private\s+absolute path/iu);
});

function validateRunner(runner, expectedRuns) {
  assert.equal(runner.schemaVersion, 1);
  assert.deepEqual(runner.inputDigest, {
    algorithm: "sha256",
    textNormalization: "lf",
  });
  assert.equal(runner.runs.length, expectedRuns);
  for (const path of [
    ...runner.allowedInputs,
    ...runner.harnessInputs,
    runner.resultSchemaPath,
    ...runner.runs.map(({ resultPath }) => resultPath),
  ]) {
    assert.match(path, /^[a-z0-9._/-]+$/iu);
    assert.equal(path.includes(".."), false);
    assert.ok(existsSync(join(repositoryRoot, path)), `missing runner input: ${path}`);
  }
}

function validateImpactRunner(runner) {
  assert.equal(runner.schemaVersion, 1);
  assert.deepEqual(runner.inputDigest, {
    algorithm: "sha256",
    textNormalization: "lf",
  });
  assert.equal(runner.runs.length, 4);
  assert.deepEqual(
    new Set(runner.runs.map(({ inputPath }) => inputPath)),
    new Set(runner.caseInputs),
  );
  for (const path of [
    ...runner.caseInputs,
    ...runner.harnessInputs,
    runner.resultSchemaPath,
    ...runner.runs.map(({ resultPath }) => resultPath),
  ]) {
    assert.match(path, /^[a-z0-9._/-]+$/iu);
    assert.equal(path.includes(".."), false);
    assert.ok(existsSync(join(repositoryRoot, path)), `missing runner input: ${path}`);
  }
}

function validateBoundResult(result, runner, caseId, allowedInputs = runner.allowedInputs) {
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.caseId, caseId);
  assert.equal(result.freshContext, true);
  assert.deepEqual(
    result.inputDigests,
    [...allowedInputs, ...runner.harnessInputs].map((path) => ({
      path,
      digest: sha256(read(path)),
    })),
    "fresh-Agent result is not bound to the current acceptance inputs",
  );
  assert.equal(result.repositoryMutated, false);
}

function stateFor(result, ruleId) {
  return result.ruleReviews.find((review) => review.ruleId === ruleId)?.evidenceState;
}

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function sha256(value) {
  const canonicalText = value.replace(/\r\n?/gu, "\n");
  return createHash("sha256").update(canonicalText).digest("hex");
}
