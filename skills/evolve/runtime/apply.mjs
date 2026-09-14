import { mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { renderCatalog, writeCatalog } from "./catalog.mjs";
import {
  addDays,
  byteLength,
  findPrivacyHazard,
  isIdentifier,
  isIsoDate,
  jaccard,
  sha256Text,
  similarityTokens,
  unifiedDiff,
} from "./text.mjs";
import { CONTEXT_DIR, inspectRule, inspectStateEntry, loadWorkspace, normalizeRule } from "./workspace.mjs";
import { isRecord, serializeFrontmatter, toYaml } from "./yaml.mjs";

export const TRIGGERS = new Set([
  "verification_failure",
  "review_failure",
  "user_correction",
  "independent_qa_defect",
  "stale_context",
  "repeated_observation",
  "agent_self_detected",
  "first_fix_failed_then_passed",
]);
export const OPERATIONS = new Set(["add", "supersede", "retire", "state_set", "state_clear", "profile"]);
const NARRATIVE_KEYS = ["observed", "evidence", "root_cause"];
const NARRATIVE_LIMIT = 800;
const PROPOSAL_KEYS = new Set(["id", "trigger", "fix_status", ...NARRATIVE_KEYS, "operations"]);
const LOCK_FILE = ".lock";

/**
 * Apply one proposal to a Schema 2 workspace in a single call: validate,
 * run every gate, write rule/state/profile files atomically, persist the
 * audit record with a unified diff, then re-render the catalog block.
 *
 * Result statuses: applied | approval_required | blocked | failed.
 */
export async function applyProposal({ workspaceRoot, proposal, approved = false, today, kitVersion, now } = {}) {
  const workspace = await loadWorkspace(workspaceRoot, { today });
  if (workspace.status !== "ok") return failure("workspace_invalid", workspace.failures);
  if (isRecord(proposal) && isIdentifier(proposal.id) && (await readMaybe(join(workspace.contextRoot, "proposals", `${proposal.id}.md`))) !== undefined) {
    return blocked("proposal_exists", proposal.id, []);
  }
  const plan = planProposal(workspace, proposal, { approved });
  if (plan.status !== "ready") return plan;
  if (workspace.config.write_policy === "propose" && !approved) {
    return { status: "approval_required", reason: "policy_requires_approval", proposalId: plan.proposalId, targets: plan.targets };
  }
  return commitPlan(workspace, plan, { kitVersion, now });
}

/** Validate a proposal and compute the exact file changes without writing. */
export function planProposal(workspace, proposal, { approved = false } = {}) {
  const envelope = inspectProposalEnvelope(proposal);
  if (envelope.length > 0) return failure("invalid_proposal", envelope);
  const proposalPath = join(workspace.contextRoot, "proposals", `${proposal.id}.md`);
  if (proposal.fix_status !== "verified") return blocked("current_fix_not_verified", proposal.id, []);

  const privacyFields = [...NARRATIVE_KEYS.map((key) => proposal[key] ?? ""), JSON.stringify(proposal.operations)];
  for (const field of privacyFields) {
    const hazard = findPrivacyHazard(field);
    if (hazard) return failure("privacy_hazard", [hazard]);
  }

  const { budgets, state: stateConfig } = workspace.config;
  const activeRules = new Map(workspace.rules.map((rule) => [rule.id, rule]));
  const nextRules = new Map(activeRules);
  const archived = [];
  const expiry = expireState(workspace.state, workspace.today);
  let nextState = expiry.active;
  const expiredEntries = expiry.expired;
  let nextProfile;
  const touched = new Set();

  for (const [index, operation] of proposal.operations.entries()) {
    const label = `operations[${index}]`;
    switch (operation.op) {
      case "add":
      case "supersede": {
        const rule = normalizeRuleInput(operation.rule, proposal, workspace.today);
        const failures = inspectRule(rule.data, rule.body, budgets);
        if (failures.length > 0) return failure("invalid_rule", failures.map((message) => `${label}: ${message}`));
        if (nextRules.has(rule.data.id) || archived.some((entry) => entry.id === rule.data.id)) {
          return failure("invalid_rule", [`${label}: rule ${rule.data.id} already exists`]);
        }
        const replaces = operation.op === "supersede" ? operation.replaces : [];
        for (const replacedId of replaces) {
          const replaced = nextRules.get(replacedId);
          if (!replaced) return failure("invalid_rule", [`${label}: replaced rule ${replacedId} is not active`]);
          nextRules.delete(replacedId);
          archived.push({ ...replaced, superseded_by: rule.data.id });
          touched.add(replacedId);
        }
        rule.data.supersedes = [...new Set([...rule.data.supersedes, ...replaces])];
        if (!approved) {
          const similar = findSimilar(rule.data.hook, [...nextRules.values()], budgets.similarity_block);
          if (similar.length > 0) {
            return blocked("similar_rule_exists", proposal.id, [], {
              similar: similar.map(({ id, score }) => ({ id, score: Number(score.toFixed(2)) })),
              hint: "supersede the similar rule or narrow the hook",
            });
          }
        }
        nextRules.set(rule.data.id, { ...normalizeRule(rule.data), body: rule.body });
        touched.add(rule.data.id);
        break;
      }
      case "retire": {
        const rule = nextRules.get(operation.id);
        if (!rule) return failure("invalid_rule", [`${label}: rule ${operation.id} is not active`]);
        nextRules.delete(operation.id);
        archived.push({ ...rule, retired: workspace.today, retired_reason: operation.reason });
        touched.add(operation.id);
        break;
      }
      case "state_set": {
        const entry = normalizeStateInput(operation.entry, workspace.today, stateConfig);
        const failures = inspectStateEntry(entry, stateConfig, workspace.today);
        if (failures.length > 0) return failure("invalid_state", failures.map((message) => `${label}: ${message}`));
        nextState = [...nextState.filter((existing) => existing.id !== entry.id), entry];
        break;
      }
      case "state_clear": {
        if (!nextState.some((entry) => entry.id === operation.id)) {
          return failure("invalid_state", [`${label}: state entry ${operation.id} does not exist`]);
        }
        nextState = nextState.filter((entry) => entry.id !== operation.id);
        break;
      }
      case "profile": {
        if (sha256Text(workspace.profile) !== operation.before_hash) {
          return { status: "blocked", reason: "profile_changed", proposalId: proposal.id, targets: [], details: { expected: operation.before_hash, actual: sha256Text(workspace.profile) } };
        }
        nextProfile = operation.content;
        break;
      }
      default:
        return failure("invalid_proposal", [`${label}: unsupported op`]);
    }
  }

  const nextWorkspace = { ...workspace, rules: [...nextRules.values()].sort((a, b) => a.id.localeCompare(b.id)), state: nextState };
  const catalog = renderCatalog(nextWorkspace);
  if (!approved && catalog.bytes > budgets.catalog_bytes) {
    return blocked("catalog_budget_exceeded", proposal.id, [], {
      catalog_bytes: catalog.bytes,
      budget: budgets.catalog_bytes,
      hint: "supersede or retire a rule before adding another",
    });
  }

  const writes = [];
  const removes = [];
  for (const id of touched) {
    const before = activeRules.get(id);
    const after = nextRules.get(id);
    const archivedEntry = archived.find((entry) => entry.id === id);
    if (after) {
      writes.push({ target: `${CONTEXT_DIR}/rules/${id}.md`, before: before?.raw ?? null, after: serializeRule(after) });
    }
    if (before && !after) {
      removes.push({ target: `${CONTEXT_DIR}/rules/${id}.md`, before: before.raw });
      writes.push({ target: `${CONTEXT_DIR}/archive/rules/${id}.md`, before: null, after: serializeRule(archivedEntry) });
    }
  }
  const stateChanged = toYaml(stateDocument(nextState)) !== toYaml(stateDocument(workspace.state));
  if (stateChanged || expiredEntries.length > 0) {
    const beforeState = workspace.state.length === 0 ? null : toYaml(stateDocument(workspace.state));
    writes.push({ target: `${CONTEXT_DIR}/STATE.yml`, before: beforeState, after: toYaml(stateDocument(nextState)) });
  }
  if (nextProfile !== undefined && nextProfile !== workspace.profile) {
    writes.push({ target: `${CONTEXT_DIR}/PROFILE.md`, before: workspace.profile, after: nextProfile });
  }
  if (writes.length === 0 && removes.length === 0) return blocked("no_effective_change", proposal.id, []);

  const targets = [...new Set([...writes.map((write) => write.target), ...removes.map((remove) => remove.target)])].sort();
  const diff = [...removes.map((remove) => unifiedDiff(remove.before, null, remove.target, remove.target)), ...writes.map((write) => unifiedDiff(write.before, write.after, write.target, write.target))]
    .filter((chunk) => chunk !== "")
    .join("");
  return {
    status: "ready",
    proposalId: proposal.id,
    proposalPath,
    proposal,
    writes,
    removes,
    targets,
    diff,
    catalog,
    expired: expiredEntries.map((entry) => entry.id),
    nextWorkspace,
  };
}

async function commitPlan(workspace, plan, { kitVersion, now = new Date() }) {
  const lock = await acquireLock(workspace.contextRoot);
  if (!lock) return { status: "blocked", reason: "workspace_locked", proposalId: plan.proposalId, targets: plan.targets };
  const backups = [];
  try {
    const existingAudit = await readMaybe(plan.proposalPath);
    if (existingAudit !== undefined) return { status: "blocked", reason: "proposal_exists", proposalId: plan.proposalId, targets: plan.targets };

    for (const remove of plan.removes) {
      const absolute = join(workspace.workspaceRoot, remove.target);
      backups.push({ absolute, content: remove.before });
      await unlink(absolute);
    }
    for (const write of plan.writes) {
      const absolute = join(workspace.workspaceRoot, write.target);
      backups.push({ absolute, content: write.before });
      await mkdir(dirname(absolute), { recursive: true });
      await atomicWrite(absolute, write.after);
    }
    const appliedAt = (now instanceof Date ? now : new Date(now)).toISOString();
    const audit = renderAudit(plan, { appliedAt, kitVersion: kitVersion ?? workspace.config.kit_version });
    await mkdir(dirname(plan.proposalPath), { recursive: true });
    await atomicWrite(plan.proposalPath, audit);
    const catalog = await writeCatalog({ ...plan.nextWorkspace, workspaceRoot: workspace.workspaceRoot }, { renderedAt: appliedAt, kitVersion });
    return {
      status: "applied",
      proposalId: plan.proposalId,
      targets: plan.targets,
      expired: plan.expired,
      catalog: { bytes: catalog.bytes, rules: catalog.rules, state: catalog.state, agentsFile: relative(workspace.workspaceRoot, catalog.agentsPath) },
      receipt: formatApplyReceipt({ proposalId: plan.proposalId, targets: plan.targets, catalog }),
    };
  } catch (error) {
    for (const backup of [...backups].reverse()) {
      try {
        if (backup.content === null) await rm(backup.absolute, { force: true });
        else await writeFile(backup.absolute, backup.content, "utf8");
      } catch {
        // best effort rollback
      }
    }
    return { status: "failed", reason: "commit_failed", proposalId: plan.proposalId, targets: plan.targets, details: [String(error?.message ?? error)] };
  } finally {
    await releaseLock(lock);
  }
}

/** Archive expired STATE entries and re-render the catalog. */
export async function expireWorkspaceState({ workspaceRoot, today, kitVersion } = {}) {
  const workspace = await loadWorkspace(workspaceRoot, { today });
  if (workspace.status !== "ok") return failure("workspace_invalid", workspace.failures);
  const { active, expired } = expireState(workspace.state, workspace.today);
  if (expired.length > 0) {
    const archivePath = join(workspace.contextRoot, "archive", "state.yml");
    await mkdir(dirname(archivePath), { recursive: true });
    const previous = (await readMaybe(archivePath)) ?? "";
    await writeFile(archivePath, `${previous}${toYaml(stateDocument(expired.map((entry) => ({ ...entry, archived: workspace.today }))))}`, "utf8");
    await atomicWrite(join(workspace.contextRoot, "STATE.yml"), toYaml(stateDocument(active)));
  }
  const catalog = await writeCatalog({ ...workspace, state: active }, { kitVersion });
  return { status: "ok", expired: expired.map((entry) => entry.id), catalog: { bytes: catalog.bytes, rules: catalog.rules, state: catalog.state, changed: catalog.changed } };
}

export function expireState(state, today) {
  const active = [];
  const expired = [];
  for (const entry of state) {
    if (entry.expires < today) expired.push(entry);
    else active.push(entry);
  }
  return { active, expired };
}

export function findSimilar(hook, rules, threshold) {
  const tokens = similarityTokens(hook);
  return rules
    .map((rule) => ({ id: rule.id, score: jaccard(tokens, similarityTokens(rule.hook)) }))
    .filter(({ score }) => score >= threshold)
    .sort((left, right) => right.score - left.score);
}

export function inspectProposalEnvelope(proposal) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  expect(isRecord(proposal), "proposal must be an object");
  if (!isRecord(proposal)) return failures;
  for (const key of Object.keys(proposal)) expect(PROPOSAL_KEYS.has(key), `unsupported key ${key}`);
  expect(isIdentifier(proposal.id), "id must be a lowercase kebab-case identifier");
  expect(TRIGGERS.has(proposal.trigger), `trigger must be one of ${[...TRIGGERS].join(", ")}`);
  expect(["verified", "unverified"].includes(proposal.fix_status), "fix_status must be verified or unverified");
  expect(typeof proposal.evidence === "string" && proposal.evidence.trim() !== "", "evidence is required");
  for (const key of NARRATIVE_KEYS) {
    if (proposal[key] === undefined) continue;
    expect(typeof proposal[key] === "string" && byteLength(proposal[key]) <= NARRATIVE_LIMIT, `${key} must be text of at most ${NARRATIVE_LIMIT} bytes`);
  }
  expect(Array.isArray(proposal.operations) && proposal.operations.length > 0 && proposal.operations.length <= 20, "operations must contain 1 to 20 entries");
  if (!Array.isArray(proposal.operations)) return failures;
  for (const [index, operation] of proposal.operations.entries()) {
    const label = `operations[${index}]`;
    if (!isRecord(operation) || !OPERATIONS.has(operation.op)) {
      failures.push(`${label}: op must be one of ${[...OPERATIONS].join(", ")}`);
      continue;
    }
    if (operation.op === "add" || operation.op === "supersede") {
      expect(isRecord(operation.rule), `${label}: rule must be an object`);
      if (operation.op === "supersede") {
        expect(Array.isArray(operation.replaces) && operation.replaces.length > 0 && operation.replaces.every(isIdentifier), `${label}: replaces must list rule ids`);
      }
    } else if (operation.op === "retire" || operation.op === "state_clear") {
      expect(isIdentifier(operation.id), `${label}: id must be an identifier`);
      if (operation.op === "retire") expect(typeof operation.reason === "string" && operation.reason.trim() !== "", `${label}: reason is required`);
    } else if (operation.op === "state_set") {
      expect(isRecord(operation.entry), `${label}: entry must be an object`);
    } else if (operation.op === "profile") {
      expect(typeof operation.content === "string", `${label}: content must be text`);
      expect(typeof operation.before_hash === "string" && /^[a-f0-9]{64}$/u.test(operation.before_hash), `${label}: before_hash must be a sha256 hex digest`);
    }
  }
  return failures;
}

