const KIT_VERSION = "0.2.0";
const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const TOP_LEVEL_KEYS = [
  "schema_version",
  "created_with_kit_version",
  "last_migrated_with_kit_version",
  "context_write_policy",
  "enabled_domains",
  "budgets",
  "privacy",
];
const BUDGET_KEYS = ["active_context", "single_proposal", "pending_proposals"];
const PRIVACY_KEYS = [
  "raw_conversation_stored",
  "full_logs_stored",
  "secrets_stored",
  "customer_data_stored",
  "absolute_user_paths_stored",
];

export function inspectV1ConfigDocument(source, label = "config") {
  let value;
  try {
    value = parseYamlSubset(source, label);
  } catch (error) {
    return { value: undefined, failures: [error.message] };
  }

  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(`${label}: ${message}`);
  };

  expect(isRecord(value), "document must be a mapping");
  if (!isRecord(value)) return { value, failures };

  expectExactKeys(value, TOP_LEVEL_KEYS, "config", expect);
  expect(value.schema_version === 1, "schema_version must be 1");
  expect(
    value.created_with_kit_version === KIT_VERSION,
    `created_with_kit_version must identify kit version ${KIT_VERSION}`,
  );
  expect(
    value.last_migrated_with_kit_version === null ||
      value.last_migrated_with_kit_version === KIT_VERSION,
    `last_migrated_with_kit_version must be null or ${KIT_VERSION}`,
  );
  expect(
    value.context_write_policy === "propose" || value.context_write_policy === "auto",
    "context_write_policy must be propose or auto",
  );

  const domains = value.enabled_domains;
  expect(
    Array.isArray(domains) &&
      domains.every((domain) => typeof domain === "string" && DOMAIN_PATTERN.test(domain)),
    "enabled_domains must be a list of domain ids",
  );
  if (Array.isArray(domains)) {
    expect(new Set(domains).size === domains.length, "enabled_domains must not contain duplicates");
  }

  expect(isRecord(value.budgets), "budgets is missing");
  if (isRecord(value.budgets)) {
    expectExactKeys(value.budgets, BUDGET_KEYS, "budgets", expect);
    checkBoundedBudget(value.budgets.active_context, "budgets.active_context", "lines", expect);
    checkWarningBudget(value.budgets.single_proposal, "budgets.single_proposal", "lines", expect);
    checkBoundedBudget(value.budgets.pending_proposals, "budgets.pending_proposals", "count", expect);
  }

  expect(isRecord(value.privacy), "privacy is missing");
  if (isRecord(value.privacy)) {
    expectExactKeys(value.privacy, PRIVACY_KEYS, "privacy", expect);
    for (const key of PRIVACY_KEYS) {
      expect(value.privacy[key] === false, `privacy.${key} must be false`);
    }
  }

  return { value, failures };
}

export function validateV1ConfigDocument(source, label = "config") {
  return inspectV1ConfigDocument(source, label).failures;
}

export function parseYamlSubset(source, label = "YAML") {
  if (typeof source !== "string") throw new TypeError(`${label}: source must be a string`);
  const lines = source
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .map((raw, index) => {
      if (raw.includes("\t")) {
        throw new Error(`${label}:${index + 1}: tabs are not supported`);
      }
      const withoutComment = stripInlineComment(raw);
      return {
        line: index + 1,
        indent: withoutComment.length - withoutComment.trimStart().length,
        content: withoutComment.trim(),
      };
    })
    .filter(({ content }) => content !== "");

  if (lines.length === 0) return createMapping();
  if (lines[0].indent !== 0) {
    throw new Error(`${label}:${lines[0].line}: the document must start at indentation zero`);
  }
  const [value, nextIndex] = parseBlock(lines, 0, 0, label);
  if (nextIndex !== lines.length) {
    throw new Error(`${label}:${lines[nextIndex].line}: unexpected indentation or unsupported syntax`);
  }
  return value;
}

export function parseMarkdownFrontmatter(source, label = "Markdown") {
  const normalized = source.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error(`${label}: missing opening frontmatter delimiter`);
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`${label}: missing closing frontmatter delimiter`);
  }
  return {
    data: parseYamlSubset(normalized.slice(4, end), `${label} frontmatter`),
    body: normalized.slice(end + 5),
  };
}

function checkBudgetBase(budget, path, unit, expect) {
  expect(isRecord(budget), `${path} is missing`);
  if (!isRecord(budget)) return false;
  expect(budget.unit === unit, `${path}.unit must be ${unit}`);
  expect(Number.isInteger(budget.warn) && budget.warn > 0, `${path}.warn must be positive`);
  return true;
}

