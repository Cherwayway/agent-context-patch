import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256Text } from "../../skills/evolve/runtime/index.mjs";
import { validateProposalDocument } from "../../skills/evolve/runtime/proposal.mjs";
import { createProposalStore } from "../../skills/evolve/runtime/proposal-store.mjs";

test("proposal CAS retries the exact audit source after one transient replacement failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-context-proposal-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proposalPath = join(root, "proposal.md");
  const after = await fixture("valid-auto.md");
  const before = replaceSectionContent(
    after
      .replace("status: applied", "status: approved")
      .replace(
        "updated_at: 2026-07-11T00:00:01Z",
        "updated_at: 2026-07-11T00:00:00Z",
      ),
    "Apply Attempts",
    "None.",
  );
  assert.deepEqual(validateProposalDocument(before, "proposal.md"), []);
  assert.deepEqual(validateProposalDocument(after, "proposal.md"), []);
  await writeFile(proposalPath, before, "utf8");
  let replacements = 0;
  const replacementSources = [];
  const store = createProposalStore({
    replaceFile: async (source, destination) => {
      replacements += 1;
      replacementSources.push(await readFile(source, "utf8"));
      if (replacements === 1) throw new Error("transient replacement failure");
      await rename(source, destination);
    },
  });

  const result = await store.writeProposalCas({
    proposalPath,
    expectedHash: sha256Text(before),
    source: after,
  });

  assert.deepEqual(result, {});
  assert.equal(replacements, 2);
  assert.deepEqual(replacementSources, [after, after]);
  assert.equal(await readFile(proposalPath, "utf8"), after);
});

test("proposal CAS treats a post-rename error as an idempotent success", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-context-proposal-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proposalPath = join(root, "proposal.md");
  const before = await fixture("valid-auto.md");
  const after = before.replace(
    "updated_at: 2026-07-11T00:00:01Z",
    "updated_at: 2026-07-11T00:00:02Z",
  );
  await writeFile(proposalPath, before, "utf8");
  let replacements = 0;
  const store = createProposalStore({
    replaceFile: async (source, destination) => {
      replacements += 1;
      await rename(source, destination);
      throw new Error("replacement succeeded but acknowledgement was lost");
    },
  });

  const result = await store.writeProposalCas({
    proposalPath,
    expectedHash: sha256Text(before),
    source: after,
  });

  assert.deepEqual(result, {});
  assert.equal(replacements, 1);
  assert.equal(await readFile(proposalPath, "utf8"), after);
});

async function fixture(name) {
  return readFile(
    join(
      import.meta.dirname,
      "..",
      "verification",
      "fixtures",
      "proposals",
      name,
    ),
    "utf8",
  );
}

function replaceSectionContent(source, heading, content) {
  const headingStart = source.indexOf(`## ${heading}`);
  assert.notEqual(headingStart, -1);
  const contentStart = source.indexOf("\n", headingStart) + 1;
  const nextHeading = source.indexOf("\n## ", contentStart);
  const contentEnd = nextHeading === -1 ? source.length : nextHeading;
  return `${source.slice(0, contentStart)}\n${content}\n${source.slice(contentEnd)}`;
}
