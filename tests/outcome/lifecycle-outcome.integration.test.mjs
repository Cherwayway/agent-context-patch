import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reconcileWorkspaceProposalLifecycles } from "../../skills/evolve/runtime/lifecycle.mjs";
import { finalizeEvolutionOutcome } from "../../skills/evolve/runtime/outcome.mjs";

const fixtureRoot = join(import.meta.dirname, "..", "verification", "fixtures");

test("the delivery checkpoint reports applied only after the real coordinator records the audit", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-outcome-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  const proposalsRoot = join(contextRoot, "proposals");
  await mkdir(proposalsRoot, { recursive: true });
  await writeFile(
    join(contextRoot, "config.yml"),
    await readFile(
      join(fixtureRoot, "config", "valid-auto-inline.yml"),
      "utf8",
    ),
    "utf8",
  );

  const proposalPath = join(proposalsRoot, "2026-07-19-outcome.md");
  const appliedFixture = await readFile(
    join(fixtureRoot, "proposals", "valid-auto.md"),
    "utf8",
  );
  let interrupted = appliedFixture.replace("status: applied", "status: proposed");
  interrupted = replaceSectionContent(interrupted, "Decision Log", "None.");
  interrupted = replaceSectionContent(interrupted, "Apply Attempts", "None.");
  await writeFile(proposalPath, interrupted, "utf8");

  const reconciliation = await reconcileWorkspaceProposalLifecycles({
    workspaceRoot,
  });
  const result = finalizeEvolutionOutcome({
    detect: {
      status: "candidate",
      reason: "failed_verification_later_passed",
    },
    propose: { status: "created", reason: "proposal_created" },
    proposalId: "fixture-valid-auto",
    reconciliation,
  });

  assert.deepEqual(result.apply, { status: "applied", reason: "applied" });
  assert.deepEqual(result.targets, [".agent-context/PROJECT_PROFILE.md"]);
  assert.equal(result.receipt.kind, "applied");
  assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
  assert.match(await readFile(proposalPath, "utf8"), /result: applied/u);
});

function replaceSectionContent(source, heading, content) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `fixture is missing ${marker}`);
  const next = source.indexOf("\n## ", start + marker.length);
  const end = next === -1 ? source.length : next;
  return `${source.slice(0, start + marker.length)}\n\n${content}\n${source.slice(end)}`;
}
