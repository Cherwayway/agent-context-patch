import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

const requiredFiles = [
  "README.md",
  "AGENT_INSTALL.md",
  "adapters/codex/AGENTS.fragment.md",
  "adapters/claude/CLAUDE.fragment.md",
  "skills/evolve/SKILL.md",
  "skills/evolve/references/proposal-schema.md",
  "skills/evolve/references/context-budget.md",
  "skills/evolve/references/cleanup-policy.md",
  "skills/evolve/references/domain-coding.md",
  "skills/evolve/references/domain-prd.md",
  "skills/evolve/references/domain-seo.md",
  "templates/.agent-context/PROJECT_CONTEXT_INDEX.md",
  "templates/.agent-context/PROJECT_PROFILE.md",
  "templates/.agent-context/config.yml",
  "install/install.ps1",
  "install/install.sh",
  "demos/markdown-smoke/.agent-context/PROJECT_CONTEXT_INDEX.md",
  "demos/fake-js-repo/.agent-context/PROJECT_PROFILE.md",
  "demos/fake-js-repo/.agent-context/proposals/2026-07-09-greeting-contract.md",
];

const failures = [];

for (const file of requiredFiles) {
  const path = join(root, file);
  if (!existsSync(path) || !statSync(path).isFile()) {
    failures.push(`Missing required file: ${file}`);
  }
}

const skill = read("skills/evolve/SKILL.md");
for (const token of [
  "$evolve init",
  "$evolve after-failure",
  "$evolve approve",
  "$evolve review-context",
  "$evolve weekly",
]) {
  if (!skill.includes(token)) {
    failures.push(`Skill is missing command: ${token}`);
  }
}

const proposalSchema = read("skills/evolve/references/proposal-schema.md");
for (const token of [
  "Observed Failure",
  "Evidence",
  "Root Cause",
  "Future Risk",
  "Proposed Patch",
  "Privacy Check",
]) {
  if (!proposalSchema.includes(token)) {
    failures.push(`Proposal schema is missing section: ${token}`);
  }
}

const demoProposal = read(
  "demos/fake-js-repo/.agent-context/proposals/2026-07-09-greeting-contract.md",
);
for (const token of [
  "status: applied",
  "current_fix_status: verified",
  "## Evidence",
  "npm test",
]) {
  if (!demoProposal.includes(token)) {
    failures.push(`Demo proposal is missing proof token: ${token}`);
  }
}

const demoProfile = read("demos/fake-js-repo/.agent-context/PROJECT_PROFILE.md");
if (!demoProfile.includes("Greeting output must preserve caller-provided names")) {
  failures.push("Demo profile does not include applied context patch.");
}

if (failures.length > 0) {
  console.error("Validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent Context Patch demo validation passed.");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
