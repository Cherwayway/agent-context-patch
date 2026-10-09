import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { byteLength, isIdentifier, isIsoDate } from "./text.mjs";
import { isRecord, parseFrontmatter, parseYaml } from "./yaml.mjs";

export const SCHEMA_VERSION = 2;
export const CONTEXT_DIR = ".agent-context";
export const RULE_KINDS = ["gate", "advice", "fact"];
export const APPLIES_TO_KEYS = ["repos", "paths", "ops", "skills"];
export const DEFAULT_CONFIG = Object.freeze({
  schema_version: SCHEMA_VERSION,
  kit_version: "0.0.0",
  write_policy: "auto",
  agents_file: "AGENTS.md",
  budgets: {
    catalog_bytes: 8192,
    hook_bytes: 160,
    body_bytes: 1500,
    select_bytes: 12288,
    similarity_block: 0.5,
  },
  state: { default_ttl_days: 14, max_ttl_days: 90 },
});

const CONFIG_KEYS = ["schema_version", "kit_version", "write_policy", "agents_file", "budgets", "state"];
const BUDGET_KEYS = ["catalog_bytes", "hook_bytes", "body_bytes", "select_bytes", "similarity_block"];
const STATE_KEYS = ["default_ttl_days", "max_ttl_days"];
const RULE_KEYS = new Set([
  "id", "hook", "kind", "applies_to", "supersedes", "source", "created",
  "consulted", "last_consulted", "missed", "needs_rewrite", "superseded_by", "retired",
]);
const REQUIRED_RULE_KEYS = ["id", "hook", "kind", "applies_to", "supersedes", "source", "created"];
const STATE_ENTRY_KEYS = new Set(["id", "expires", "repos", "text", "created"]);

/** Validate a parsed config document; returns { value, failures }. */
export function inspectConfig(value) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  expect(isRecord(value), "config must be a mapping");
  if (!isRecord(value)) return { failures };
  expectKeys(value, CONFIG_KEYS, "config", expect);
  expect(value.schema_version === SCHEMA_VERSION, `schema_version must be ${SCHEMA_VERSION}`);
  expect(typeof value.kit_version === "string" && /^\d+\.\d+\.\d+/u.test(value.kit_version), "kit_version must be a semantic version");
  expect(["auto", "propose"].includes(value.write_policy), "write_policy must be auto or propose");
  expect(typeof value.agents_file === "string" && /^[A-Za-z0-9._-]+$/u.test(value.agents_file), "agents_file must be a bare file name");
  expect(isRecord(value.budgets), "budgets must be a mapping");
  if (isRecord(value.budgets)) {
    expectKeys(value.budgets, BUDGET_KEYS, "budgets", expect);
    for (const key of BUDGET_KEYS.slice(0, 4)) {
      expect(Number.isInteger(value.budgets[key]) && value.budgets[key] > 0, `budgets.${key} must be a positive integer`);
    }
    expect(
      typeof value.budgets.similarity_block === "number" && value.budgets.similarity_block > 0 && value.budgets.similarity_block <= 1,
      "budgets.similarity_block must be within (0, 1]",
    );
  }
  expect(isRecord(value.state), "state must be a mapping");
  if (isRecord(value.state)) {
    expectKeys(value.state, STATE_KEYS, "state", expect);
    for (const key of STATE_KEYS) {
      expect(Number.isInteger(value.state[key]) && value.state[key] > 0, `state.${key} must be a positive integer`);
    }
    if (Number.isInteger(value.state.default_ttl_days) && Number.isInteger(value.state.max_ttl_days)) {
      expect(value.state.default_ttl_days <= value.state.max_ttl_days, "state.default_ttl_days must not exceed max_ttl_days");
    }
  }
  return { value, failures };
}

