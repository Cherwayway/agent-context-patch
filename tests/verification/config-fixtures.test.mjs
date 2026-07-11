import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseYamlSubset } from "../../skills/evolve/runtime/config.mjs";
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

test("quoted policy and inline domain lists are valid v1 config syntax", () => {
  assert.deepEqual(
    validateConfigDocument(read("valid-auto-inline.yml"), "valid-auto-inline.yml"),
    [],
  );
});

test("YAML mappings expose dangerous keys without changing their prototype", () => {
  const parsed = parseYamlSubset(read("invalid-dangerous-key.yml"), "invalid-dangerous-key.yml");

  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(parsed.polluted, undefined);
  for (const key of ["__proto__", "constructor", "prototype", "unexpected"]) {
    assert.equal(Object.hasOwn(parsed, key), true);
    assert.equal(Object.getPrototypeOf(parsed[key]), null);
    assert.equal(parsed[key].polluted, true);
  }
});

for (const [fixture, expectedFailure] of [
  ["invalid-policy.yml", "context_write_policy"],
  ["invalid-budget.yml", "block_auto"],
  ["invalid-single-proposal.yml", "single_proposal.block_auto"],
  ["invalid-unit.yml", "pending_proposals.unit"],
  ["invalid-duplicate-domain.yml", "enabled_domains must not contain duplicates"],
  ["invalid-extra-field.yml", "unsupported keys"],
  [
    "invalid-dangerous-key.yml",
    "unsupported keys: __proto__, constructor, prototype, unexpected",
  ],
  ["invalid-missing-envelope.yml", "privacy is missing"],
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
