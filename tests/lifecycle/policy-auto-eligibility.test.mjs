import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  inspectProposalDocument,
  isPolicyAutoEligiblePlan,
} from "../../skills/evolve/runtime/proposal.mjs";

test("one production predicate owns static policy_auto eligibility", async () => {
  const source = await readFile(
    join(
      import.meta.dirname,
      "..",
      "verification",
      "fixtures",
      "proposals",
      "valid-auto.md",
    ),
    "utf8",
  );
  const inspected = inspectProposalDocument(source, "valid auto fixture");
  assert.deepEqual(inspected.failures, []);
  assert.equal(isPolicyAutoEligiblePlan(inspected.value.plan), true);

  const approvalOnlyTarget = structuredClone(inspected.value.plan);
  approvalOnlyTarget.operations[0].target = ".agent-context/config.yml";
  assert.equal(isPolicyAutoEligiblePlan(approvalOnlyTarget), false);

  const semanticRewrite = structuredClone(inspected.value.plan);
  semanticRewrite.semanticOperation = "rewrite";
  assert.equal(isPolicyAutoEligiblePlan(semanticRewrite), false);
});
