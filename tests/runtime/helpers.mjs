import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyProposal, initWorkspace } from "../../skills/evolve/runtime/index.mjs";

export const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
export const runtimeRoot = join(repositoryRoot, "skills", "evolve", "runtime");
export const KIT = "9.9.9";
export const TODAY = "2026-09-14";

/** Create a throwaway Schema 2 workspace; call `dispose()` when done. */
export async function createWorkspace({ writePolicy = "auto", profile, prefix = "acp-runtime-" } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const init = await initWorkspace({ workspaceRoot: root, kitVersion: KIT, writePolicy, profile });
  if (init.status !== "ok") throw new Error(`workspace init failed: ${JSON.stringify(init)}`);
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

export function rule(id, overrides = {}) {
  return {
    id,
    hook: `Hook ${id}`,
    kind: "advice",
    applies_to: { repos: [], paths: [], ops: [], skills: [] },
    body: `Body for ${id}.`,
    ...overrides,
  };
}

export function proposal(id, operations, overrides = {}) {
  return {
    id,
    trigger: "verification_failure",
    fix_status: "verified",
    evidence: `tests/runtime fixture ${id}`,
    operations,
    ...overrides,
  };
}

export async function seed(root, id, operations, { today = TODAY, approved = false } = {}) {
  const result = await applyProposal({ workspaceRoot: root, proposal: proposal(id, operations), approved, today, kitVersion: KIT, now: `${today}T08:00:00.000Z` });
  if (result.status !== "applied") throw new Error(`seed ${id} failed: ${JSON.stringify(result)}`);
  return result;
}
