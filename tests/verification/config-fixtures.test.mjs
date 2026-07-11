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

test("v1 compatibility accepts valid historical kit versions", () => {
  const historical = read("valid.yml")
    .replace('created_with_kit_version: "0.2.0"', 'created_with_kit_version: "0.1.0"')
    .replace(
      "last_migrated_with_kit_version: null",
      'last_migrated_with_kit_version: "0.1.1-beta.2+build.7"',
    );

  assert.deepEqual(validateConfigDocument(historical, "historical v1 config"), []);
});

for (const [field, invalidVersion] of [
  ["created_with_kit_version", "v0.2.0"],
  ["last_migrated_with_kit_version", "0.2"],
]) {
  test(`${field} must contain a valid semantic version`, () => {
    const invalid = read("valid.yml").replace(
      `${field}: ${field === "last_migrated_with_kit_version" ? "null" : '"0.2.0"'}`,
      `${field}: "${invalidVersion}"`,
    );
    const failures = validateConfigDocument(invalid, `${field} invalid`);

    assert.ok(
      failures.some((failure) => failure.includes(`${field} must be`)),
      `expected a ${field} semantic-version failure, received:\n${failures.join("\n")}`,
    );
  });
}

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
