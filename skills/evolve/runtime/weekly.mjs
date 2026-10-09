import { join } from "node:path";

import { expireState, findSimilar } from "./apply.mjs";
import { renderCatalog } from "./catalog.mjs";
import { daysBetween } from "./text.mjs";
import { inspectHealth } from "./health.mjs";
import { commitFiles, withMutation } from "./mutation.mjs";

const STALE_DAYS = 30;
const SIMILAR_REVIEW_THRESHOLD = 0.35;

/**
 * Build the weekly context-health view from real use counters. The report
 * is a rebuildable derived file; it recommends merges and retirements but
 * never removes anything itself.
 */
export async function buildWeeklyReport({ workspaceRoot, today, memoryCandidates = [], kitVersion } = {}) {
  return withMutation(workspaceRoot, { today }, async workspace => {
  const health = await inspectHealth(workspace, { kitVersion });
  const date = workspace.today;
  const { rules, state, config } = workspace;
  const catalog = renderCatalog(workspace, { kitVersion });

  const usedBefore = new Set(health.lineage.filter(item => item.previousConsulted > 0).map(item => item.id));
  const neverConsulted = rules.filter((rule) => rule.consulted === 0 && !usedBefore.has(rule.id) && daysBetween(rule.created, date) >= STALE_DAYS);
  const stale = rules.filter((rule) => rule.consulted > 0 && rule.last_consulted && daysBetween(rule.last_consulted, date) >= STALE_DAYS);
  const missed = rules.filter((rule) => rule.missed > 0).sort((left, right) => right.missed - left.missed);
  const needsRewrite = rules.filter((rule) => rule.needs_rewrite);
  const mostUsed = [...rules].sort((left, right) => right.consulted - left.consulted || left.id.localeCompare(right.id)).slice(0, 10);

  const similarPairs = [];
  for (const [index, rule] of rules.entries()) {
    const candidates = findSimilar(rule.hook, rules.slice(index + 1), SIMILAR_REVIEW_THRESHOLD);
    for (const candidate of candidates) similarPairs.push({ left: rule.id, right: candidate.id, score: candidate.score });
  }
  similarPairs.sort((left, right) => right.score - left.score);

  const expiry = expireState(state, date);
  const expiringSoon = expiry.active.filter((entry) => daysBetween(date, entry.expires) <= 3);

  const lines = [`# Weekly context review ${date}`, ""];
  lines.push("## Catalog");
  lines.push(`- bytes: ${catalog.bytes} / ${config.budgets.catalog_bytes} budget (${Math.round((catalog.bytes / config.budgets.catalog_bytes) * 100)}%)`);
  lines.push(`- active rules: ${rules.length} (gate ${count(rules, "gate")}, advice ${count(rules, "advice")}, fact ${count(rules, "fact")})`);
  lines.push(`- state entries: ${expiry.active.length} active, ${expiry.expired.length} expired and pending archive`);
  lines.push(`- rules flagged needs_rewrite: ${needsRewrite.length}`);
  lines.push(`- stored catalog: ${health.catalog.storedBytes} bytes; semantic freshness: ${health.catalog.fresh}`);
  lines.push(`- latest applied proposal: ${health.latestAppliedAt ?? "none"}; previous weekly report: ${health.lastWeeklyReport ?? "none"}`);
  lines.push(`- proposal audits: ${health.proposals.appliedAudits}; pending input files: ${health.proposals.pendingInputs.length}; invalid audits: ${health.proposals.invalidAudits.length}`);
  lines.push(`- growth: ${health.growth[7].createdRules} rules created / ${health.growth[7].appliedProposals} proposals applied in 7 days; ${health.growth[30].createdRules} / ${health.growth[30].appliedProposals} in 30 days`);
  lines.push("- Counters are cumulative self-reports, not evidence of causal improvement. Empty age-filtered lists do not prove all rules were used.");
  lines.push("");
  lines.push("## Use inherited through supersede (not current-version use)");
  for (const item of health.lineage.filter(item => item.previousConsulted > 0)) lines.push(`- [${item.id}] current ${item.currentConsulted}×; predecessors ${item.previousConsulted}×`);
  lines.push("");
  lines.push("## Optional material use (last 30 days, self-reported)");
  lines.push(`- observations: ${health.materialUse.observations}; relevant-task opportunities: unknown; recurrence: unknown`);
  for (const item of health.materialUse.rules) lines.push(`- [${item.id}] ${item.observations}× last ${item.lastMaterialUse}; ${item.currentVersion ? "current rule text" : "historical rule text"}`);
  lines.push("");
  lines.push("## Most consulted");
  pushRules(lines, mostUsed.filter((rule) => rule.consulted > 0), (rule) => `${rule.consulted}× last ${rule.last_consulted}`);
  lines.push("");
  lines.push("## Relevant but missed");
  pushRules(lines, missed, (rule) => `missed ${rule.missed}× — investigate routing, budget, stale scope, then hook clarity`);
  lines.push("");
  lines.push(`## Never consulted (older than ${STALE_DAYS} days)`);
  pushRules(lines, neverConsulted, () => "retire candidate unless it is a gate that simply has not been hit");
  lines.push("");
  lines.push(`## Not consulted for ${STALE_DAYS}+ days`);
  pushRules(lines, stale, (rule) => `last ${rule.last_consulted}`);
  lines.push("");
  lines.push("## Similar hooks (merge candidates)");
  if (similarPairs.length === 0) lines.push("- none");
  for (const pair of similarPairs) lines.push(`- ${pair.score.toFixed(2)} [${pair.left}] ↔ [${pair.right}]`);
  lines.push("");
  lines.push("## State expiring within 3 days");
  if (expiringSoon.length === 0) lines.push("- none");
  for (const entry of expiringSoon) lines.push(`- (${entry.expires}) ${entry.id}: ${entry.text}`);
  if (memoryCandidates.length > 0) {
    lines.push("");
    lines.push("## Claude memory files not yet in the workspace");
    for (const candidate of memoryCandidates) lines.push(`- ${candidate.file} (${candidate.type}): ${candidate.description}`);
  }
  lines.push("");
  lines.push("## Recommended next actions");
  const actions = [];
  if (catalog.bytes > config.budgets.catalog_bytes * 0.9) actions.push("catalog is within 10% of budget: merge or retire before adding");
  if (similarPairs.length > 0) actions.push(`review ${similarPairs.length} similar pair(s) for supersede`);
  if (missed.length > 0) actions.push(`investigate ${missed.length} missed rule(s) before changing hooks or scope`);
  if (neverConsulted.length > 0) actions.push(`decide on ${neverConsulted.length} never-consulted rule(s)`);
  if (needsRewrite.length > 0) actions.push(`finish rewriting ${needsRewrite.length} migrated draft rule(s)`);
  if (memoryCandidates.length > 0) actions.push(`migrate ${memoryCandidates.length} Claude memory file(s) into rules or STATE`);
  if (!health.catalog.fresh) actions.push("re-render the stale catalog after reviewing its changes");
  if (health.expiredPendingArchive.length) actions.push("run expire to archive expired STATE; do not renew without fresh evidence");
  if (actions.length === 0) actions.push("nothing urgent");
  for (const action of actions) lines.push(`- ${action}`);
  lines.push("");

  const report = lines.join("\n");
  const reportPath = join(workspace.contextRoot, "reports", `weekly-${date}.md`);
  const written = await commitFiles(workspace, [{ target: `.agent-context/reports/weekly-${date}.md`, after: report }]);
  if (written.status !== "ok") return written;
  return {
    status: "ok",
    reportPath,
    summary: {
      health,
      catalogBytes: catalog.bytes,
      rules: rules.length,
      neverConsulted: neverConsulted.map((rule) => rule.id),
      missed: missed.map((rule) => rule.id),
      similarPairs,
      expiringSoon: expiringSoon.map((entry) => entry.id),
      needsRewrite: needsRewrite.map((rule) => rule.id),
      actions,
    },
  };
  });
}

function count(rules, kind) {
  return rules.filter((rule) => rule.kind === kind).length;
}

function pushRules(lines, rules, annotate) {
  if (rules.length === 0) {
    lines.push("- none");
    return;
  }
  for (const rule of rules) lines.push(`- [${rule.id}] ${annotate(rule)}`);
}
