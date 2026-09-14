#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyProposal, expireWorkspaceState, formatReceipt } from "./apply.mjs";
import { renderCatalog, writeCatalog } from "./catalog.mjs";
import { recordConsultation } from "./consult.mjs";
import { initWorkspace } from "./init.mjs";
import { syncMemoryIndex, scanMemory } from "./memory-bridge.mjs";
import { migrateV1 } from "./migrate-v1.mjs";
import { selectRules } from "./select.mjs";
import { buildWeeklyReport } from "./weekly.mjs";
import { CONTEXT_DIR, loadWorkspace, readTextMaybe } from "./workspace.mjs";

const USAGE = `usage: evolve <command> [options]

  init          create a Schema 2 workspace and render the catalog
  status        validate the workspace and print a JSON summary
  catalog       print the catalog block; --write re-renders it into the instruction file
  select        print rule bodies for a task: --signature '<json>' or --signature @file [--json]
  apply         apply one proposal: --proposal '<json>' or --proposal @file [--approved]
  consult       record use: --consulted a,b [--missed c,d]
  expire        archive expired STATE entries and re-render the catalog
  weekly        write reports/weekly-<date>.md [--memory-dir <dir>]
  memory-sync   regenerate a Claude memory index: --memory-dir <dir> [--dry-run]
  migrate-v1    convert a Schema 1 workspace in place (lossy, one-shot)
  receipt       format a no-candidate or blocked receipt: --detect s:reason --propose s:reason

common options: --workspace <dir> (default: nearest ancestor with ${CONTEXT_DIR}/config.yml), --today YYYY-MM-DD
`;

const arguments_ = process.argv.slice(2);
const command = arguments_[0];
const options = parseOptions(arguments_.slice(1));