function checkBoundedBudget(budget, path, unit, expect) {
  if (!checkBudgetBase(budget, path, unit, expect)) return;
  expectExactKeys(budget, ["unit", "warn", "block_auto"], path, expect);
  expect(
    Number.isInteger(budget.block_auto) && budget.block_auto > budget.warn,
    `${path}.block_auto must be greater than warn`,
  );
}

function checkWarningBudget(budget, path, unit, expect) {
  if (!checkBudgetBase(budget, path, unit, expect)) return;
  expectExactKeys(budget, ["unit", "warn"], path, expect);
  expect(!Object.hasOwn(budget, "block_auto"), `${path}.block_auto is not allowed`);
}

function expectExactKeys(value, allowed, path, expect) {
  if (!isRecord(value)) return;
  const actual = Object.keys(value);
  const extras = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  expect(extras.length === 0, `${path} contains unsupported keys: ${extras.join(", ")}`);
  expect(missing.length === 0, `${path} is missing required keys: ${missing.join(", ")}`);
}

function parseBlock(lines, startIndex, indent, label) {
  const isSequence = lines[startIndex].content.startsWith("- ") || lines[startIndex].content === "-";
  return isSequence
    ? parseSequence(lines, startIndex, indent, label)
    : parseMapping(lines, startIndex, indent, label);
}

function parseSequence(lines, startIndex, indent, label) {
  const values = [];
  let index = startIndex;
  while (index < lines.length && lines[index].indent === indent) {
    const { content, line } = lines[index];
    if (!(content.startsWith("- ") || content === "-")) break;
    const rawValue = content.slice(1).trim();
    if (rawValue !== "") {
      values.push(parseScalar(rawValue, label, line));
      index += 1;
      continue;
    }
    const child = lines[index + 1];
    if (!child || child.indent <= indent) {
      throw new Error(`${label}:${line}: empty sequence item`);
    }
    const [value, nextIndex] = parseBlock(lines, index + 1, child.indent, label);
    values.push(value);
    index = nextIndex;
  }
  return [values, index];
}

function parseMapping(lines, startIndex, indent, label) {
  const value = createMapping();
  let index = startIndex;
  while (index < lines.length && lines[index].indent === indent) {
    const { content, line } = lines[index];
    const match = content.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/u);
    if (!match) break;
    const [, key, rawValue = ""] = match;
    if (Object.hasOwn(value, key)) {
      throw new Error(`${label}:${line}: duplicate key ${key}`);
    }
    if (rawValue !== "") {
      value[key] = parseScalar(rawValue, label, line);
      index += 1;
      continue;
    }
    const child = lines[index + 1];
    if (!child || child.indent <= indent) {
      value[key] = createMapping();
      index += 1;
      continue;
    }
    const [childValue, nextIndex] = parseBlock(lines, index + 1, child.indent, label);
    value[key] = childValue;
    index = nextIndex;
  }
  return [value, index];
}

function createMapping() {
  return Object.create(null);
}

function parseScalar(rawValue, label, line) {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "null" || rawValue === "~") return null;
  if (/^-?(?:0|[1-9][0-9]*)$/u.test(rawValue)) return Number(rawValue);
  if (rawValue.startsWith("[")) {
    if (!rawValue.endsWith("]")) throw new Error(`${label}:${line}: unclosed inline list`);
    const inner = rawValue.slice(1, -1).trim();
    if (inner === "") return [];
    return splitInlineList(inner, label, line).map((part) => parseScalar(part, label, line));
  }
  if (rawValue.startsWith('"')) {
    if (!rawValue.endsWith('"')) throw new Error(`${label}:${line}: unclosed quoted string`);
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error(`${label}:${line}: invalid quoted string`);
    }
  }
  if (rawValue.startsWith("'")) {
    if (!rawValue.endsWith("'")) throw new Error(`${label}:${line}: unclosed quoted string`);
    return rawValue.slice(1, -1).replaceAll("''", "'");
  }
  return rawValue;
}

function splitInlineList(value, label, line) {
  const parts = [];
  let start = 0;
  let quote;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
    } else if (quote === "'") {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ",") {
      const part = value.slice(start, index).trim();
      if (!part) throw new Error(`${label}:${line}: empty inline list item`);
      parts.push(part);
      start = index + 1;
    }
  }
  if (quote) throw new Error(`${label}:${line}: unclosed quote in inline list`);
  const finalPart = value.slice(start).trim();
  if (!finalPart) throw new Error(`${label}:${line}: empty inline list item`);
  parts.push(finalPart);
  return parts;
}

function stripInlineComment(raw) {
  let quote;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
    } else if (quote === "'") {
      if (character === quote && raw[index + 1] === quote) index += 1;
      else if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/u.test(raw[index - 1]))) {
      return raw.slice(0, index).trimEnd();
    }
  }
  return raw;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
