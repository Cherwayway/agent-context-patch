import { byteLength, globMatch, isIdentifier, sha256Text } from "./text.mjs";
import { APPLIES_TO_KEYS } from "./workspace.mjs";

const SIGNATURE_KEYS = new Set([...APPLIES_TO_KEYS, "ids"]);

/**
 * Validate a task signature. Selection resolves known repo path prefixes only.
 */
export function normalizeSignature(signature = {}) {
  const failures = [];
  if (signature === null || typeof signature !== "object" || Array.isArray(signature)) {
    return { failures: ["signature must be an object"] };
  }
  for (const key of Object.keys(signature)) {
    if (!SIGNATURE_KEYS.has(key)) failures.push(`unsupported signature key ${key}`);
  }
  const lists = {};
  for (const key of SIGNATURE_KEYS) {
    const list = signature[key] ?? [];
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string" && item.trim() !== "" && !/[\r\n]/u.test(item))) {
      failures.push(`signature.${key} must be a list of strings`);
      lists[key] = [];
      continue;
    }
    if (list.length > 64) failures.push(`signature.${key} has more than 64 entries`);
    lists[key] = [...new Set(list.map((item) => item.trim().replaceAll("\\", "/")))];
  }
  for (const id of lists.ids) if (!isIdentifier(id)) failures.push(`signature.ids contains an invalid identifier: ${id}`);
  const value = {
    repos: lists.repos,
    paths: lists.paths.map((path) => path.replace(/^\.\//u, "")),
    ops: lists.ops,
    skills: lists.skills,
    ids: lists.ids,
  };
  return { failures, value };
}

/** Repo filter plus OR matching of paths/ops/skills; globals and explicit ids.
 * Missing repo scope is ambiguous. Pages never silently exceed the byte budget.
 */
export function selectRules(workspace, signature, { cursor, bytes: requestedBytes } = {}) {
  const normalized = normalizeSignature(signature);
  if (normalized.failures.length > 0) return { status: "invalid", complete: false, failures: normalized.failures };
  const task = normalized.value;
  const knownRepos = new Set(workspace.rules.flatMap(rule => rule.applies_to.repos));
  if (!task.repos.length) task.repos = [...new Set(task.paths.map(path => path.split("/")[0]).filter(repo => knownRepos.has(repo)))];
  const unknown = task.ids.filter(id => !workspace.rules.some(rule => rule.id === id));
  if (unknown.length) return { status: "invalid", complete: false, failures: [`unknown rule ids: ${unknown.join(", ")}`] };
  const budget = requestedBytes ?? workspace.config.budgets.select_bytes;
  if (!Number.isSafeInteger(budget) || budget <= 0) return { status: "invalid", complete: false, failures: ["bytes must be a positive integer"] };
  const matched = [];
  const ambiguous = [];
  for (const rule of workspace.rules) {
    const explicit = task.ids.includes(rule.id);
    const match = matchRule(rule, task);
    if (!explicit && !match.matched) continue;
    if (!explicit && rule.applies_to.repos.length && !task.repos.length) {
      ambiguous.push(rule.id);
      continue;
    }
    matched.push({ rule, score: explicit ? 100 : match.score, reasons: explicit ? ["id"] : match.reasons });
  }
  // Every unscoped gate comes first. Counters do not change routing or page identity.
  const globalGate = rule => rule.kind === "gate" && APPLIES_TO_KEYS.every(key => !rule.applies_to[key].length);
  matched.sort((left, right) => Number(globalGate(right.rule)) - Number(globalGate(left.rule)) ||
    kindRank(left.rule.kind) - kindRank(right.rule.kind) || right.score - left.score || left.rule.id.localeCompare(right.rule.id));
  const entries = matched.map(({ rule, score, reasons }) => ({ id: rule.id, kind: rule.kind, hook: rule.hook, score, reasons, text: renderRule(rule) }));
  const fingerprint = sha256Text(JSON.stringify({ signature: task, budget, ambiguous, entries }));
  let offset = 0;
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || cursor.length > 4096) return { status: "invalid", complete: false, failures: ["invalid cursor"] };
    try {
      const page = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (page.fingerprint !== fingerprint) return { status: "blocked", complete: false, reason: "selection_changed", hint: "restart select without a cursor" };
      if (!Number.isInteger(page.offset) || page.offset < 0 || page.offset >= entries.length) throw new Error("offset");
      offset = page.offset;
    } catch { return { status: "invalid", complete: false, failures: ["invalid cursor"] }; }
  }
  const selected = [];
  let size = 0;
  let end = offset;
  for (const entry of entries.slice(offset)) {
    const cost = byteLength(entry.text) + (selected.length ? 1 : 0);
    if (size + cost > budget) break;
    selected.push(entry);
    size += cost;
    end += 1;
  }
  const omitted = entries.slice(end).map(entry => entry.id);
  const complete = omitted.length === 0 && ambiguous.length === 0;
  const oversized = selected.length === 0 && omitted.length > 0;
  return {
    status: oversized ? "blocked" : complete ? "ok" : "incomplete",
    ...(oversized ? { reason: "rule_exceeds_budget", hint: `read rules/${omitted[0]}.md directly or increase --bytes and restart` } : {}),
    complete, signature: task, fingerprint, budget, offset,
    matched: entries.map(({ text, ...entry }) => entry),
    selected, omitted, ambiguous, bytes: size,
    cursor: omitted.length && !oversized ? Buffer.from(JSON.stringify({ fingerprint, offset: end })).toString("base64url") : undefined,
    text: selected.map(entry => entry.text).join("\n"),
  };
}

