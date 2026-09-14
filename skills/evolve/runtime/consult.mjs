import { writeFile } from "node:fs/promises";

import { serializeRule } from "./apply.mjs";
import { isIdentifier } from "./text.mjs";
import { loadWorkspace } from "./workspace.mjs";

/**
 * Record which rules a task actually used (`consulted`) and which relevant
 * rules it failed to read (`missed`). Counters live in rule frontmatter so
 * the weekly review can rank, merge, and retire by real use.
 */
export async function recordConsultation({ workspaceRoot, consulted = [], missed = [], today } = {}) {
  const failures = [];
  for (const id of [...consulted, ...missed]) if (!isIdentifier(id)) failures.push(`invalid rule id: ${id}`);
  if (failures.length > 0) return { status: "failed", reason: "invalid_ids", details: failures };
  const workspace = await loadWorkspace(workspaceRoot, { today });
  if (workspace.status !== "ok") return { status: "failed", reason: "workspace_invalid", details: workspace.failures };

  const byId = new Map(workspace.rules.map((rule) => [rule.id, rule]));
  const unknown = [...new Set([...consulted, ...missed])].filter((id) => !byId.has(id));
  const updated = [];
  for (const id of new Set(consulted)) {
    const rule = byId.get(id);
    if (!rule) continue;
    rule.consulted += 1;
    rule.last_consulted = workspace.today;
    updated.push(rule);
  }
  for (const id of new Set(missed)) {
    const rule = byId.get(id);
    if (!rule) continue;
    rule.missed += 1;
    if (!updated.includes(rule)) updated.push(rule);
  }
  for (const rule of updated) await writeFile(rule.path, serializeRule(rule), "utf8");
  const result = {
    status: "ok",
    consulted: [...new Set(consulted)].filter((id) => byId.has(id)),
    missed: [...new Set(missed)].filter((id) => byId.has(id)),
    unknown,
  };
  return { ...result, receipt: formatConsultReceipt(result) };
}

export function formatConsultReceipt({ consulted = [], missed = [], unknown = [] }) {
  const fields = [`consulted=${consulted.length === 0 ? "none" : consulted.join(",")}`];
  if (missed.length > 0) fields.push(`missed=${missed.join(",")}`);
  if (unknown.length > 0) fields.push(`unknown=${unknown.join(",")}`);
  return `Context use: ${fields.join("; ")}.`;
}
