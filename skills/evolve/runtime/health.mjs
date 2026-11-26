import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { catalogBlock, catalogSemanticText, renderCatalog } from "./catalog.mjs";
import { readMaybe, withMutation } from "./mutation.mjs";
import { renderRule } from "./select.mjs";
import { byteLength, daysBetween, isIdentifier, sha256Text } from "./text.mjs";
import { listMarkdown, MATERIAL_USE_ACTIONS } from "./workspace.mjs";
import { parseFrontmatter } from "./yaml.mjs";

export const OVERPACKED_ANCESTORS = 8;
export const OVERPACKED_BODY_RATIO = 0.85;

export async function inspectHealth(workspace, { kitVersion } = {}) {
  const catalog = renderCatalog(workspace, { kitVersion });
  const source = (await readMaybe(join(workspace.workspaceRoot, workspace.config.agents_file))) ?? "";
  const stored = catalogBlock(source);
  const archives = [];
  const invalidArchives = [];
  for (const file of await listMarkdown(join(workspace.contextRoot, "archive", "rules"))) {
    try {
      const { data } = parseFrontmatter(await readMaybe(join(workspace.contextRoot, "archive", "rules", file)));
      archives.push(data);
    } catch { invalidArchives.push(file); }
  }
  const byId = new Map(archives.map(rule => [rule.id, rule]));
  const depthMemo = new Map();
  const computeDepth = (ids, trail = new Set()) => {
    let maxDepth = 0;
    for (const id of ids ?? []) {
      if (trail.has(id)) continue;
      if (depthMemo.has(id)) {
        maxDepth = Math.max(maxDepth, 1 + depthMemo.get(id));
        continue;
      }
      const ancestor = byId.get(id);
      const subDepth = ancestor ? computeDepth(ancestor.supersedes ?? [], new Set([...trail, id])) : 0;
      depthMemo.set(id, subDepth);
      maxDepth = Math.max(maxDepth, 1 + subDepth);
    }
    return maxDepth;
  };
  const bodyThreshold = Math.ceil(workspace.config.budgets.body_bytes * OVERPACKED_BODY_RATIO);
  const lineage = workspace.rules.map(rule => {
    const visited = new Set([rule.id]);
    const pending = [...rule.supersedes];
    let previousConsulted = 0;
    const missing = [];
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const ancestor = byId.get(id);
      if (!ancestor) { missing.push(id); continue; }
      previousConsulted += ancestor.consulted ?? 0;
      pending.push(...(ancestor.supersedes ?? []));
    }
    const ancestors = [...visited].filter(id => id !== rule.id);
    const lineageDepth = computeDepth(rule.supersedes);
    const bodyBytes = byteLength(rule.body);
    const overpacked = ancestors.length >= OVERPACKED_ANCESTORS && bodyBytes >= bodyThreshold;
    return { id: rule.id, currentConsulted: rule.consulted, previousConsulted, ancestors, lineageDepth, bodyBytes, overpacked, missing };
  });
  const graduatedRules = archives.filter(rule => typeof rule.graduated_to === "string" && rule.graduated_to.length > 0).length;
  const audits = [];
  const invalidAudits = [];
  const proposalsRoot = join(workspace.contextRoot, "proposals");
  for (const file of await listMarkdown(proposalsRoot)) {
    try {
      const { data } = parseFrontmatter(await readMaybe(join(proposalsRoot, file)));
      if (`${data.id}.md` !== file || data.decision !== "auto_applied" || !Array.isArray(data.targets) || !Number.isFinite(Date.parse(data.applied_at))) throw new Error("audit shape");
      audits.push(data);
    } catch { invalidAudits.push(file); }
  }
  const inputs = (await filesMaybe(proposalsRoot)).filter(file => file.endsWith(".json"));
  const pendingInputs = [];
  const invalidInputs = [];
  for (const file of inputs) {
    try {
      const input = JSON.parse(await readMaybe(join(proposalsRoot, file)));
      if (typeof input.id !== "string") throw new Error("input id missing");
      if (!audits.some(audit => audit.id === input.id)) pendingInputs.push(file);
    } catch { invalidInputs.push(file); }
  }
  const reports = await filesMaybe(join(workspace.contextRoot, "reports"));
  const materialUse = { windowDays: 30, observations: 0, rules: [], flaggedStale: [], invalidReports: [], opportunityCoverage: "unknown", recurrence: "unknown", evidenceType: "optional_self_reports" };
  const materialByVersion = new Map();
  const staleSet = new Set();
  for (const file of reports.filter(file => /^material-use-\d{4}-\d{2}-\d{2}\.json$/u.test(file))) {
    const date = file.slice(13, 23);
    if (daysBetween(date, workspace.today) < 0 || daysBetween(date, workspace.today) >= 30) continue;
    try {
      const path = join(workspace.contextRoot, "reports", file);
      if ((await stat(path)).size > 512 * 1024) throw new Error("report too large");
      const entries = JSON.parse(await readMaybe(path));
      if (!Array.isArray(entries) || entries.length > 1000 || entries.some(entry => !isIdentifier(entry.taskRef) || !isIdentifier(entry.ruleId) || !/^[a-f0-9]{64}$/u.test(entry.ruleHash) || entry.evidenceType !== "self_report" || !MATERIAL_USE_ACTIONS.includes(entry.action))) throw new Error("invalid report");
      for (const entry of entries) {
        const key = `${entry.ruleId}:${entry.ruleHash}`;
        const rule = workspace.rules.find(rule => rule.id === entry.ruleId);
        const currentVersion = Boolean(rule) && sha256Text(renderRule(rule)) === entry.ruleHash;
        if (currentVersion && entry.action === "flagged_stale") staleSet.add(entry.ruleId);
        const summary = materialByVersion.get(key) ?? { id: entry.ruleId, ruleHash: entry.ruleHash, currentVersion, observations: 0, lastMaterialUse: date };
        summary.observations += 1;
        if (summary.lastMaterialUse < date) summary.lastMaterialUse = date;
        materialByVersion.set(key, summary);
        materialUse.observations += 1;
      }
    } catch { materialUse.invalidReports.push(file); }
  }
  materialUse.rules = [...materialByVersion.values()];
  materialUse.flaggedStale = [...staleSet].sort();
  const weeklyReports = reports.filter(file => /^weekly-\d{4}-\d{2}-\d{2}\.md$/u.test(file)).sort();
  const latestAppliedAt = audits.map(audit => audit.applied_at).sort().at(-1) ?? null;
  const growth = Object.fromEntries([7, 30].map(days => [days, {
    createdRules: [...workspace.rules, ...archives].filter(rule => rule.created && daysBetween(rule.created, workspace.today) >= 0 && daysBetween(rule.created, workspace.today) < days).length,
    appliedProposals: audits.filter(audit => daysBetween(audit.applied_at.slice(0, 10), workspace.today) >= 0 && daysBetween(audit.applied_at.slice(0, 10), workspace.today) < days).length,
  }]));
  return {
    catalog: { storedBytes: stored ? Buffer.byteLength(stored) : 0, freshBytes: catalog.bytes, budget: workspace.config.budgets.catalog_bytes,
      fresh: Boolean(stored) && catalogSemanticText(stored) === catalogSemanticText(catalog.text), renderedAt: stored?.match(/rendered=([^ ]+)/u)?.[1] ?? null },
    expiredPendingArchive: workspace.state.filter(entry => entry.expires < workspace.today).map(entry => entry.id),
    proposals: { appliedAudits: audits.length, inputFiles: inputs.length, pendingInputs, invalidInputs, invalidAudits },
    invalidArchives, graduatedRules, lineage, growth, latestAppliedAt, materialUse,
    lastWeeklyReport: weeklyReports.at(-1) ?? null,
  };
}

export async function buildStatus({ workspaceRoot, today, kitVersion } = {}) {
  return withMutation(workspaceRoot, { today }, async workspace => {
    const health = await inspectHealth(workspace, { kitVersion });
    return { status: "ok", workspaceRoot: workspace.workspaceRoot, rules: workspace.rules.length,
      needsRewrite: workspace.rules.filter(rule => rule.needs_rewrite).length, state: workspace.state.length,
      catalogBytes: health.catalog.freshBytes, catalogBudget: health.catalog.budget,
      writePolicy: workspace.config.write_policy, health };
  });
}

async function filesMaybe(directory) {
  try { return await readdir(directory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