function matchRule(rule, task) {
  const scope = rule.applies_to;
  const scoped = APPLIES_TO_KEYS.some((key) => scope[key].length > 0);
  if (!scoped) return rule.kind === "gate" ? { matched: true, score: 0, reasons: ["global"] } : { matched: false, score: 0, reasons: [] };
  const reasons = [];
  if (scope.repos.length > 0) {
    if (task.repos.length > 0 && !task.repos.some((repo) => scope.repos.includes(repo))) return { matched: false, score: 0, reasons: [] };
    if (task.repos.some((repo) => scope.repos.includes(repo))) reasons.push("repos");
  }
  if (scope.paths.length > 0 && task.paths.some((path) => scope.paths.some((pattern) => pathMatches(pattern, path)))) reasons.push("paths");
  if (scope.ops.length > 0 && task.ops.some((op) => scope.ops.includes(op))) reasons.push("ops");
  if (scope.skills.length > 0 && task.skills.some((skill) => scope.skills.includes(skill))) reasons.push("skills");
  const onlyRepos = scope.paths.length === 0 && scope.ops.length === 0 && scope.skills.length === 0;
  const matched = onlyRepos ? reasons.includes("repos") : reasons.some((reason) => reason !== "repos");
  return matched ? { matched: true, score: reasons.length, reasons } : { matched: false, score: 0, reasons: [] };
}

export function pathMatches(pattern, path) {
  const cleanPattern = pattern.replace(/^\.\//u, "");
  return globMatch(cleanPattern, path) || (!cleanPattern.startsWith("**") && globMatch(`**/${cleanPattern}`, path));
}

function kindRank(kind) {
  return kind === "gate" ? 0 : kind === "advice" ? 1 : 2;
}

export function renderRule(rule) {
  const scope = APPLIES_TO_KEYS.filter((key) => rule.applies_to[key].length > 0)
    .map((key) => `${key}=${rule.applies_to[key].join(",")}`)
    .join(" ");
  const heading = `### ${rule.kind} [${rule.id}] ${rule.hook}${scope ? `\n<!-- ${scope} -->` : ""}`;
  const body = rule.body.trim();
  return body === "" ? `${heading}\n` : `${heading}\n${body}\n`;
}