try {
  const output = await run(command, options);
  if (output !== undefined) process.stdout.write(typeof output === "string" ? output : `${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exit(2);
}

async function run(name, opts) {
  const kitVersion = await readKitVersion();
  switch (name) {
    case "init": {
      const workspaceRoot = resolve(opts.workspace ?? process.cwd());
      return exitOn(await initWorkspace({ workspaceRoot, kitVersion, writePolicy: opts.policy ?? "auto", agentsFile: opts["agents-file"] ?? "AGENTS.md" }));
    }
    case "status": {
      const workspace = await loadWorkspace(await workspaceRoot(opts), { today: opts.today });
      if (workspace.status !== "ok") return exitOn({ status: "failed", reason: "workspace_invalid", details: workspace.failures });
      const catalog = renderCatalog(workspace, { kitVersion });
      return {
        status: "ok",
        workspaceRoot: workspace.workspaceRoot,
        rules: workspace.rules.length,
        needsRewrite: workspace.rules.filter((rule) => rule.needs_rewrite).length,
        state: workspace.state.length,
        catalogBytes: catalog.bytes,
        catalogBudget: workspace.config.budgets.catalog_bytes,
        writePolicy: workspace.config.write_policy,
      };
    }
    case "catalog": {
      const workspace = await loadWorkspace(await workspaceRoot(opts), { today: opts.today });
      if (workspace.status !== "ok") return exitOn({ status: "failed", reason: "workspace_invalid", details: workspace.failures });
      if (opts.write) {
        const result = await writeCatalog(workspace, { kitVersion });
        return { status: "ok", bytes: result.bytes, rules: result.rules, state: result.state, changed: result.changed };
      }
      return renderCatalog(workspace, { kitVersion }).text;
    }
    case "select": {
      const workspace = await loadWorkspace(await workspaceRoot(opts), { today: opts.today });
      if (workspace.status !== "ok") return exitOn({ status: "failed", reason: "workspace_invalid", details: workspace.failures });
      const signature = await readJsonOption(opts.signature, "--signature");
      const result = selectRules(workspace, signature);
      if (result.status !== "ok") return exitOn({ status: "failed", reason: "invalid_signature", details: result.failures });
      if (opts.json) return { status: "ok", selected: result.selected.map(({ id, kind, hook, score, reasons }) => ({ id, kind, hook, score, reasons })), omitted: result.omitted, bytes: result.bytes };
      return result.selected.length === 0 ? "" : `${result.text}${result.omitted.length > 0 ? `\n<!-- omitted by select budget: ${result.omitted.join(", ")} -->\n` : ""}`;
    }
    case "apply": {
      const proposal = await readJsonOption(opts.proposal, "--proposal");
      const result = await applyProposal({ workspaceRoot: await workspaceRoot(opts), proposal, approved: Boolean(opts.approved), today: opts.today, kitVersion });
      if (result.status === "applied") return `${JSON.stringify(result, null, 2)}\n${result.receipt}\n`;
      return exitOn(result);
    }
    case "consult": {
      const result = await recordConsultation({ workspaceRoot: await workspaceRoot(opts), consulted: list(opts.consulted), missed: list(opts.missed), today: opts.today });
      if (result.status !== "ok") return exitOn(result);
      return `${result.receipt}\n`;
    }
    case "expire":
      return exitOn(await expireWorkspaceState({ workspaceRoot: await workspaceRoot(opts), today: opts.today, kitVersion }));
    case "weekly": {
      let memoryCandidates = [];
      if (opts["memory-dir"]) {
        const scan = await scanMemory(resolve(opts["memory-dir"]));
        memoryCandidates = scan.status === "ok" ? scan.candidates : [];
      }
      return exitOn(await buildWeeklyReport({ workspaceRoot: await workspaceRoot(opts), today: opts.today, memoryCandidates }));
    }
    case "memory-sync": {
      if (!opts["memory-dir"]) throw new Error("memory-sync requires --memory-dir");
      return exitOn(await syncMemoryIndex({ memoryDir: resolve(opts["memory-dir"]), write: !opts["dry-run"] }));
    }
    case "migrate-v1":
      return exitOn(await migrateV1({ workspaceRoot: resolve(opts.workspace ?? process.cwd()), today: opts.today, kitVersion, agentsFile: opts["agents-file"] ?? "AGENTS.md" }));
    case "receipt": {
      const detect = stage(opts.detect, "no_candidate");
      const propose = stage(opts.propose, "not_needed");
      const apply = { status: "not_attempted", reason: propose.status === "blocked" ? "proposal_blocked" : "no_proposal" };
      return `${formatReceipt({ detect, propose, apply })}\n`;
    }
    case undefined:
    case "help":
    case "--help":
      return USAGE;
    default:
      throw new Error(`unknown command ${name}\n\n${USAGE}`);
  }
}

function exitOn(result) {
  if (result?.status && !["ok", "applied"].includes(result.status)) process.exitCode = 1;
  return result;
}

function stage(value, defaultStatus) {
  if (!value) return { status: defaultStatus, reason: "unspecified" };
  const [status, reason = "unspecified"] = String(value).split(":");
  if (!/^[a-z_]+$/u.test(status) || !/^[a-z0-9_]+$/u.test(reason)) throw new Error(`invalid stage value ${value}`);
  return { status, reason };
}

function list(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readJsonOption(value, flag) {
  if (typeof value !== "string" || value === "") throw new Error(`${flag} requires inline JSON or @file`);
  const source = value.startsWith("@") ? await readFile(resolve(value.slice(1)), "utf8") : value;
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${flag} is not valid JSON: ${error.message}`);
  }
}

async function workspaceRoot(opts) {
  if (opts.workspace) return resolve(opts.workspace);
  if (process.env.ACP_WORKSPACE) return resolve(process.env.ACP_WORKSPACE);
  let current = process.cwd();
  for (;;) {
    if ((await readTextMaybe(join(current, CONTEXT_DIR, "config.yml"))) !== undefined) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`no ${CONTEXT_DIR}/config.yml found from ${process.cwd()} upward; pass --workspace`);
    current = parent;
  }
}

async function readKitVersion() {
  try {
    const manifest = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "manifest.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseOptions(items) {
  const parsed = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument ${item}\n\n${USAGE}`);
    const key = item.slice(2);
    const next = items[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