function normalizeRuleInput(rule, proposal, today) {
  const input = isRecord(rule) ? rule : {};
  const applies = isRecord(input.applies_to) ? input.applies_to : {};
  const data = {
    id: input.id,
    hook: typeof input.hook === "string" ? input.hook.trim() : input.hook,
    kind: input.kind ?? "advice",
    applies_to: {
      repos: applies.repos ?? [],
      paths: applies.paths ?? [],
      ops: applies.ops ?? [],
      skills: applies.skills ?? [],
    },
    supersedes: input.supersedes ?? [],
    source: proposal.id,
    created: today,
    consulted: 0,
    last_consulted: null,
    missed: 0,
  };
  for (const key of Object.keys(input)) {
    if (!["id", "hook", "kind", "applies_to", "supersedes", "body"].includes(key)) data[key] = input[key];
  }
  const body = typeof input.body === "string" ? input.body.replaceAll("\r\n", "\n").trim() : input.body ?? "";
  return { data, body };
}

function normalizeStateInput(entry, today, stateConfig) {
  const input = isRecord(entry) ? entry : {};
  const ttl = Number.isInteger(input.ttl_days) ? input.ttl_days : stateConfig.default_ttl_days;
  const normalized = {
    id: input.id,
    expires: isIsoDate(input.expires) ? input.expires : addDays(today, ttl),
    text: typeof input.text === "string" ? input.text.trim() : input.text,
    repos: input.repos ?? [],
    created: today,
  };
  for (const key of Object.keys(input)) {
    if (!["id", "expires", "text", "repos", "ttl_days"].includes(key)) normalized[key] = input[key];
  }
  return normalized;
}

