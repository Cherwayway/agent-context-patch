import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { writeCatalog } from "./catalog.mjs";
import { CONTEXT_DIR, DEFAULT_CONFIG, loadWorkspace, readTextMaybe } from "./workspace.mjs";
import { toYaml } from "./yaml.mjs";

export const README = `# Agent context (Schema 2)

- rules/<id>.md      one rule per file: frontmatter (hook, kind, applies_to) + short body
- STATE.yml          dated working state; every entry expires and is archived automatically
- PROFILE.md         verified workspace facts only; never rules
- proposals/<id>.md  audit record per applied change: evidence + unified diff
- reports/           rebuildable weekly reviews
- archive/           superseded or retired rules, expired state, pre-migration history

The always-on view of this directory is the \`acp-catalog\` block that evolve
renders into the workspace instruction file. Edit rules through \`evolve apply\`;
hand edits are allowed but the catalog must be re-rendered afterwards.
`;

export const PROFILE_TEMPLATE = `# Profile

Verified workspace facts only. Replace stale facts instead of appending history.

## Workspace

- Repositories:
- Environments:

## Commands

- Build:
- Test:
- Lint / typecheck:

## Verification State

- Last verified at: never
`;

export function renderConfig({ kitVersion, writePolicy = "auto", agentsFile = "AGENTS.md" }) {
  return toYaml({
    ...DEFAULT_CONFIG,
    kit_version: kitVersion,
    write_policy: writePolicy,
    agents_file: agentsFile,
    budgets: { ...DEFAULT_CONFIG.budgets },
    state: { ...DEFAULT_CONFIG.state },
  });
}

/** Create a fresh Schema 2 workspace; existing files are left untouched. */
export async function initWorkspace({ workspaceRoot, kitVersion = DEFAULT_CONFIG.kit_version, writePolicy = "auto", agentsFile = "AGENTS.md", profile, writeCatalogBlock = true } = {}) {
  const contextRoot = join(workspaceRoot, CONTEXT_DIR);
  const created = [];
  for (const directory of ["rules", "proposals", "reports", "archive"]) {
    await mkdir(join(contextRoot, directory), { recursive: true });
  }
  const files = [
    ["config.yml", renderConfig({ kitVersion, writePolicy, agentsFile })],
    ["README.md", README],
    ["STATE.yml", "[]\n"],
    ["PROFILE.md", profile && profile.trim() !== "" ? profile : PROFILE_TEMPLATE],
  ];
  for (const [name, content] of files) {
    const path = join(contextRoot, name);
    const exists = (await readTextMaybe(path)) !== undefined;
    const overwrite = name === "PROFILE.md" && profile !== undefined;
    if (exists && !overwrite) continue;
    await writeFile(path, content, "utf8");
    created.push(`${CONTEXT_DIR}/${name}`);
  }
  const workspace = await loadWorkspace(workspaceRoot);
  if (workspace.status !== "ok") return { status: "failed", reason: "workspace_invalid", details: workspace.failures, created };
  let catalog;
  if (writeCatalogBlock) catalog = await writeCatalog(workspace, { kitVersion });
  return { status: "ok", created, catalog: catalog ? { bytes: catalog.bytes, agentsFile: catalog.agentsPath } : undefined };
}