/** Validate a rule document {data, body} against budgets; returns failures. */
export function inspectRule(data, body, budgets, fileName) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  expect(isRecord(data), "frontmatter must be a mapping");
  if (!isRecord(data)) return failures;
  for (const key of Object.keys(data)) expect(RULE_KEYS.has(key), `unsupported key ${key}`);
  for (const key of REQUIRED_RULE_KEYS) expect(Object.hasOwn(data, key), `missing key ${key}`);
  expect(isIdentifier(data.id), "id must be a lowercase kebab-case identifier");
  if (fileName !== undefined) expect(data.id === fileName, "id must equal the file name");
  expect(typeof data.hook === "string" && data.hook.trim() !== "" && !/[\r\n]/u.test(data.hook), "hook must be one non-empty line");
  if (typeof data.hook === "string") {
    expect(byteLength(data.hook) <= budgets.hook_bytes, `hook exceeds ${budgets.hook_bytes} bytes`);
  }
  expect(RULE_KINDS.includes(data.kind), `kind must be one of ${RULE_KINDS.join(", ")}`);
  expect(isRecord(data.applies_to), "applies_to must be a mapping");
  if (isRecord(data.applies_to)) {
    for (const key of Object.keys(data.applies_to)) expect(APPLIES_TO_KEYS.includes(key), `applies_to.${key} is not supported`);
    for (const key of APPLIES_TO_KEYS) {
      const list = data.applies_to[key] ?? [];
      expect(Array.isArray(list) && list.every((item) => typeof item === "string" && item.trim() !== ""), `applies_to.${key} must be a list of strings`);
    }
  }
  expect(Array.isArray(data.supersedes) && data.supersedes.every(isIdentifier), "supersedes must be a list of identifiers");
  expect(typeof data.source === "string" && data.source.trim() !== "", "source must name the proposal or origin");
  expect(isIsoDate(data.created), "created must be an ISO date");
  for (const key of ["consulted", "missed"]) {
    if (Object.hasOwn(data, key)) expect(Number.isInteger(data[key]) && data[key] >= 0, `${key} must be a non-negative integer`);
  }
  if (Object.hasOwn(data, "last_consulted")) expect(data.last_consulted === null || isIsoDate(data.last_consulted), "last_consulted must be null or an ISO date");
  if (Object.hasOwn(data, "needs_rewrite")) expect(typeof data.needs_rewrite === "boolean", "needs_rewrite must be boolean");
  if (Object.hasOwn(data, "superseded_by")) expect(isIdentifier(data.superseded_by), "superseded_by must be an identifier");
  if (Object.hasOwn(data, "retired")) expect(isIsoDate(data.retired), "retired must be an ISO date");
  expect(typeof body === "string", "body must be text");
  if (typeof body === "string") expect(byteLength(body) <= budgets.body_bytes, `body exceeds ${budgets.body_bytes} bytes`);
  return failures;
}

export function inspectStateEntry(entry, stateConfig, today) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  expect(isRecord(entry), "state entry must be a mapping");
  if (!isRecord(entry)) return failures;
  for (const key of Object.keys(entry)) expect(STATE_ENTRY_KEYS.has(key), `unsupported key ${key}`);
  expect(isIdentifier(entry.id), "id must be a lowercase kebab-case identifier");
  expect(isIsoDate(entry.expires), "expires must be an ISO date");
  expect(typeof entry.text === "string" && entry.text.trim() !== "" && !/[\r\n]/u.test(entry.text), "text must be one non-empty line");
  if (typeof entry.text === "string") expect(byteLength(entry.text) <= 240, "text exceeds 240 bytes");
  if (Object.hasOwn(entry, "repos")) {
    expect(Array.isArray(entry.repos) && entry.repos.every((item) => typeof item === "string"), "repos must be a list of strings");
  }
  if (Object.hasOwn(entry, "created")) expect(isIsoDate(entry.created), "created must be an ISO date");
  if (isIsoDate(entry.expires) && today !== undefined && stateConfig) {
    const limit = Date.parse(`${today}T00:00:00Z`) + stateConfig.max_ttl_days * 86_400_000;
    expect(Date.parse(`${entry.expires}T00:00:00Z`) <= limit, `expires exceeds max_ttl_days (${stateConfig.max_ttl_days})`);
  }
  return failures;
}

export function normalizeRule(data) {
  const applies = data.applies_to ?? {};
  return {
    id: data.id,
    hook: data.hook.trim(),
    kind: data.kind,
    applies_to: {
      repos: [...(applies.repos ?? [])],
      paths: [...(applies.paths ?? [])],
      ops: [...(applies.ops ?? [])],
      skills: [...(applies.skills ?? [])],
    },
    supersedes: [...(data.supersedes ?? [])],
    source: data.source,
    created: data.created,
    consulted: data.consulted ?? 0,
    last_consulted: data.last_consulted ?? null,
    missed: data.missed ?? 0,
    ...(data.needs_rewrite ? { needs_rewrite: true } : {}),
  };
}

export function contextPath(workspaceRoot, ...segments) {
  return join(resolve(workspaceRoot), CONTEXT_DIR, ...segments);
}

