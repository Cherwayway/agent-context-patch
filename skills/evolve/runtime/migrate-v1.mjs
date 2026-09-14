import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { serializeRule } from "./apply.mjs";
import { writeCatalog } from "./catalog.mjs";
import { initWorkspace } from "./init.mjs";
import { byteLength, isoDate, slugify } from "./text.mjs";
import { CONTEXT_DIR, DEFAULT_CONFIG, loadWorkspace, readTextMaybe } from "./workspace.mjs";
import { parseYaml } from "./yaml.mjs";

const TEMPLATE_BULLETS = new Set([
  "Read active project instructions and relevant context before editing.",
  "Confirm the requirement and affected boundary.",
  "Keep the patch scoped.",
  "Run narrow verification and required project checks.",
  "Report exact verification evidence.",
  "Use replace-before-add for any reusable failure lesson.",
  "None until verified against current workspace sources.",
]);
const LEGACY_MARKER = /^<!-- acp-rule: (?:id=(\S+) source=(\S+) subsumes=\S+|(\S+); source: (\S+); subsumes: [^>]*) -->$/u;
const REPO_HINTS = [
  ["ilands", /\bilands\b/iu],
  ["pi-mono", /\bpi-mono\b/iu],
  ["multi-agent-economy-research", /multi-agent-economy-research/iu],
  ["agent-context-patch", /agent[- ]context[- ]patch|\bacp\b/iu],
  ["swelancer-rsi-benchmark", /swelancer/iu],
];
const OP_HINTS = [
  ["migration", /\bmigrat|CONCURRENTLY|\bindex\b/iu],
  ["sql", /\bSQL\b|EXPLAIN|Postgres|asyncpg|jsonb|\bquery\b|replica/iu],
  ["pr", /pull request|\bPRs?\b|\breview|\bCI\b|\bmerge|worktree|branch/iu],
  ["deploy", /deploy|rollout|release|workflow_dispatch/iu],
  ["feishu", /feishu|\blark/iu],
  ["analytics", /PostHog|dashboard|HogQL/iu],
  ["eval", /\beval|benchmark|holdout|experiment/iu],
  ["agent-runtime", /heartbeat|\bagent\b.*\b(?:run|tool)|canary/iu],
];
const GATE_HINT = /^(?:never|do not|don't|before|require|must|always|reject|refuse)\b|\bnever\b|\bmust\b/iu;

/**
 * One-shot, lossy migration of a Schema 1 workspace. Every checklist bullet
 * and profile rule becomes a draft rule flagged needs_rewrite; history moves
 * to archive untouched. Nothing here is reversible by design.
 */
export async function migrateV1({ workspaceRoot, today = isoDate(), kitVersion = DEFAULT_CONFIG.kit_version, agentsFile = "AGENTS.md" } = {}) {
  const contextRoot = join(workspaceRoot, CONTEXT_DIR);
  const configSource = await readTextMaybe(join(contextRoot, "config.yml"));
  if (configSource === undefined) return { status: "failed", reason: "config_missing" };
  const config = parseYaml(configSource, "config.yml");
  if (config.schema_version !== 1) return { status: "failed", reason: "not_schema_1", details: [`schema_version ${String(config.schema_version)}`] };
  const policy = config.context_write_policy === "propose" ? "propose" : "auto";

  const drafts = [];
  const checklistRoot = join(contextRoot, "checklists");
  const checklistFiles = (await listMaybe(checklistRoot)).filter((name) => name.endsWith(".md") && name !== "README.md");
  for (const fileName of checklistFiles) {
    const source = await readFile(join(checklistRoot, fileName), "utf8");
    drafts.push(...extractBullets(source, `checklists/${fileName}`));
  }
  const profileSource = (await readTextMaybe(join(contextRoot, "PROJECT_PROFILE.md"))) ?? "";
  const profile = splitProfile(profileSource);
  drafts.push(...extractBullets(profile.rulesSection, "PROJECT_PROFILE.md"));

  const usedIds = new Set();
  const rules = drafts.map((draft) => draftToRule(draft, usedIds, today));

  const archiveRoot = join(contextRoot, "archive");
  await mkdir(join(archiveRoot, "proposals-v1"), { recursive: true });
  await mkdir(join(archiveRoot, "checklists-v1"), { recursive: true });
  const proposalsRoot = join(contextRoot, "proposals");
  let movedProposals = 0;
  for (const name of await listMaybe(proposalsRoot)) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    await rename(join(proposalsRoot, name), join(archiveRoot, "proposals-v1", name));
    movedProposals += 1;
  }
  for (const name of checklistFiles) {
    await rename(join(checklistRoot, name), join(archiveRoot, "checklists-v1", name));
  }
  if (profileSource !== "") await writeFile(join(archiveRoot, "PROJECT_PROFILE-v1.md"), profileSource, "utf8");
  for (const stale of ["PROJECT_CONTEXT_INDEX.md", "PROJECT_PROFILE.md", "checklists", "proposals/README.md", "reports/README.md", "archive/README.md", "config.yml"]) {
    await rm(join(contextRoot, stale), { recursive: true, force: true });
  }

  await initWorkspace({ workspaceRoot, kitVersion, agentsFile, writePolicy: policy, profile: profile.remainder, writeCatalogBlock: false });
  const rulesRoot = join(contextRoot, "rules");
  for (const rule of rules) await writeFile(join(rulesRoot, `${rule.id}.md`), serializeRule(rule), "utf8");

  const workspace = await loadWorkspace(workspaceRoot, { today });
  if (workspace.status !== "ok") return { status: "failed", reason: "migrated_workspace_invalid", details: workspace.failures };
  const catalog = await writeCatalog(workspace, { kitVersion });
  return {
    status: "ok",
    rules: rules.length,
    fromChecklists: drafts.filter((draft) => draft.origin.startsWith("checklists/")).length,
    fromProfile: drafts.filter((draft) => draft.origin === "PROJECT_PROFILE.md").length,
    movedProposals,
    catalog: { bytes: catalog.bytes, budget: workspace.config.budgets.catalog_bytes, agentsFile: catalog.agentsPath },
    needsRewrite: rules.length,
  };
}

