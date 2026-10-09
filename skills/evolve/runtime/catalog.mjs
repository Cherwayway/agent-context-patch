import { join } from "node:path";

import { commitFiles, readMaybe, withMutation } from "./mutation.mjs";
import { byteLength } from "./text.mjs";

export const CATALOG_OPEN = "<!-- acp-catalog:";
export const CATALOG_CLOSE = "<!-- /acp-catalog -->";
const KIND_ORDER = { gate: 0, advice: 1, fact: 2 };

/**
 * Render the always-on catalog: one hook line per active rule grouped by
 * repo and operation, then STATE entries with their expiry dates. This is
 * the only context that every session sees without deciding to read.
 */
export function renderCatalog(workspace, { renderedAt = new Date().toISOString(), kitVersion } = {}) {
  const { rules, state, config } = workspace;
  const version = kitVersion ?? config.kit_version;
  const lines = [];
  lines.push("## Workspace Context Catalog");
  lines.push("");
  lines.push("Read .agent-context/rules/<id>.md first. (+ops) adds ops. Select needs repos; no edits.");

  const groups = new Map();
  for (const rule of rules) {
    const repo = rule.applies_to.repos.join(",") || "any";
    const op = rule.applies_to.ops[0] ?? "general";
    const key = `${repo} · ${op}`;
    if (!groups.has(key)) groups.set(key, { repo, op, rules: [] });
    groups.get(key).rules.push(rule);
  }
  const orderedGroups = [...groups.values()].sort((left, right) => {
    if (left.repo === "any" && right.repo !== "any") return 1;
    if (left.repo !== "any" && right.repo === "any") return -1;
    return left.repo.localeCompare(right.repo) || left.op.localeCompare(right.op);
  });
  for (const group of orderedGroups) {
    lines.push(`### ${group.repo} · ${group.op}`);
    for (const rule of sortRules(group.rules)) {
      const also = rule.applies_to.ops.length > 1 ? ` (+${rule.applies_to.ops.slice(1).join(",")})` : "";
      lines.push(`- ${rule.kind} [${rule.id}] ${rule.hook}${also}`);
    }
  }

  const activeState = state
    .filter((entry) => entry.expires >= workspace.today)
    .sort((left, right) => left.expires.localeCompare(right.expires) || left.id.localeCompare(right.id));
  if (activeState.length > 0) {
    lines.push("");
    lines.push("### STATE (auto-expires)");
    for (const entry of activeState) {
      const repos = entry.repos.length > 0 ? `${entry.repos.join(",")}: ` : "";
      lines.push(`- (${entry.expires.slice(5)}) ${repos}${entry.text}`);
    }
  }

  const body = lines.join("\n");
  const header = `${CATALOG_OPEN} kit=${version} schema=2 rendered=${renderedAt} rules=${rules.length} state=${activeState.length} -->`;
  const text = `${header}\n${body}\n${CATALOG_CLOSE}\n`;
  return { text, bytes: byteLength(text), rules: rules.length, state: activeState.length };
}

export function sortRules(rules) {
  return [...rules].sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.id.localeCompare(right.id),
  );
}

/** Replace (or append) the managed block inside an instruction file's text. */
export function replaceCatalogBlock(source, catalogText) {
  const normalized = source;
  const opens = normalized.split(CATALOG_OPEN).length - 1;
  const closes = normalized.split(CATALOG_CLOSE).length - 1;
  if (opens > 1 || closes > 1) throw new Error("instruction file has duplicate acp-catalog blocks");
  const start = normalized.indexOf(CATALOG_OPEN);
  const end = normalized.indexOf(CATALOG_CLOSE);
  if (start === -1 && end === -1) {
    const separator = normalized === "" ? "" : normalized.endsWith("\n\n") ? "" : normalized.endsWith("\n") ? "\n" : "\n\n";
    return `${normalized}${separator}${catalogText}`;
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error("instruction file has an unbalanced acp-catalog block");
  }
  const blockEnd = end + CATALOG_CLOSE.length;
  const trailing = normalized.slice(blockEnd).startsWith("\r\n") ? blockEnd + 2 : normalized[blockEnd] === "\n" ? blockEnd + 1 : blockEnd;
  return `${normalized.slice(0, start)}${catalogText}${normalized.slice(trailing)}`;
}

export function catalogSemanticText(text) {
  return text.replaceAll("\r\n", "\n").replace(/rendered=[^ ]+/u, "rendered=<time>").trimEnd();
}

export function catalogBlock(source) {
  if (source.split(CATALOG_OPEN).length > 2 || source.split(CATALOG_CLOSE).length > 2) return undefined;
  const start = source.indexOf(CATALOG_OPEN);
  const end = source.indexOf(CATALOG_CLOSE);
  if (start < 0 || end < start) return undefined;
  const blockEnd = end + CATALOG_CLOSE.length;
  const trailing = source.slice(blockEnd).startsWith("\r\n") ? 2 : source[blockEnd] === "\n" ? 1 : 0;
  return source.slice(start, blockEnd + trailing);
}

/** Prepare without writing; callers committing several files already hold the lock. */
export async function prepareCatalog(workspace, options = {}) {
  let catalog = renderCatalog(workspace, options);
  const agentsPath = join(workspace.workspaceRoot, workspace.config.agents_file);
  const source = (await readMaybe(agentsPath)) ?? "";
  const next = replaceCatalogBlock(source, catalog.text);
  const existing = catalogBlock(source);
  if (existing && catalogSemanticText(existing) === catalogSemanticText(catalog.text)) {
    catalog = { ...catalog, text: existing, bytes: byteLength(existing) };
    return { ...catalog, agentsPath, next: source, changed: false };
  }
  return { ...catalog, agentsPath, next, changed: next !== source };
}

export async function writeCatalog(workspace, options = {}) {
  return withMutation(workspace.workspaceRoot, { today: workspace.today }, async fresh => {
    const catalog = await prepareCatalog(fresh, options);
    const result = await commitFiles(fresh, catalog.changed ? [{ target: fresh.config.agents_file, after: catalog.next }] : []);
    if (result.status !== "ok") return result;
    const { next, ...publicResult } = catalog;
    return { status: "ok", ...publicResult };
  });
}