/**
 * Load and validate a Schema 2 workspace. Returns
 * { status: "ok", ... } or { status: "invalid" | "missing", failures }.
 */
export async function loadWorkspace(workspaceRoot, { today } = {}) {
  const root = resolve(workspaceRoot);
  const contextRoot = join(root, CONTEXT_DIR);
  const configPath = join(contextRoot, "config.yml");
  const configSource = await readTextMaybe(configPath);
  if (configSource === undefined) return { status: "missing", failures: [`${CONTEXT_DIR}/config.yml not found`] };

  let configValue;
  try {
    configValue = parseYaml(configSource, "config.yml");
  } catch (error) {
    return { status: "invalid", failures: [error.message] };
  }
  if (configValue?.schema_version !== SCHEMA_VERSION) {
    return {
      status: "invalid",
      schemaVersion: configValue?.schema_version,
      failures: [`config.yml schema_version is ${String(configValue?.schema_version)}; expected ${SCHEMA_VERSION}`],
    };
  }
  const config = inspectConfig(configValue);
  if (config.failures.length > 0) return { status: "invalid", failures: config.failures.map((message) => `config.yml: ${message}`) };

  const failures = [];
  const rules = [];
  const rulesRoot = join(contextRoot, "rules");
  for (const fileName of await listMarkdown(rulesRoot)) {
    const path = join(rulesRoot, fileName);
    const source = await readFile(path, "utf8");
    let parsed;
    try {
      parsed = parseFrontmatter(source, `rules/${fileName}`);
    } catch (error) {
      failures.push(error.message);
      continue;
    }
    const body = parsed.body.replace(/^\n+/u, "").replace(/\s+$/u, "");
    const ruleFailures = inspectRule(parsed.data, body, config.value.budgets, basename(fileName, ".md"));
    if (ruleFailures.length > 0) {
      failures.push(...ruleFailures.map((message) => `rules/${fileName}: ${message}`));
      continue;
    }
    rules.push({ ...normalizeRule(parsed.data), body, path, raw: source });
  }
  const seen = new Set();
  for (const rule of rules) {
    if (seen.has(rule.id)) failures.push(`rules/${rule.id}.md: duplicate id`);
    seen.add(rule.id);
  }

  const statePath = join(contextRoot, "STATE.yml");
  const stateSource = await readTextMaybe(statePath);
  let state = [];
  if (stateSource !== undefined) {
    try {
      const parsedState = parseYaml(stateSource, "STATE.yml");
      const entries = Array.isArray(parsedState) ? parsedState : isRecord(parsedState) && Object.keys(parsedState).length === 0 ? [] : undefined;
      if (entries === undefined) failures.push("STATE.yml must be a list of entries");
      else {
        for (const [index, entry] of entries.entries()) {
          const entryFailures = inspectStateEntry(entry, undefined, undefined);
          if (entryFailures.length > 0) failures.push(...entryFailures.map((message) => `STATE.yml[${index}]: ${message}`));
        }
        state = entries.map((entry) => ({
          id: entry.id,
          expires: entry.expires,
          text: entry.text,
          repos: [...(entry.repos ?? [])],
          ...(entry.created ? { created: entry.created } : {}),
        }));
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  const stateIds = new Set();
  for (const entry of state) {
    if (stateIds.has(entry.id)) failures.push(`STATE.yml: duplicate id ${entry.id}`);
    stateIds.add(entry.id);
  }

  if (failures.length > 0) return { status: "invalid", failures };

  const profile = (await readTextMaybe(join(contextRoot, "PROFILE.md"))) ?? "";
  return {
    status: "ok",
    workspaceRoot: root,
    contextRoot,
    config: config.value,
    rules: rules.sort((left, right) => left.id.localeCompare(right.id)),
    state,
    stateRaw: stateSource,
    stateArchive: (await readTextMaybe(join(contextRoot, "archive", "state.yml"))) ?? "",
    archivedRuleIds: (await listMarkdown(join(contextRoot, "archive", "rules"))).map(file => basename(file, ".md")),
    profile,
    today: today ?? new Date().toISOString().slice(0, 10),
  };
}

export async function listMarkdown(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function readTextMaybe(path) {
  try {
    const fileStat = await lstat(path);
    if (!fileStat.isFile()) return undefined;
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function expectKeys(value, allowed, path, expect) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  expect(extras.length === 0, `${path} contains unsupported keys: ${extras.join(", ")}`);
  expect(missing.length === 0, `${path} is missing required keys: ${missing.join(", ")}`);
}
