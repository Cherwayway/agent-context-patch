import { join, relative } from "node:path";
import { commitFiles, readMaybe, withMutation } from "./mutation.mjs";

import { serializeRule } from "./apply.mjs";
import { renderRule } from "./select.mjs";
import { isIdentifier, sha256Text } from "./text.mjs";

/**
 * Record which rules a task actually used (`consulted`) and which relevant
 * rules it failed to read (`missed`). Counters live in rule frontmatter so
 * the weekly review can rank, merge, and retire by real use.
 */
export async function recordConsultation({ workspaceRoot, consulted = [], missed = [], today, taskRef, action } = {}) {
  const failures = [];
  const actions = ["prevented_error", "changed_plan", "added_verification", "avoided_work", "confirmed_path"];
  if (taskRef !== undefined || action !== undefined) {
    if (!isIdentifier(taskRef) || !actions.includes(action) || !consulted.length) failures.push("material use requires a safe identifier taskRef, an allowed action, and consulted ids");
  }
  for (const id of [...consulted, ...missed]) if (!isIdentifier(id)) failures.push(`invalid rule id: ${id}`);
  if (failures.length > 0) return { status: "failed", reason: "invalid_ids", details: failures };
  return withMutation(workspaceRoot, { today }, async workspace => {

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
  const changes = updated.map(rule => ({ target: relative(workspace.workspaceRoot, rule.path), after: serializeRule(rule) }));
  if (taskRef !== undefined) {
    const target = `.agent-context/reports/material-use-${workspace.today}.json`;
    const previous = JSON.parse((await readMaybe(join(workspace.workspaceRoot, target))) ?? "[]");
    if (!Array.isArray(previous) || previous.length > 1000) return { status: "failed", reason: "invalid_material_use_report" };
    for (const id of new Set(consulted)) {
      const rule = byId.get(id);
      if (!rule) continue;
      const entry = { taskRef, ruleId: id, ruleHash: sha256Text(renderRule(rule)), action, evidenceType: "self_report" };
      if (!previous.some(item => JSON.stringify(item) === JSON.stringify(entry))) previous.push(entry);
    }
    if (previous.length > 1000) return { status: "blocked", reason: "material_use_report_full" };
    changes.push({ target, after: `${JSON.stringify(previous, null, 2)}\n` });
  }
  const committed = await commitFiles(workspace, changes);
  if (committed.status !== "ok") return committed;
  const result = {
    status: "ok",
    consulted: [...new Set(consulted)].filter((id) => byId.has(id)),
    missed: [...new Set(missed)].filter((id) => byId.has(id)),
    unknown,
  };
  return { ...result, receipt: formatConsultReceipt(result) };
  });
}

export function formatConsultReceipt({ consulted = [], missed = [], unknown = [] }) {
  const fields = [`consulted=${consulted.length === 0 ? "none" : consulted.join(",")}`];
  if (missed.length > 0) fields.push(`missed=${missed.join(",")}`);
  if (unknown.length > 0) fields.push(`unknown=${unknown.join(",")}`);
  return `Context use: ${fields.join("; ")}.`;
}
