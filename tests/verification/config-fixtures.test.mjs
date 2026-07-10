import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateConfigDocument } from "./config-contract.mjs";

const fixtureRoot = fileURLToPath(new URL("fixtures/config", import.meta.url));

test("valid config fixture satisfies the v1 envelope", () => {
  assert.deepEqual(validateConfigDocument(read("valid.yml"), "valid.yml"), []);
});

test("migrated v1 config records the kit version that performed migration", () => {
  const migrated = read("valid.yml").replace(
    "last_migrated_with_kit_version: null",
    'last_migrated_with_kit_version: "0.2.0"',
  );
  assert.deepEqual(validateConfigDocument(migrated, "migrated config"), []);
});

for (const [fixture, expectedFailure] of [
  ["invalid-policy.yml", "context_write_policy"],
  ["invalid-budget.yml", "block_auto"],
  ["invalid-single-proposal.yml", "single_proposal.block_auto"],
  ["invalid-unit.yml", "pending_proposals.unit"],
]) {
  test(`${fixture} is rejected`, () => {
    const failures = validateConfigDocument(read(fixture), fixture);
    assert.ok(
      failures.some((failure) => failure.includes(expectedFailure)),
      `expected a ${expectedFailure} failure, received:\n${failures.join("\n")}`,
    );
  });
}

function read(name) {
  return readFileSync(join(fixtureRoot, name), "utf8");
}