export function serializeRule(rule) {
  const data = {
    id: rule.id,
    hook: rule.hook,
    kind: rule.kind,
    applies_to: rule.applies_to,
    supersedes: rule.supersedes,
    source: rule.source,
    created: rule.created,
    consulted: rule.consulted ?? 0,
    last_consulted: rule.last_consulted ?? null,
    missed: rule.missed ?? 0,
  };
  if (rule.needs_rewrite) data.needs_rewrite = true;
  if (rule.superseded_by) data.superseded_by = rule.superseded_by;
  if (rule.retired) data.retired = rule.retired;
  if (rule.retired_reason) data.retired_reason = rule.retired_reason;
  return serializeFrontmatter(data, rule.body ?? "");
}

function stateDocument(state) {
  return state.map((entry) => {
    const document = { id: entry.id, expires: entry.expires };
    if (entry.repos?.length > 0) document.repos = entry.repos;
    document.text = entry.text;
    if (entry.created) document.created = entry.created;
    if (entry.archived) document.archived = entry.archived;
    return document;
  });
}

function renderAudit(plan, { appliedAt, kitVersion }) {
  const { proposal } = plan;
  const frontmatter = {
    id: proposal.id,
    trigger: proposal.trigger,
    fix_status: proposal.fix_status,
    operations: proposal.operations.map((operation) => operation.op),
    targets: plan.targets,
    before_hashes: Object.fromEntries(plan.writes.filter((write) => write.before !== null).map((write) => [write.target, sha256Text(write.before)])),
    after_hashes: Object.fromEntries(plan.writes.map((write) => [write.target, sha256Text(write.after)])),
    decision: "auto_applied",
    applied_at: appliedAt,
    kit_version: kitVersion,
    catalog_bytes: plan.catalog.bytes,
  };
  const sections = [];
  for (const key of NARRATIVE_KEYS) {
    if (typeof proposal[key] === "string" && proposal[key].trim() !== "") {
      sections.push(`## ${key === "root_cause" ? "Root cause" : key[0].toUpperCase() + key.slice(1)}\n\n${proposal[key].trim()}\n`);
    }
  }
  sections.push(`## Diff\n\n\`\`\`diff\n${plan.diff}\`\`\`\n`);
  return serializeFrontmatter(frontmatter, sections.join("\n"));
}