export function extractBullets(source, origin) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const bullets = [];
  let marker;
  let current;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join(" ").replace(/\s+/gu, " ").trim();
    if (text !== "" && !TEMPLATE_BULLETS.has(text)) bullets.push({ text, marker: current.marker, origin });
    current = undefined;
  };
  for (const line of lines) {
    const markerMatch = LEGACY_MARKER.exec(line.trim());
    if (markerMatch) {
      flush();
      marker = { id: markerMatch[1] ?? markerMatch[3], source: markerMatch[2] ?? markerMatch[4] };
      continue;
    }
    if (line.startsWith("- ")) {
      flush();
      current = { lines: [line.slice(2)], marker };
      marker = undefined;
      continue;
    }
    if (current && /^\s{2,}\S/u.test(line)) {
      current.lines.push(line.trim());
      continue;
    }
    flush();
    if (line.trim() === "" || line.startsWith("#")) marker = undefined;
  }
  flush();
  return bullets;
}

export function splitProfile(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  const sections = normalized.split(/^(?=## )/mu);
  let rulesSection = "";
  const kept = [];
  for (const section of sections) {
    const heading = section.split("\n")[0];
    if (/^## Active Working Rules/u.test(heading)) {
      rulesSection = section;
      continue;
    }
    if (/^## Enabled Domains/u.test(heading)) continue;
    kept.push(section.replace(/^<!-- acp-rule:.*\n/gmu, ""));
  }
  const remainder = kept.join("").replace(/^# Project Profile/u, "# Profile").replace(/\n{3,}/gu, "\n\n").trimEnd();
  return { rulesSection, remainder: remainder === "" ? "" : `${remainder}\n` };
}

export function draftToRule(draft, usedIds, today, budgets = DEFAULT_CONFIG.budgets) {
  const baseId = draft.marker?.source
    ? draft.marker.source.replace(/^\d{4}-\d{2}-\d{2}-/u, "")
    : slugify(draft.text.split(/\s+/u).slice(0, 7).join(" ")) || "rule";
  let id = baseId.slice(0, 70).replace(/-+$/u, "") || "rule";
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId.slice(0, 66).replace(/-+$/u, "")}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  const repos = REPO_HINTS.filter(([, pattern]) => pattern.test(draft.text)).map(([name]) => name);
  const ops = OP_HINTS.filter(([, pattern]) => pattern.test(draft.text)).map(([name]) => name).slice(0, 2);
  const skills = [];
  if (ops.includes("pr")) skills.push("pawlogic-ship");
  if (ops.includes("sql")) skills.push("cloud-sql");
  const created = draft.marker?.source?.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] ?? today;
  const bodyNote = `(migrated draft; full original text is in archive/${draft.origin === "PROJECT_PROFILE.md" ? "PROJECT_PROFILE-v1.md" : `checklists-v1/${basename(draft.origin)}`})`;
  return {
    id,
    hook: truncateBytes(firstSentence(draft.text), budgets.hook_bytes),
    kind: GATE_HINT.test(draft.text) ? "gate" : "advice",
    applies_to: { repos, paths: [], ops, skills },
    supersedes: [],
    source: draft.marker?.source ?? `migration-v1:${draft.origin}`,
    created,
    consulted: 0,
    last_consulted: null,
    missed: 0,
    needs_rewrite: true,
    body: truncateBytes(`## Original\n\n${draft.text}`, budgets.body_bytes - byteLength(bodyNote) - 2) + `\n\n${bodyNote}`,
  };
}

function firstSentence(text) {
  const match = /^(.*?[.;。；！!？?])(?:\s|$)/u.exec(text);
  return (match ? match[1] : text).trim().replace(/[;:,]$/u, "");
}

export function truncateBytes(text, limit) {
  if (byteLength(text) <= limit) return text;
  let result = "";
  for (const character of text) {
    if (byteLength(result + character) > limit - 3) break;
    result += character;
  }
  return `${result.trimEnd()}…`;
}

async function listMaybe(directory) {
  try {
    return (await readdir(directory)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
