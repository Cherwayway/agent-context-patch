import { byteLength, globMatch, isIdentifier } from "./text.mjs";
import { sortRules } from "./catalog.mjs";
import { APPLIES_TO_KEYS } from "./workspace.mjs";

const SIGNATURE_KEYS = new Set([...APPLIES_TO_KEYS, "ids"]);

/**
 * Normalize a task signature. Repos are derived from the first path segment
 * when the caller did not name them, so `paths: ["ilands/migrations/1.sql"]`
 * matches rules scoped to `repos: [ilands]`.
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
  const derivedRepos = lists.paths
    .map((path) => path.replace(/^\.\//u, "").split("/")[0])
    .filter((segment) => segment && !segment.includes("."));
  const value = {
    repos: [...new Set([...lists.repos, ...derivedRepos])],
    paths: lists.paths.map((path) => path.replace(/^\.\//u, "")),
    ops: lists.ops,
    skills: lists.skills,
    ids: lists.ids,
  };
  return { failures, value };
}

/**
 * Select the rule bodies relevant to one task. Repos act as a filter: a rule
 * scoped to other repos never matches. Beyond that, any intersecting
 * paths / ops / skills dimension is a hit and the score counts how many
 * dimensions agree. Rules with no scope at all are global; only global
 * gates are selected, because a global advice is already fully expressed by
 * its catalog hook. Explicit ids are always included. Output is capped by
 * budgets.select_bytes with gates first, so overflow drops advice before it
 * drops a gate.
 */
export function selectRules(workspace, signature) {
  const normalized = normalizeSignature(signature);
  if (normalized.failures.length > 0) return { status: "invalid", failures: normalized.failures };
  const task = normalized.value;
  const matched = [];
  for (const rule of workspace.rules) {
    const explicit = task.ids.includes(rule.id);
    const match = matchRule(rule, task);
    if (!explicit && !match.matched) continue;
    matched.push({ rule, score: explicit ? 100 : match.score, reasons: explicit ? ["id"] : match.reasons });
  }
  const ordered = sortRules(matched.map(({ rule }) => rule)).map((rule) => matched.find((entry) => entry.rule === rule));
  ordered.sort((left, right) => {
    const kindDelta = kindRank(left.rule.kind) - kindRank(right.rule.kind);
    if (kindDelta !== 0) return kindDelta;
    return right.score - left.score || right.rule.consulted - left.rule.consulted || left.rule.id.localeCompare(right.rule.id);
  });

  const budget = workspace.config.budgets.select_bytes;
  const selected = [];
  const omitted = [];
  let bytes = 0;
  for (const entry of ordered) {
    const text = renderRule(entry.rule);
    const size = byteLength(text);
    if (bytes + size > budget && selected.length > 0) {
      omitted.push(entry.rule.id);
      continue;
    }
    bytes += size;
    selected.push({ id: entry.rule.id, kind: entry.rule.kind, hook: entry.rule.hook, score: entry.score, reasons: entry.reasons, text });
  }
  return {
    status: "ok",
    signature: task,
    selected,
    omitted,
    bytes,
    text: selected.map((entry) => entry.text).join("\n"),
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