export function formatApplyReceipt({ proposalId, targets, catalog }) {
  return `Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=${proposalId}; targets=${targets.join(",")}; catalog=${catalog.bytes}B/${catalog.rules} rules.`;
}

export function formatReceipt({ detect, propose, apply, proposalId, targets = [], catalog }) {
  const stage = (name, value, success) => `${name}=${value.status}${value.status === success ? "" : `(${value.reason})`}`;
  const fields = [stage("detect", detect, "candidate"), stage("propose", propose, "created"), stage("apply", apply, "applied")];
  if (proposalId) fields.push(`proposal=${proposalId}`);
  if (targets.length > 0) fields.push(`targets=${targets.join(",")}`);
  if (catalog) fields.push(`catalog=${catalog.bytes}B/${catalog.rules} rules`);
  return `Evolution outcome: ${fields.join("; ")}.`;
}

function failure(reason, details = []) {
  return { status: "failed", reason, details };
}

function blocked(reason, proposalId, targets, details) {
  return { status: "blocked", reason, proposalId, targets, ...(details ? { details } : {}) };
}

async function acquireLock(contextRoot) {
  const path = join(contextRoot, LOCK_FILE);
  try {
    await mkdir(contextRoot, { recursive: true });
    const handle = await open(path, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
    return { handle, path };
  } catch (error) {
    if (error?.code === "EEXIST") return undefined;
    throw error;
  }
}

async function releaseLock(lock) {
  await lock.handle.close().catch(() => {});
  await unlink(lock.path).catch(() => {});
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function readMaybe(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}
