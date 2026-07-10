import { parseYamlSubset } from "./yaml-subset.mjs";

const safePrivacy = {
  raw_conversation_stored: false,
  full_logs_stored: false,
  secrets_stored: false,
  customer_data_stored: false,
  absolute_user_paths_stored: false,
};

export function validateConfigDocument(source, label = "config") {
  let config;
  try {
    config = parseYamlSubset(source, label);
  } catch (error) {
    return [`${label}: ${error.message}`];
  }

  const failures = [];
  expect(config.schema_version === 1, "schema_version must be 1");
  expect(
    config.created_with_kit_version === "0.2.0",
    "created_with_kit_version must identify kit version 0.2.0",
  );
  expect(
    config.last_migrated_with_kit_version === null ||
      config.last_migrated_with_kit_version === "0.2.0",
    "last_migrated_with_kit_version must be null or the migration kit version",
  );
  expect(
    config.context_write_policy === "propose" || config.context_write_policy === "auto",
    "context_write_policy must be propose or auto",
  );
  expect(
    Array.isArray(config.enabled_domains) &&
      config.enabled_domains.every(
        (domain) => typeof domain === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(domain),
      ),
    "enabled_domains must be a list of domain ids",
  );
  checkBoundedBudget(config.budgets?.active_context, "budgets.active_context", "lines");
  checkWarningBudget(config.budgets?.single_proposal, "budgets.single_proposal", "lines");
  checkBoundedBudget(config.budgets?.pending_proposals, "budgets.pending_proposals", "count");
  expect(config.privacy && typeof config.privacy === "object", "privacy is missing");
  for (const key of Object.keys(safePrivacy)) {
    expect(config.privacy?.[key] === false, `privacy.${key} must be false`);
  }
  expect(
    config.privacy &&
      JSON.stringify(Object.keys(config.privacy).sort()) ===
        JSON.stringify(Object.keys(safePrivacy).sort()),
    "privacy contains unsupported keys",
  );

  return failures;

  function checkBudgetBase(budget, path, unit) {
    expect(budget && typeof budget === "object", `${path} is missing`);
    if (!budget || typeof budget !== "object") return false;
    expect(budget.unit === unit, `${path}.unit must be ${unit}`);
    expect(Number.isInteger(budget.warn) && budget.warn > 0, `${path}.warn must be positive`);
    return true;
  }

  function checkBoundedBudget(budget, path, unit) {
    if (!checkBudgetBase(budget, path, unit)) return;
    expect(
      Number.isInteger(budget.block_auto) && budget.block_auto > budget.warn,
      `${path}.block_auto must be greater than warn`,
    );
  }

  function checkWarningBudget(budget, path, unit) {
    if (!checkBudgetBase(budget, path, unit)) return;
    expect(!Object.hasOwn(budget, "block_auto"), `${path}.block_auto is not allowed`);
  }

  function expect(condition, message) {
    if (!condition) failures.push(`${label}: ${message}`);
  }
}
