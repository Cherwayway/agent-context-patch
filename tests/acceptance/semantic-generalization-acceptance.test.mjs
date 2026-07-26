import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "./json-schema-subset.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const runnerPath =
  "tests/acceptance/review-context-semantic-generalization.runner.json";

test("fresh-context semantic review has a reusable bounded runner contract", () => {
  const runner = readJson(runnerPath);
  const schema = readJson(runner.resultSchemaPath);

  assert.equal(runner.schemaVersion, 1);
  assert.deepEqual(runner.allowedInputs, [
    "skills/evolve/SKILL.md",
    "skills/evolve/references/cleanup-policy.md",
    "tests/acceptance/fixtures/review-context-semantic-generalization.json",
  ]);
  assert.ok(runner.forbiddenInputs.includes("GitHub issues"));
  assert.ok(runner.forbiddenInputs.includes("prior acceptance records"));
  assert.equal(runner.runs.length, 2);
  assert.deepEqual(
    new Set(runner.runs.map(({ caseId }) => caseId)),
    new Set(["case-a", "case-b"]),
  );

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

  assert.equal(schema.properties?.schemaVersion?.const, 1);
  for (const field of [
    "caseId",
    "freshContext",
    "inputDigests",
    "decision",
    "invariant",
    "includedRuleIds",
    "includedProposalIds",
    "excludedRuleIds",
    "excludedProposalIds",
    "preservedDomainDetails",
    "counterexamples",
    "behaviorLostIfApproved",
    "netActiveContextChange",
    "approvalRequired",
    "proposalWouldBeCreated",
    "repositoryMutated",
    "privacy",
  ]) {
    assert.ok(schema.required.includes(field), `result schema is missing: ${field}`);
  }
});

test("fresh Agents distinguish a cross-noun failure family from noun-level decoys", () => {
  const runner = readJson(runnerPath);
  const fixture = readJson(
    "tests/acceptance/fixtures/review-context-semantic-generalization.json",
  );
  const resultSchema = readJson(runner.resultSchemaPath);
  const casesById = new Map(fixture.cases.map((scenario) => [scenario.id, scenario]));
  const results = runner.runs.map(({ caseId, resultPath }) => {
    const result = readJson(resultPath);
    assert.deepEqual(validateJsonSchema(result, resultSchema), []);
    assert.match(
      validateJsonSchema({ ...result, rawTrace: "must be rejected" }, resultSchema)
        .join("\n"),
      /additional property.*rawTrace/iu,
    );
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.caseId, caseId);
    assert.equal(result.freshContext, true);
    assert.deepEqual(
      result.inputDigests,
      Object.fromEntries(
        [...runner.allowedInputs, ...runner.harnessInputs].map((path) => [
          path,
          sha256(read(path)),
        ]),
      ),
      "fresh-Agent result is not bound to the current semantic inputs",
    );
    assert.equal(result.repositoryMutated, false);
    assert.deepEqual(result.privacy, {
      rawTraceStored: false,
      absolutePathStored: false,
      secretsStored: false,
    });
    return result;
  });
  const candidate = results.find(({ decision }) => decision === "candidate");
  const noCandidate = results.find(({ decision }) => decision === "no_candidate");

  assert.ok(candidate, "fresh review did not produce a positive candidate");
  assert.ok(noCandidate, "fresh review did not preserve a negative case");
  validatePartition(candidate, casesById.get(candidate.caseId));
  validatePartition(noCandidate, casesById.get(noCandidate.caseId));

  assertTestableInvariant(candidate.invariant);
  assert.ok(candidate.includedProposalIds.length >= 4);
  assert.ok(candidate.excludedProposalIds.length >= 2);
  const candidateCase = casesById.get(candidate.caseId);
  const includedProposals = candidate.includedProposalIds.map((id) =>
    candidateCase.appliedProposals.find((proposal) => proposal.id === id),
  );
  assert.ok(
    new Set(includedProposals.map(({ surface }) => surface)).size >= 4,
    "candidate did not generalize across implementation surfaces",
  );
  assert.ok(
    new Set(includedProposals.map(({ failureStage }) => failureStage)).size >= 4,
    "fixture still leaks one repeated failure-stage label",
  );
  assert.deepEqual(
    new Set(candidate.preservedDomainDetails.map(({ proposalId }) => proposalId)),
    new Set(candidate.includedProposalIds),
  );
  assert.ok(candidate.counterexamples.length >= 2);
  assert.equal(candidate.approvalRequired, true);
  assert.equal(candidate.proposalWouldBeCreated, true);
  assert.deepEqual(candidate.netActiveContextChange, {
    replacedRuleCount: candidate.includedRuleIds.length,
    replacementRuleCount: 1,
    delta: 1 - candidate.includedRuleIds.length,
  });

  assert.equal(noCandidate.invariant, null);
  assert.deepEqual(noCandidate.includedRuleIds, []);
  assert.deepEqual(noCandidate.includedProposalIds, []);
  assert.equal(noCandidate.approvalRequired, false);
  assert.equal(noCandidate.proposalWouldBeCreated, false);
  assert.deepEqual(noCandidate.netActiveContextChange, {
    replacedRuleCount: 0,
    replacementRuleCount: 0,
    delta: 0,
  });

  const neutralSources = fixture.cases
    .flatMap(({ currentSources }) => currentSources)
    .join(" ");
  assert.doesNotMatch(
    neutralSources,
    /exposed action|reachable execution path|promised effect|must remain separate/iu,
    "fixture current sources disclose an expected review answer",
  );
});

test("the prose acceptance record is derived from structured fresh-Agent results", () => {
  const acceptance = read(
    "docs/acceptance/2026-07-26-semantic-generalization.md",
  );
  const runner = readJson(runnerPath);

  assert.match(acceptance, /^- Result: PASS$/mu);
  for (const { caseId, resultPath } of runner.runs) {
    const result = readJson(resultPath);
    assert.ok(acceptance.includes(`\`${resultPath}\``));
    assert.ok(acceptance.includes(`\`${caseId}\``));
    assert.ok(acceptance.includes(`\`${result.decision}\``));
  }
  assert.match(acceptance, /no raw conversation/iu);
  assert.match(acceptance, /no private absolute path/iu);
});

function validatePartition(result, scenario) {
  assert.ok(scenario, `missing fixture case: ${result.caseId}`);
  const ruleIds = scenario.activeRules.map(({ id }) => id);
  const proposalIds = scenario.appliedProposals.map(({ id }) => id);

  assertDisjointPartition(
    result.includedRuleIds,
    result.excludedRuleIds,
    ruleIds,
    "rule",
  );
  assertDisjointPartition(
    result.includedProposalIds,
    result.excludedProposalIds,
    proposalIds,
    "proposal",
  );
  assert.equal(typeof result.behaviorLostIfApproved, "string");
  assert.ok(result.behaviorLostIfApproved.length > 0);
}

function assertDisjointPartition(included, excluded, expected, label) {
  assert.equal(new Set(included).size, included.length);
  assert.equal(new Set(excluded).size, excluded.length);
  for (const id of included) {
    assert.equal(excluded.includes(id), false, `${label} appears in both partitions: ${id}`);
  }
  assert.deepEqual(
    new Set([...included, ...excluded]),
    new Set(expected),
    `${label} partition does not cover the fixture`,
  );
}

function assertTestableInvariant(invariant) {
  assert.ok(invariant && typeof invariant === "object");
  for (const field of ["when", "require", "verify"]) {
    assert.equal(typeof invariant[field], "string");
    assert.ok(invariant[field].length >= 20);
  }
}

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
