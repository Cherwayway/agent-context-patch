import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import * as evolveRuntime from "../../skills/evolve/runtime/index.mjs";
import { compileWorkspaceContext } from "../../skills/evolve/runtime/context-compiler.mjs";
import { validateProposalDocument } from "../../skills/evolve/runtime/proposal.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const execFileAsync = promisify(execFile);
const compilerCli = join(
  repositoryRoot,
  "skills",
  "evolve",
  "runtime",
  "context-compiler-cli.mjs",
);
const proposalFixtureRoot = join(
  repositoryRoot,
  "tests",
  "verification",
  "fixtures",
  "proposals",
);
const RESULT_KEYS = [
  "attention",
  "catalog",
  "content",
  "metrics",
  "mode",
  "reason",
  "schemaVersion",
  "selectedPackIds",
  "selections",
  "status",
  "warnings",
];
const METRIC_KEYS = [
  "fullContextBytes",
  "modelVisibleBytes",
  "reductionBasisPoints",
  "savedBytes",
];
const BODY_SENTINEL = "PROPOSAL_BODY_SENTINEL_MUST_NOT_REACH_MODEL";
const EXTERNAL_SENTINEL = "EXTERNAL_PRIVATE_SENTINEL_MUST_NOT_REACH_MODEL";

test("progressive routing selects one relevant pack while preserving core and unmarked legacy context", async (t) => {
  const workspaceRoot = await makeWorkspace(t);

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assertResultEnvelope(result);
  assert.equal(result.status, "compiled");
  assert.equal(result.mode, "progressive");
  assert.deepEqual(result.selectedPackIds, ["package-boundary"]);
  assert.match(result.content, /CORE_AUTHORITY_SENTINEL/u);
  assert.match(result.content, /核心安全边界/u);
  assert.match(result.content, /LEGACY_UNMARKED_MUST_SURVIVE/u);
  assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.doesNotMatch(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
  assert.doesNotMatch(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
  assert.doesNotMatch(result.content, /DESTRUCTIVE_SAFETY_BODY_SENTINEL/u);
  assert.deepEqual(
    new Set(result.catalog.map(({ id }) => id)),
    new Set([
      "workspace-safety",
      "package-boundary",
      "docs-workflow",
      "release-workflow",
      "destructive-safety",
    ]),
  );
  assertMetrics(result);
  assert.ok(
    result.metrics.reductionBasisPoints >= 5_000,
    `expected at least 50% byte reduction, got ${result.metrics.reductionBasisPoints} basis points`,
  );
});

test("an empty domain signature conservatively routes as every enabled domain", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await enableResearchDomain(workspaceRoot);
  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.selectedPackIds, ["package-boundary", "research-only"]);
  assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.match(result.content, /RESEARCH_ONLY_BODY_SENTINEL/u);
  assert.doesNotMatch(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
});

test("byte metrics compare against the same task-relevant legacy checklist set", async (t) => {
  const baselineRoot = await makeWorkspace(t);
  const multiDomainRoot = await makeWorkspace(t);
  await enableResearchDomain(multiDomainRoot);
  const task = taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  });

  const baseline = await compile(baselineRoot, task);
  const multiDomain = await compile(multiDomainRoot, task);

  assert.equal(multiDomain.metrics.fullContextBytes, baseline.metrics.fullContextBytes);
  assert.deepEqual(multiDomain.selectedPackIds, baseline.selectedPackIds);
  assert.ok(multiDomain.catalog.some(({ id }) => id === "research-only"));
  assert.equal(JSON.stringify(multiDomain).includes("RESEARCH_ONLY_BODY_SENTINEL"), false);
});

test("context IDs are workspace-global even when the duplicate is in another enabled domain", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await enableResearchDomain(workspaceRoot, { id: "package-boundary" });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.mode, "legacy_full");
  assert.ok(result.warnings.includes("duplicate_context_id"));
  assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.doesNotMatch(result.content, /RESEARCH_ONLY_BODY_SENTINEL/u);
});

test("an exact requested pack can expand beyond the task-relevant checklist set", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await enableResearchDomain(workspaceRoot, { includeCore: true });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["code_change"],
    paths: ["src/index.mjs"],
    domains: ["coding"],
    requestedPacks: ["research-only"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.selectedPackIds, ["research-only"]);
  assert.match(result.content, /RESEARCH_ONLY_BODY_SENTINEL/u);
  assert.match(result.content, /RESEARCH_CORE_BODY_SENTINEL/u);
  assert.doesNotMatch(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
});

test("semantic identifiers containing privacy vocabulary remain routable", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const id = "password-requirements";
  await enableResearchDomain(workspaceRoot, { id });
  await writeProposal(workspaceRoot, {
    id: "semantic-id-attention",
    attentionTargets: [`context:${id}`],
  });

  const result = await compile(workspaceRoot, taskSignature({
    domains: ["coding"],
    requestedPacks: [id],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.selectedPackIds, [id]);
  assert.equal(result.attention.length, 1);
  assert.deepEqual(result.attention[0].targets, [`context:${id}`]);
});

test("proposal attention does not target an unloaded core block from another domain", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await enableResearchDomain(workspaceRoot, { includeCore: true });
  await writeProposal(workspaceRoot, {
    id: "research-core-attention",
    attentionTargets: ["context:research-core"],
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.attention, []);
  assert.doesNotMatch(result.content, /RESEARCH_CORE_BODY_SENTINEL/u);
  assert.doesNotMatch(result.content, /research-core-attention/u);
  const researchCore = result.catalog.find(({ id }) => id === "research-core");
  assert.equal(researchCore.selected, false);
});

test("canonical and legacy rule markers both route exact proposal attention", async (t) => {
  for (const variant of [
    {
      name: "canonical marker with canonical edge",
      marker:
        "<!-- acp-rule: canonical-rule#1; source: canonical-rule; subsumes: none -->",
      attentionTarget: "rule:canonical-rule#1",
    },
    {
      name: "canonical marker with legacy edge",
      marker:
        "<!-- acp-rule: canonical-alias-rule#1; source: canonical-alias-rule; subsumes: none -->",
      attentionTarget: "rule:canonical-alias-rule-1",
    },
    {
      name: "legacy marker with legacy edge",
      marker:
        "<!-- acp-rule: id=legacy-rule-1 source=legacy-rule subsumes=none -->",
      attentionTarget: "rule:legacy-rule-1",
    },
    {
      name: "legacy marker with normalized canonical edge",
      marker:
        "<!-- acp-rule: id=normalized-rule-1 source=normalized-rule subsumes=none -->",
      attentionTarget: "rule:normalized-rule#1",
    },
    {
      name: "hyphenated numeric source with legacy edge",
      marker:
        "<!-- acp-rule: source-1#2; source: source-1; subsumes: none -->",
      attentionTarget: "rule:source-1-2",
    },
  ]) {
    await t.test(variant.name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "PACKAGE_BOUNDARY_SENTINEL",
        marker: variant.marker,
      });
      await writeProposal(workspaceRoot, {
        id: `proposal-${variant.name.replaceAll(" ", "-")}`,
        attentionTargets: [variant.attentionTarget],
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "compiled");
      assert.equal(result.attention.length, 1);
      assert.deepEqual(result.attention[0].targets, [variant.attentionTarget]);
      assert.ok(result.content.includes(variant.marker));
      assert.equal(
        result.warnings.includes("legacy_rule_marker_format"),
        false,
      );
    });
  }
});

test("canonical and legacy replacement markers accept their documented subsumes dialects", async (t) => {
  for (const variant of [
    {
      name: "canonical replacement",
      marker:
        "<!-- acp-rule: replacement-rule#2; source: replacement-rule; subsumes: retired-rule#1 -->",
      attentionTarget: "rule:replacement-rule#2",
    },
    {
      name: "legacy replacement",
      marker:
        "<!-- acp-rule: id=legacy-replacement-2 source=legacy-replacement subsumes=retired-rule-1 -->",
      attentionTarget: "rule:legacy-replacement#2",
    },
  ]) {
    await t.test(variant.name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "PACKAGE_BOUNDARY_SENTINEL",
        marker: variant.marker,
      });
      await writeProposal(workspaceRoot, {
        id: `proposal-${variant.name.replaceAll(" ", "-")}`,
        attentionTargets: [variant.attentionTarget],
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "compiled");
      assert.equal(result.attention.length, 1);
      assert.deepEqual(result.attention[0].targets, [variant.attentionTarget]);
      assert.ok(result.content.includes(variant.marker));
    });
  }
});

test("a canonical rule marker remains routable in a CR-only Active Context document", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const marker =
    "<!-- acp-rule: carriage-return-rule#1; source: carriage-return-rule; subsumes: none -->";
  await insertRuleMarker(workspaceRoot, {
    sentinel: "PACKAGE_BOUNDARY_SENTINEL",
    marker,
  });
  const checklistPath = join(
    workspaceRoot,
    ".agent-context",
    "checklists",
    "coding.md",
  );
  const checklist = await readFile(checklistPath, "utf8");
  await writeFile(checklistPath, checklist.replaceAll("\n", "\r"), "utf8");
  await writeProposal(workspaceRoot, {
    id: "carriage-return-attention",
    attentionTargets: ["rule:carriage-return-rule#1"],
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 1);
  assert.deepEqual(
    result.attention[0].targets,
    ["rule:carriage-return-rule#1"],
  );
});

test("a known rule in an unselected pack is irrelevant even at high risk", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await insertRuleMarker(workspaceRoot, {
    sentinel: "DOCS_WORKFLOW_BODY_SENTINEL",
    marker:
      "<!-- acp-rule: docs-rule#1; source: docs-rule; subsumes: none -->",
  });
  await writeProposal(workspaceRoot, {
    id: "unselected-rule-attention",
    attentionTargets: ["rule:docs-rule#1"],
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.attention, []);
  assert.equal(result.warnings.includes("dangling_attention_target"), false);
  assert.doesNotMatch(result.content, /unselected-rule-attention/u);
});

test("dangling context and rule attention are visible and risk-sensitive", async (t) => {
  for (const [kind, target] of [
    ["context", "context:missing-context"],
    ["rule", "rule:missing-rule#1"],
  ]) {
    await t.test(`${kind} target at normal risk`, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await writeProposal(workspaceRoot, {
        id: `dangling-normal-${kind}`,
        attentionTargets: [target],
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "compiled");
      assert.equal(result.mode, "progressive");
      assert.deepEqual(result.attention, []);
      assert.ok(result.warnings.includes("dangling_attention_target"));
      assert.match(result.content, /not present in enabled Active Context/u);
      assert.doesNotMatch(result.content, new RegExp(`dangling-normal-${kind}`, "u"));
    });

    await t.test(`${kind} target at high risk`, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await writeProposal(workspaceRoot, {
        id: `dangling-high-${kind}`,
        attentionTargets: [target],
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["delete_cache"],
        paths: ["tmp/cache.bin"],
        domains: ["coding"],
        risk: "high",
      }));

      assert.equal(result.status, "fallback");
      assert.equal(result.mode, "legacy_full");
      assert.equal(result.reason, "high_risk_dangling_attention_target");
      assert.ok(result.warnings.includes("dangling_attention_target"));
      assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
      assert.equal(result.metrics.savedBytes, 0);
    });
  }
});

test("a mixed known and dangling edge keeps the relevant pointer visible", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await writeProposal(workspaceRoot, {
    id: "mixed-dangling-attention",
    attentionTargets: [
      "context:package-boundary",
      "rule:missing-rule#1",
    ],
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 1);
  assert.deepEqual(result.attention[0].targets, ["context:package-boundary"]);
  assert.ok(result.warnings.includes("dangling_attention_target"));
  assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
});

test("malformed rule markers never permit partial context", async (t) => {
  const variants = [
    "<!-- acp-rule: wrong-source#1; source: another-source; subsumes: none -->",
    "<!-- acp-rule: zero-rule#0; source: zero-rule; subsumes: none -->",
    "<!-- acp-rule: leading-zero#01; source: leading-zero; subsumes: none -->",
    "<!-- acp-rule: crossed-canonical-1; source: crossed-canonical; subsumes: none -->",
    "<!-- acp-rule: id=crossed-legacy#1 source=crossed-legacy subsumes=none -->",
    "<!-- acp-rule: id=legacy-wrong-1 source=legacy-other subsumes=none -->",
    "<!-- acp-rule: missing-subsumes#1; source: missing-subsumes -->",
    "<!-- acp-rule: extra-rule#1; source: extra-rule; subsumes: none; extra: value -->",
    "<!-- acp-rule: split-rule#1; source: split-rule;\nsubsumes: none -->",
    "<!-- acp-rule: mixed-none#1; source: mixed-none; subsumes: none,other-rule#1 -->",
    "<!-- acp-rule: bare-subsumes#1; source: bare-subsumes; subsumes: other-rule -->",
    "<!-- acp-rule: legacy-subsumes#1; source: legacy-subsumes; subsumes: other-rule-1 -->",
    "<!-- acp-rule: duplicate-subsumes#1; source: duplicate-subsumes; subsumes: other-rule#1,other-rule#1 -->",
    "<!-- acp-rule: leading-zero-subsumes#1; source: leading-zero-subsumes; subsumes: other-rule#01 -->",
    "<!-- acp-rule: id=legacy-duplicate-subsumes-1 source=legacy-duplicate-subsumes subsumes=other-rule#1,other-rule-1 -->",
  ];

  for (const [index, marker] of variants.entries()) {
    await t.test(`variant ${index + 1}`, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "PACKAGE_BOUNDARY_SENTINEL",
        marker,
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "fallback");
      assert.equal(result.mode, "legacy_full");
      assert.ok(result.warnings.includes("invalid_rule_marker"));
      assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
      assert.equal(result.metrics.savedBytes, 0);
    });
  }
});

test("marker-like comment prefixes cannot bypass fail-safe validation", async (t) => {
  for (const marker of [
    "<!-- acp-rule : spaced-colon#1; source: spaced-colon; subsumes: none -->",
    "<!--acp-rule: missing-space#1; source: missing-space; subsumes: none -->",
    "<!-- ACP-RULE: uppercase#1; source: uppercase; subsumes: none -->",
  ]) {
    await t.test(marker.slice(0, 32), async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "DOCS_WORKFLOW_BODY_SENTINEL",
        marker,
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "fallback");
      assert.ok(result.warnings.includes("invalid_rule_marker"));
      assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
    });
  }
});

test("credential-shaped metadata in a marker-like comment blocks without echo", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const secretLikeToken = "ghp_abcdefghijklmnop";
  await insertRuleMarker(workspaceRoot, {
    sentinel: "DOCS_WORKFLOW_BODY_SENTINEL",
    marker:
      `<!--acp-rule : hidden#1; source: hidden; subsumes: ${secretLikeToken} -->`,
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
});

test("Unicode whitespace cannot hide credential-shaped marker metadata", async (t) => {
  const secretLikeToken = "ghp_abcdefghijklmnop";
  for (const [name, separator] of [
    ["non-breaking space", "\u00a0"],
    ["byte-order mark", "\ufeff"],
    ["form feed", "\u000c"],
    ["zero-width space", "\u200b"],
    ["left-to-right mark", "\u200e"],
    ["function application", "\u2061"],
    ["soft hyphen", "\u00ad"],
  ]) {
    await t.test(name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "PACKAGE_BOUNDARY_SENTINEL",
        marker:
          `<!--${separator}acp-rule: hidden#1; source: hidden; subsumes: ${secretLikeToken} -->`,
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "unsafe_context_metadata");
      assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
    });
  }
});

test("default-ignorable characters inside the marker label cannot bypass safety", async (t) => {
  const secretLikeToken = "ghp_abcdefghijklmnop";
  for (const [name, label] of [
    ["inside acp", "acp\u200b-rule"],
    ["after hyphen", "acp-\u200brule"],
    ["after label", "acp-rule\u200b"],
    ["null before label", "\u0000acp-rule"],
    ["bell before label", "\u0007acp-rule"],
  ]) {
    await t.test(name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "PACKAGE_BOUNDARY_SENTINEL",
        marker:
          `<!-- ${label}: hidden#1; source: hidden; subsumes: ${secretLikeToken} -->`,
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "unsafe_context_metadata");
      assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
    });
  }
});

test("default-ignorable characters cannot disguise a credential-shaped marker value", async (t) => {
  const disguisedSecret = "ghp_\u200babcdefghijklmnop";
  const workspaceRoot = await makeWorkspace(t);
  await insertRuleMarker(workspaceRoot, {
    sentinel: "PACKAGE_BOUNDARY_SENTINEL",
    marker:
      `<!-- acp-rule: hidden#1; source: hidden; subsumes: ${disguisedSecret} -->`,
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unsafe_context_metadata");
  assert.equal(JSON.stringify(result).includes(disguisedSecret), false);
});

test("credential-shaped metadata after a multiline comment opening blocks", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const secretLikeToken = "ghp_abcdefghijklmnop";
  await insertRuleMarker(workspaceRoot, {
    sentinel: "PACKAGE_BOUNDARY_SENTINEL",
    marker: [
      "<!--",
      "acp-rule: split-opening#1; source: split-opening;",
      `${secretLikeToken} -->`,
    ].join("\n"),
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
});

test("an ordinary unclosed comment cannot hide nested rule metadata", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const secretLikeToken = "ghp_abcdefghijklmnop";
  const profilePath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );
  const source = await readFile(profilePath, "utf8");
  await writeFile(
    profilePath,
    [
      source.trimEnd(),
      "<!-- harmless outer opener",
      `<!-- acp-rule: nested-secret#1; source: nested-secret; subsumes: ${secretLikeToken} -->`,
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
});

test("unclosed and oversized rule markers fail safe", async (t) => {
  for (const variant of [
    {
      name: "unclosed",
      marker:
        "<!-- acp-rule: unclosed-rule#1; source: unclosed-rule; subsumes: none",
      warning: "unclosed_rule_marker",
      status: "fallback",
      mode: "legacy_full",
    },
    {
      name: "oversized",
      marker: `<!-- acp-rule: ${"x".repeat(4_200)} -->`,
      warning: "rule_marker_too_large",
      status: "blocked",
      mode: "none",
    },
  ]) {
    await t.test(variant.name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      if (variant.name === "unclosed") {
        const profilePath = join(
          workspaceRoot,
          ".agent-context",
          "PROJECT_PROFILE.md",
        );
        const source = await readFile(profilePath, "utf8");
        await writeFile(profilePath, `${source.trimEnd()}\n${variant.marker}`, "utf8");
      } else {
        await insertRuleMarker(workspaceRoot, {
          sentinel: "PACKAGE_BOUNDARY_SENTINEL",
          marker: variant.marker,
        });
      }

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, variant.status);
      assert.equal(result.mode, variant.mode);
      assert.ok(result.warnings.includes(variant.warning));
      assert.equal(result.warnings.includes("unsafe_context_metadata"), false);
      if (variant.status === "fallback") {
        assert.equal(result.metrics.savedBytes, 0);
      } else {
        assert.equal(result.content, "");
      }
    });
  }
});

test("canonical and legacy spellings of one logical rule are duplicates", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await insertRuleMarker(workspaceRoot, {
    sentinel: "PACKAGE_BOUNDARY_SENTINEL",
    marker:
      "<!-- acp-rule: duplicate-rule#1; source: duplicate-rule; subsumes: none -->",
  });
  await insertRuleMarker(workspaceRoot, {
    sentinel: "DOCS_WORKFLOW_BODY_SENTINEL",
    marker:
      "<!-- acp-rule: id=duplicate-rule-1 source=duplicate-rule subsumes=none -->",
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "fallback");
  assert.ok(result.warnings.includes("duplicate_rule_identity"));
  assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
});

test("credential-shaped rule metadata blocks without echoing its bytes", async (t) => {
  const secretLikeToken = "ghp_abcdefghijklmnop";
  for (const [name, marker] of [
    [
      "id",
      `<!-- acp-rule: ${secretLikeToken}#1; source: safe-source; subsumes: none -->`,
    ],
    [
      "source",
      `<!-- acp-rule: safe-source#1; source: ${secretLikeToken}; subsumes: none -->`,
    ],
    [
      "subsumes",
      `<!-- acp-rule: safe-source#1; source: safe-source; subsumes: ${secretLikeToken} -->`,
    ],
  ]) {
    await t.test(name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "PACKAGE_BOUNDARY_SENTINEL",
        marker,
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "blocked");
      assert.equal(result.mode, "none");
      assert.equal(result.reason, "unsafe_context_metadata");
      assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
    });
  }
});

test("credential-shaped multiline rule metadata blocks after fenced and indented prose", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const secretLikeToken = "ghp_abcdefghijklmnop";
  await insertRuleMarker(workspaceRoot, {
    sentinel: "PACKAGE_BOUNDARY_SENTINEL",
    marker: [
      "```md",
      "<!-- acp-rule: fenced example -->",
      "```",
      "    <!-- acp-rule: indented example -->",
      "<!-- acp-rule: split-secret#1; source: split-secret;",
      `${secretLikeToken} -->`,
    ].join("\n"),
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(result.reason, "unsafe_context_metadata");
  assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
});

test("Markdown presentation cannot exempt marker-like metadata from safety checks", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const secretLikeToken = "ghp_abcdefghijklmnop";
  const profilePath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );
  const source = await readFile(profilePath, "utf8");
  await writeFile(
    profilePath,
    [
      source.trimEnd(),
      "- list item",
      "",
      "  ```md",
      "  harmless example",
      `<!-- acp-rule: escaped#1; source: escaped; subsumes: ${secretLikeToken} -->`,
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(result.reason, "unsafe_context_metadata");
  assert.equal(JSON.stringify(result).includes(secretLikeToken), false);
});

test("ordinary nested HTML comment openers do not cause quadratic rule scanning", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const profilePath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );
  const source = await readFile(profilePath, "utf8");
  await writeFile(
    profilePath,
    `${source.trimEnd()}\n${"<!--".repeat(20_000)}-->\n`,
    "utf8",
  );

  const startedAt = performance.now();
  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(result.status, "compiled");
  assert.ok(
    elapsedMilliseconds < 3_000,
    `expected bounded candidate prefiltering, took ${elapsedMilliseconds}ms`,
  );
});

test("the rule marker candidate catalog has a hard inspection bound", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const profilePath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );
  const source = await readFile(profilePath, "utf8");
  const markers = Array.from(
    { length: 513 },
    (_, index) =>
      `<!-- acp-rule: bounded-rule-${index}#1; source: bounded-rule-${index}; subsumes: none -->`,
  ).join("\n");
  await writeFile(profilePath, `${source.trimEnd()}\n${markers}\n`, "utf8");

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(result.reason, "rule_marker_inspection_incomplete");
  assert.equal(result.content, "");
});

test("the rule marker candidate bound is shared across every compiled document", async (t) => {
  await t.test("511 plus 1 remains within the compilation-wide bound", async (t) => {
    const workspaceRoot = await makeWorkspace(t);
    await appendRuleMarkers(
      workspaceRoot,
      ".agent-context/PROJECT_PROFILE.md",
      "profile-bound",
      511,
    );
    await appendRuleMarkers(
      workspaceRoot,
      ".agent-context/checklists/coding.md",
      "coding-bound",
      1,
    );

    const result = await compile(workspaceRoot, taskSignature({
      operations: ["package_metadata_change"],
      paths: ["package.json"],
      domains: ["coding"],
    }));

    assert.equal(result.status, "compiled");
    assert.equal(result.mode, "progressive");
    assert.equal(
      result.warnings.includes("rule_marker_inspection_incomplete"),
      false,
    );
  });

  await t.test("512 plus 1 blocks across profile and checklist", async (t) => {
    const workspaceRoot = await makeWorkspace(t);
    await appendRuleMarkers(
      workspaceRoot,
      ".agent-context/PROJECT_PROFILE.md",
      "profile-overflow",
      512,
    );
    await appendRuleMarkers(
      workspaceRoot,
      ".agent-context/checklists/coding.md",
      "coding-overflow",
      1,
    );

    const result = await compile(workspaceRoot, taskSignature({
      operations: ["package_metadata_change"],
      paths: ["package.json"],
      domains: ["coding"],
    }));

    assert.equal(result.status, "blocked");
    assert.equal(result.mode, "none");
    assert.equal(result.reason, "rule_marker_inspection_incomplete");
    assert.equal(result.content, "");
  });

  await t.test("the same bound includes enabled non-task checklists", async (t) => {
    const workspaceRoot = await makeWorkspace(t);
    await enableResearchDomain(workspaceRoot);
    await appendRuleMarkers(
      workspaceRoot,
      ".agent-context/PROJECT_PROFILE.md",
      "profile-multi",
      256,
    );
    await appendRuleMarkers(
      workspaceRoot,
      ".agent-context/checklists/coding.md",
      "coding-multi",
      128,
    );
    await appendRuleMarkers(
      workspaceRoot,
      ".agent-context/checklists/research.md",
      "research-multi",
      129,
    );

    const result = await compile(workspaceRoot, taskSignature({
      operations: ["package_metadata_change"],
      paths: ["package.json"],
      domains: ["coding"],
    }));

    assert.equal(result.status, "blocked");
    assert.equal(result.mode, "none");
    assert.equal(result.reason, "rule_marker_inspection_incomplete");
    assert.equal(result.content, "");
  });
});

test("an invalid backtick fence opener cannot hide following rule metadata", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const profilePath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );
  const source = await readFile(profilePath, "utf8");
  await writeFile(
    profilePath,
    `${source.trimEnd()}\n\`\`\`md\`invalid\n<!-- acp-rule: malformed-after-opener -->\n`,
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "fallback");
  assert.ok(result.warnings.includes("invalid_rule_marker"));
});

test("an exact marker remains lexical metadata inside fenced prose", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const profilePath = join(
    workspaceRoot,
    ".agent-context",
    "PROJECT_PROFILE.md",
  );
  const source = await readFile(profilePath, "utf8");
  await writeFile(
    profilePath,
    [
      source.trimEnd(),
      "```md",
      "<!-- acp-rule: fenced-only#1; source: fenced-only; subsumes: none -->",
      "```",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeProposal(workspaceRoot, {
    id: "fenced-only-rule-attention",
    attentionTargets: ["rule:fenced-only#1"],
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 1);
  assert.deepEqual(result.attention[0].targets, ["rule:fenced-only#1"]);
  assert.equal(result.warnings.includes("dangling_attention_target"), false);
});

test("indentation does not exempt an exact marker from lexical compatibility", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await insertRuleMarker(workspaceRoot, {
    sentinel: "PACKAGE_BOUNDARY_SENTINEL",
    marker:
      "   \t<!-- acp-rule: tab-indented#1; source: tab-indented; subsumes: none -->",
  });
  await writeProposal(workspaceRoot, {
    id: "tab-indented-rule-attention",
    attentionTargets: ["rule:tab-indented#1"],
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 1);
  assert.deepEqual(result.attention[0].targets, ["rule:tab-indented#1"]);
  assert.equal(result.warnings.includes("dangling_attention_target"), false);
});

test("duplicate aliases in one attention edge never create an ambiguous pointer", async (t) => {
  for (const risk of ["normal", "high"]) {
    await t.test(risk, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await insertRuleMarker(workspaceRoot, {
        sentinel: "PACKAGE_BOUNDARY_SENTINEL",
        marker:
          "<!-- acp-rule: alias-duplicate#1; source: alias-duplicate; subsumes: none -->",
      });
      await writeProposal(workspaceRoot, {
        id: `duplicate-alias-${risk}`,
        attentionTargets: [
          "rule:alias-duplicate#1",
          "rule:alias-duplicate-1",
        ],
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
        risk,
      }));

      assert.deepEqual(result.attention, []);
      assert.ok(result.warnings.includes("duplicate_attention_target_identity"));
      if (risk === "high") {
        assert.equal(result.status, "fallback");
        assert.equal(result.reason, "high_risk_attention_scan_incomplete");
      } else {
        assert.equal(result.status, "compiled");
        assert.equal(result.mode, "progressive");
      }
    });
  }
});

test("duplicate nonterminal proposal IDs never create an ambiguous pointer", async (t) => {
  for (const risk of ["normal", "high"]) {
    await t.test(risk, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      const id = `duplicate-proposal-${risk}`;
      await writeProposal(workspaceRoot, {
        id,
        attentionTargets: ["context:package-boundary"],
      });
      const duplicate = proposalSource({
        id,
        status: "proposed",
        attentionTargets: ["context:package-boundary"],
        bodySentinel: BODY_SENTINEL,
        createdSecond: 1,
      });
      assert.deepEqual(validateProposalDocument(duplicate, "duplicate-copy.md"), []);
      await writeFile(
        join(workspaceRoot, ".agent-context", "proposals", `copy-${id}.md`),
        duplicate,
        "utf8",
      );

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
        risk,
      }));

      assert.deepEqual(result.attention, []);
      assert.ok(result.warnings.includes("duplicate_attention_proposal_id"));
      assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
      if (risk === "high") {
        assert.equal(result.status, "fallback");
        assert.equal(result.reason, "high_risk_attention_scan_incomplete");
      } else {
        assert.equal(result.status, "compiled");
        assert.equal(result.mode, "progressive");
      }
    });
  }
});

test("a locally duplicated proposal ID does not hide an independent normal-risk pointer", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const duplicatedId = "locally-duplicated-proposal";
  await writeProposal(workspaceRoot, {
    id: duplicatedId,
    attentionTargets: ["context:package-boundary"],
  });
  const duplicate = proposalSource({
    id: duplicatedId,
    status: "proposed",
    attentionTargets: ["context:package-boundary"],
    bodySentinel: BODY_SENTINEL,
    createdSecond: 1,
  });
  await writeFile(
    join(workspaceRoot, ".agent-context", "proposals", "copy-local-duplicate.md"),
    duplicate,
    "utf8",
  );
  await writeProposal(workspaceRoot, {
    id: "independent-proposal",
    attentionTargets: ["context:package-boundary"],
    createdSecond: 2,
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(
    result.attention.map(({ proposalId }) => proposalId),
    ["independent-proposal"],
  );
  assert.ok(result.warnings.includes("duplicate_attention_proposal_id"));
});

test("a locally duplicated rule alias does not hide an independent normal-risk pointer", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await insertRuleMarker(workspaceRoot, {
    sentinel: "PACKAGE_BOUNDARY_SENTINEL",
    marker:
      "<!-- acp-rule: local-alias#1; source: local-alias; subsumes: none -->",
  });
  await writeProposal(workspaceRoot, {
    id: "local-alias-duplicate",
    attentionTargets: ["rule:local-alias#1", "rule:local-alias-1"],
  });
  await writeProposal(workspaceRoot, {
    id: "independent-alias-proposal",
    attentionTargets: ["context:package-boundary"],
    createdSecond: 1,
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(
    result.attention.map(({ proposalId }) => proposalId),
    ["independent-alias-proposal"],
  );
  assert.ok(result.warnings.includes("duplicate_attention_target_identity"));
});

test("a terminal proposal cannot hide a duplicate nonterminal proposal ID", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const id = "terminal-duplicate-proposal";
  await writeProposal(workspaceRoot, {
    id,
    attentionTargets: ["context:package-boundary"],
  });
  await writeFile(
    join(workspaceRoot, ".agent-context", "proposals", `applied-${id}.md`),
    [
      "---",
      "schema_version: 1",
      `id: ${id}`,
      "status: applied",
      "scope: workspace",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["delete_cache"],
    paths: ["tmp/cache.bin"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "high_risk_attention_scan_incomplete");
  assert.deepEqual(result.attention, []);
  assert.ok(result.warnings.includes("duplicate_attention_proposal_id"));
});

test("a numeric terminal ID is invalid and cannot alias a quoted string proposal ID", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const stringIdProposal = proposalSource({
    id: "123",
    status: "proposed",
    attentionTargets: ["context:destructive-safety"],
    bodySentinel: BODY_SENTINEL,
    createdSecond: 0,
  }).replace("\nid: 123\n", '\nid: "123"\n');
  assert.deepEqual(
    validateProposalDocument(stringIdProposal, "string-123.md"),
    [],
  );
  const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
  await writeFile(
    join(proposalsRoot, "string-123.md"),
    stringIdProposal,
    "utf8",
  );
  await writeFile(
    join(proposalsRoot, "terminal-numeric-123.md"),
    [
      "---",
      "schema_version: 1",
      "id: 123",
      "status: applied",
      "scope: workspace",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["delete_cache"],
    paths: ["tmp/cache.bin"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "high_risk_attention_scan_incomplete");
  assert.deepEqual(result.attention, []);
  assert.ok(result.warnings.includes("invalid_attention_proposal_id"));
  assert.ok(result.warnings.includes("duplicate_attention_proposal_id"));
});

test("an unsafe integer proposal ID suppresses ambiguous attention at every risk and file order", async (t) => {
  const unsafeIntegerId = "9007199254740993";
  for (const risk of ["normal", "high"]) {
    for (const stringFirst of [true, false]) {
      await t.test(`${risk}-${stringFirst ? "string-first" : "number-first"}`, async (t) => {
        const workspaceRoot = await makeWorkspace(t);
        const stringIdProposal = proposalSource({
          id: unsafeIntegerId,
          status: "proposed",
          attentionTargets: ["context:package-boundary"],
          bodySentinel: BODY_SENTINEL,
          createdSecond: 0,
        }).replace(
          `\nid: ${unsafeIntegerId}\n`,
          `\nid: "${unsafeIntegerId}"\n`,
        );
        assert.deepEqual(
          validateProposalDocument(stringIdProposal, "unsafe-integer-string.md"),
          [],
        );
        const numericTerminal = [
          "---",
          "schema_version: 1",
          `id: ${unsafeIntegerId}`,
          "status: applied",
          "scope: workspace",
          "---",
          "",
        ].join("\n");
        const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
        await writeFile(
          join(proposalsRoot, stringFirst ? "000-string.md" : "zzz-string.md"),
          stringIdProposal,
          "utf8",
        );
        await writeFile(
          join(proposalsRoot, stringFirst ? "zzz-number.md" : "000-number.md"),
          numericTerminal,
          "utf8",
        );

        const result = await compile(workspaceRoot, taskSignature({
          operations: ["package_metadata_change"],
          paths: ["package.json"],
          domains: ["coding"],
          risk,
        }));

        assert.deepEqual(result.attention, []);
        assert.ok(result.warnings.includes("invalid_attention_proposal_id"));
        assert.equal(
          result.warnings.includes("duplicate_attention_proposal_id"),
          false,
          "a rounded Number value must not invent an exact duplicate identity",
        );
        if (risk === "high") {
          assert.equal(result.status, "fallback");
          assert.equal(result.reason, "high_risk_attention_scan_incomplete");
        } else {
          assert.equal(result.status, "compiled");
          assert.equal(result.mode, "progressive");
        }
      });
    }
  }
});

test("only exactly representable invalid numeric IDs report string-ID duplicates", async (t) => {
  for (const variant of [
    {
      name: "maximum safe integer",
      numericId: "9007199254740991",
      stringId: "9007199254740991",
      duplicate: true,
    },
    {
      name: "negative zero",
      numericId: "-0",
      stringId: "0",
      duplicate: false,
    },
    {
      name: "rounded unsafe integer",
      numericId: "9007199254740993",
      stringId: "9007199254740992",
      duplicate: false,
    },
    {
      name: "overflow",
      numericId: "9".repeat(400),
      stringId: "Infinity",
      duplicate: false,
    },
  ]) {
    await t.test(variant.name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      const stringIdProposal = proposalSource({
        id: variant.stringId,
        status: "proposed",
        attentionTargets: ["context:package-boundary"],
        bodySentinel: BODY_SENTINEL,
        createdSecond: 0,
      }).replace(
        `\nid: ${variant.stringId}\n`,
        `\nid: "${variant.stringId}"\n`,
      );
      assert.deepEqual(
        validateProposalDocument(stringIdProposal, `${variant.name}.md`),
        [],
      );
      const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
      await writeFile(join(proposalsRoot, "000-string.md"), stringIdProposal, "utf8");
      await writeFile(
        join(proposalsRoot, "zzz-number.md"),
        [
          "---",
          "schema_version: 1",
          `id: ${variant.numericId}`,
          "status: applied",
          "scope: workspace",
          "---",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.deepEqual(result.attention, []);
      assert.equal(
        result.warnings.includes("duplicate_attention_proposal_id"),
        variant.duplicate,
      );
    });
  }
});

test("an incomplete normal-risk proposal scan suppresses every attention pointer", async (t) => {
  for (const outsideDuplicate of [false, true]) {
    await t.test(outsideDuplicate ? "duplicate outside bound" : "unique outside bound", async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
      const visibleId = "visible-with-incomplete-catalog";
      const visibleProposal = proposalSource({
        id: visibleId,
        status: "proposed",
        attentionTargets: ["context:package-boundary"],
        bodySentinel: BODY_SENTINEL,
        createdSecond: 0,
      });
      assert.deepEqual(validateProposalDocument(visibleProposal, "visible.md"), []);
      await writeFile(join(proposalsRoot, "000-visible.md"), visibleProposal, "utf8");
      for (let index = 0; index < 511; index += 1) {
        const id = `terminal-bound-${String(index).padStart(3, "0")}`;
        await writeFile(
          join(proposalsRoot, `100-${id}.md`),
          [
            "---",
            "schema_version: 1",
            `id: ${id}`,
            "status: applied",
            "scope: workspace",
            "---",
            "",
          ].join("\n"),
          "utf8",
        );
      }
      const outsideId = outsideDuplicate ? visibleId : "outside-bound-unique";
      await writeFile(
        join(proposalsRoot, "zzz-outside-bound.md"),
        [
          "---",
          "schema_version: 1",
          `id: ${outsideId}`,
          "status: applied",
          "scope: workspace",
          "---",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "compiled");
      assert.equal(result.mode, "progressive");
      assert.deepEqual(result.attention, []);
      assert.ok(result.warnings.includes("proposal_scan_limit_reached"));
    });
  }
});

test("a missing enabled checklist blocks the global catalog scan even when another domain is task-relevant", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const configPath = join(workspaceRoot, ".agent-context", "config.yml");
  const config = await readFile(configPath, "utf8");
  await writeFile(
    configPath,
    config.replace("enabled_domains: [coding]", "enabled_domains: [coding, research]"),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "enabled_checklist_missing");
  assert.equal(result.content, "");
});

test("byte metrics expose routing overhead when every pack is selected", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const result = await compile(workspaceRoot, taskSignature({
    operations: [
      "database_migration",
      "documentation_change",
      "package_metadata_change",
      "publish_release",
    ],
    paths: ["README.md", "db/migration.sql", "package.json"],
    tools: ["gh"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.selectedPackIds, [
    "destructive-safety",
    "docs-workflow",
    "package-boundary",
    "release-workflow",
  ]);
  assert.ok(result.metrics.savedBytes < 0);
  assert.ok(result.metrics.reductionBasisPoints < 0);
  assert.equal(
    result.metrics.reductionBasisPoints,
    Math.trunc(
      (result.metrics.savedBytes * 10_000) / result.metrics.fullContextBytes,
    ),
  );
});

test("a safety pack in an unrelated domain does not satisfy task-relevant high-risk coverage", async (t) => {
  const workspaceRoot = await makeWorkspace(t, { includeSafety: false });
  await enableResearchDomain(workspaceRoot, { priority: "safety" });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["delete_cache"],
    paths: ["tmp/cache.bin"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "fallback");
  assert.ok(result.warnings.includes("high_risk_safety_pack_missing"));
  assert.doesNotMatch(result.content, /RESEARCH_ONLY_BODY_SENTINEL/u);
});

test("negative prose routing does not disclose the package rule or its proposal attention", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await writeProposal(workspaceRoot, {
    id: "package-correction",
    attentionTargets: ["context:package-boundary"],
    bodySentinel: BODY_SENTINEL,
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["documentation_change"],
    paths: ["README.md"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.mode, "progressive");
  assert.deepEqual(result.selectedPackIds, ["docs-workflow"]);
  assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
  assert.doesNotMatch(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.doesNotMatch(result.content, /package-correction/u);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(BODY_SENTINEL, "u"));
  assert.deepEqual(result.attention, []);
});

test("high-risk routing widens to every task-relevant safety pack and falls back when none exists", async (t) => {
  await t.test("a safety pack is included even when its ordinary selectors do not match", async (t) => {
    const workspaceRoot = await makeWorkspace(t);
    const result = await compile(workspaceRoot, taskSignature({
      operations: ["delete_cache"],
      paths: ["tmp/cache.bin"],
      domains: ["coding"],
      risk: "high",
    }));

    assert.equal(result.status, "compiled");
    assert.equal(result.mode, "progressive");
    assert.deepEqual(result.selectedPackIds, ["destructive-safety"]);
    assert.match(result.content, /CORE_AUTHORITY_SENTINEL/u);
    assert.match(result.content, /DESTRUCTIVE_SAFETY_BODY_SENTINEL/u);
    assert.doesNotMatch(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  });

  await t.test("missing safety coverage returns the complete legacy default read set", async (t) => {
    const workspaceRoot = await makeWorkspace(t, { includeSafety: false });
    const result = await compile(workspaceRoot, taskSignature({
      operations: ["delete_cache"],
      paths: ["tmp/cache.bin"],
      domains: ["coding"],
      risk: "high",
    }));

    assert.equal(result.status, "fallback");
    assert.equal(result.mode, "legacy_full");
    assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
    assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
    assert.match(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
    assert.equal(result.metrics.modelVisibleBytes, result.metrics.fullContextBytes);
    assert.equal(result.metrics.savedBytes, 0);
    assert.equal(result.metrics.reductionBasisPoints, 0);
  });

  await t.test("an empty safety pack is not usable safety coverage", async (t) => {
    const workspaceRoot = await makeWorkspace(t);
    const checklistPath = join(
      workspaceRoot,
      ".agent-context",
      "checklists",
      "coding.md",
    );
    const source = await readFile(checklistPath, "utf8");
    const safetyId = source.indexOf('"id":"destructive-safety"');
    const bodyStart = source.indexOf("-->", safetyId) + 3;
    const bodyEnd = source.indexOf("<!-- /acp-context -->", bodyStart);
    assert.ok(safetyId > 0 && bodyStart > 2 && bodyEnd > bodyStart);
    await writeFile(
      checklistPath,
      `${source.slice(0, bodyStart)}\n   \n${source.slice(bodyEnd)}`,
      "utf8",
    );

    const result = await compile(workspaceRoot, taskSignature({
      operations: ["delete_cache"],
      paths: ["tmp/cache.bin"],
      domains: ["coding"],
      risk: "high",
    }));

    assert.equal(result.status, "fallback");
    assert.equal(result.mode, "legacy_full");
    assert.ok(result.warnings.includes("empty_context_block"));
    assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
    assert.equal(result.metrics.fullContextBytes, result.metrics.modelVisibleBytes);
  });
});

test("an explicit requested pack is selected without broadening to unrelated packs", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const result = await compile(workspaceRoot, taskSignature({
    operations: ["code_change"],
    paths: ["src/index.mjs"],
    domains: ["coding"],
    requestedPacks: ["release-workflow"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.mode, "progressive");
  assert.deepEqual(result.selectedPackIds, ["release-workflow"]);
  assert.match(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
  assert.doesNotMatch(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.doesNotMatch(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
});

test("legacy Schema 1 context without markers remains a complete conservative fallback", async (t) => {
  const workspaceRoot = await makeWorkspace(t, { markers: false });
  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.mode, "legacy_full");
  assert.equal(result.reason, "routing_metadata_absent");
  assert.deepEqual(result.selectedPackIds, []);
  assert.match(result.content, /LEGACY_UNMARKED_MUST_SURVIVE/u);
  assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
  assert.match(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
  assert.match(result.content, /DESTRUCTIVE_SAFETY_BODY_SENTINEL/u);
  assertMetrics(result);
  assert.equal(result.metrics.fullContextBytes, result.metrics.modelVisibleBytes);
});

test("one invalid marker rejects partial disclosure and falls back to the full default read set", async (t) => {
  const workspaceRoot = await makeWorkspace(t, { invalidMarker: true });
  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.mode, "legacy_full");
  assert.notEqual(result.reason, "routing_metadata_absent");
  assert.match(result.content, /CORE_AUTHORITY_SENTINEL/u);
  assert.match(result.content, /LEGACY_UNMARKED_MUST_SURVIVE/u);
  assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
  assert.match(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
  assert.match(result.content, /DESTRUCTIVE_SAFETY_BODY_SENTINEL/u);
  assert.equal(result.metrics.fullContextBytes, result.metrics.modelVisibleBytes);
  assert.ok(result.warnings.length > 0);
});

test("ambiguous marker structures never produce partial disclosure", async (t) => {
  const variants = [
    {
      name: "unclosed block",
      warning: "unclosed_context_block",
      mutate: (source) => source.replaceAll("\n<!-- /acp-context -->", ""),
    },
    {
      name: "duplicate context id",
      warning: "duplicate_context_id",
      mutate: (source) =>
        source.replace('"id":"docs-workflow"', '"id":"package-boundary"'),
    },
    {
      name: "unknown context kind",
      warning: "unknown_context_kind",
      mutate: (source) => source.replace('"kind":"pack"', '"kind":"unknown"'),
    },
    {
      name: "non-string context id",
      warning: "invalid_pack_context_metadata",
      mutate: (source) => source.replace('"id":"package-boundary"', '"id":123'),
    },
    {
      name: "nested context block",
      warning: "nested_context_block",
      mutate: (source) =>
        source.replace(
          "- PACKAGE_BOUNDARY_SENTINEL:",
          [
            '<!-- acp-context: {"schemaVersion":1,"id":"nested-pack","kind":"core","description":"Nested fixture."} -->',
            "- NESTED_CONTEXT_SENTINEL:",
            "<!-- /acp-context -->",
            "- PACKAGE_BOUNDARY_SENTINEL:",
          ].join("\n"),
        ),
    },
    {
      name: "orphan close marker",
      warning: "orphan_context_close_marker",
      mutate: (source) => `<!-- /acp-context -->\n${source}`,
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      const checklistPath = join(
        workspaceRoot,
        ".agent-context",
        "checklists",
        "coding.md",
      );
      const source = await readFile(checklistPath, "utf8");
      await writeFile(checklistPath, variant.mutate(source), "utf8");

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "fallback");
      assert.equal(result.mode, "legacy_full");
      assert.equal(result.reason, "invalid_routing_metadata");
      assert.ok(result.warnings.includes(variant.warning));
      assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
      assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
      assert.match(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
      assert.equal(result.metrics.fullContextBytes, result.metrics.modelVisibleBytes);
    });
  }
});

test("unknown requested packs fall back to the complete legacy read set", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const result = await compile(workspaceRoot, taskSignature({
    operations: ["code_change"],
    paths: ["src/index.mjs"],
    domains: ["coding"],
    requestedPacks: ["not-in-the-derived-catalog"],
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.mode, "legacy_full");
  assert.equal(result.reason, "invalid_routing_metadata");
  assert.ok(result.warnings.includes("unknown_requested_pack"));
  assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
  assert.match(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
  assert.equal(result.metrics.savedBytes, 0);
});

test("invalid task signatures block before active context is rendered or echoed", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const privateSentinel = "PRIVATE_TASK_PATH_MUST_NOT_BE_ECHOED";
  const result = await compile(workspaceRoot, taskSignature({
    paths: [`../${privateSentinel}`],
    domains: ["coding"],
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(result.reason, "invalid_task_signature");
  assert.equal(result.content, "");
  assert.equal(JSON.stringify(result).includes(privateSentinel), false);
  assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
});

test("credential-shaped context metadata blocks without entering the catalog or fallback", async (t) => {
  for (const variant of [
    {
      path: ".agent-context/PROJECT_PROFILE.md",
      from: '"id":"workspace-safety"',
      id: "ghp_abcdefghijklmnop",
    },
    {
      path: ".agent-context/checklists/coding.md",
      from: '"id":"docs-workflow"',
      id: "sk-proj-abcdefghijklmnop1234",
    },
    {
      path: ".agent-context/checklists/coding.md",
      from: '"id":"docs-workflow"',
      id: "ghp_abcdefghijklmnop",
      encodedId: "ghp_\\u0061bcdefghijklmnop",
    },
  ]) {
    await t.test(variant.encodedId ?? variant.id, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      const path = join(workspaceRoot, variant.path);
      const source = await readFile(path, "utf8");
      await writeFile(
        path,
        source.replace(
          variant.from,
          `"id":"${variant.encodedId ?? variant.id}"`,
        ),
        "utf8",
      );

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.status, "blocked");
      assert.equal(result.mode, "none");
      assert.equal(result.reason, "unsafe_context_metadata");
      assert.equal(result.content, "");
      assert.equal(JSON.stringify(result).includes(variant.id), false);
      if (variant.encodedId) {
        assert.equal(JSON.stringify(result).includes(variant.encodedId), false);
      }
    });
  }
});

test("CLI emits the same bounded JSON contract and exits 2 on blocked input", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const taskPath = join(workspaceRoot, "task-signature.json");
  await writeFile(taskPath, JSON.stringify(taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  })), "utf8");

  const compiled = await execFileAsync(process.execPath, [
    compilerCli,
    "--workspace",
    workspaceRoot,
    "--task",
    taskPath,
  ]);
  assert.equal(compiled.stderr, "");
  const parsed = JSON.parse(compiled.stdout);
  assert.equal(parsed.status, "compiled");
  assert.equal(JSON.stringify(parsed).includes(workspaceRoot), false);

  await writeFile(taskPath, "{}", "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      compilerCli,
      "--workspace",
      workspaceRoot,
      "--task",
      taskPath,
    ]),
    (error) => {
      assert.equal(error.code, 2);
      assert.equal(error.stderr, "");
      const blocked = JSON.parse(error.stdout);
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.reason, "invalid_task_signature");
      return true;
    },
  );
});

test("compilation is byte-deterministic across file creation and proposal enumeration order", async (t) => {
  const firstRoot = await makeWorkspace(t, { writeOrder: "forward" });
  const secondRoot = await makeWorkspace(t, { writeOrder: "reverse" });
  for (const [index, id] of ["attention-a", "attention-b"].entries()) {
    await writeProposal(firstRoot, {
      id,
      attentionTargets: ["context:package-boundary"],
      createdSecond: index,
    });
  }
  for (const [index, id] of ["attention-b", "attention-a"].entries()) {
    await writeProposal(secondRoot, {
      id,
      attentionTargets: ["context:package-boundary"],
      createdSecond: 1 - index,
    });
  }
  const task = taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  });

  const first = await compile(firstRoot, task);
  const repeated = await compile(firstRoot, task);
  const reordered = await compile(secondRoot, task);

  assert.deepEqual(repeated, first);
  assert.deepEqual(reordered, first);
  assert.equal(JSON.stringify(first).includes(firstRoot), false);
  assert.equal(JSON.stringify(reordered).includes(secondRoot), false);
});

test("proposal ordering is byte-deterministic across process locales", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  for (const [index, id] of [
    "attention-H",
    "attention-I",
    "attention-i",
    "attention-J",
  ].entries()) {
    const proposal = proposalSource({
      id,
      status: "proposed",
      attentionTargets: ["context:package-boundary"],
      bodySentinel: "SANITIZED_PROPOSAL_BODY",
      createdSecond: index,
    });
    assert.deepEqual(validateProposalDocument(proposal, `${id}.md`), []);
    await writeFile(
      join(
        workspaceRoot,
        ".agent-context",
        "proposals",
        `locale-attention-${index}.md`,
      ),
      proposal,
      "utf8",
    );
  }
  const taskPath = join(workspaceRoot, "locale-task-signature.json");
  await writeFile(taskPath, JSON.stringify(taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  })), "utf8");

  const outputs = await Promise.all(
    ["en_US.UTF-8", "tr_TR.UTF-8"].map(async (locale) => {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          compilerCli,
          "--workspace",
          workspaceRoot,
          "--task",
          taskPath,
        ],
        {
          env: { ...process.env, LANG: locale, LC_ALL: locale },
        },
      );
      assert.equal(stderr, "");
      return JSON.parse(stdout);
    }),
  );

  assert.deepEqual(outputs[1], outputs[0]);
  assert.deepEqual(
    outputs[0].attention.map(({ proposalId }) => proposalId),
    ["attention-H", "attention-I", "attention-J"],
  );
});

test("enabled-domain config order does not change compilation or trigger false instability", async (t) => {
  const firstRoot = await makeWorkspace(t);
  const secondRoot = await makeWorkspace(t);
  await enableResearchDomain(firstRoot);
  await enableResearchDomain(secondRoot);
  const secondConfigPath = join(secondRoot, ".agent-context", "config.yml");
  const secondConfig = await readFile(secondConfigPath, "utf8");
  await writeFile(
    secondConfigPath,
    secondConfig.replace(
      "enabled_domains: [coding, research]",
      "enabled_domains: [research, coding]",
    ),
    "utf8",
  );
  const task = taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["research", "coding"],
  });

  const first = await compile(firstRoot, task);
  const second = await compile(secondRoot, task);

  assert.equal(first.status, "compiled");
  assert.deepEqual(second, first);
});

test("context compilation is read-only over the complete workspace tree", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await writeProposal(workspaceRoot, {
    id: "read-only-attention",
    attentionTargets: ["context:package-boundary"],
  });
  const before = await snapshotTree(workspaceRoot);

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(await snapshotTree(workspaceRoot), before);
  for (const forbidden of [
    ".agent-context/.commit-kernel.lock",
    ".agent-context/.context-compiler.lock",
    ".agent-context/reports/context-compiler.json",
    ".agent-context/usage.jsonl",
  ]) {
    assert.equal(before.some(({ path }) => path === forbidden), false);
  }
});

test("unsafe active-context symlinks and invalid UTF-8 block compilation without leaking bytes", async (t) => {
  await t.test(
    "an enabled checklist symlink is not followed",
    { skip: process.platform === "win32" },
    async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      const outsidePath = join(workspaceRoot, "outside-private.md");
      const checklistPath = join(
        workspaceRoot,
        ".agent-context",
        "checklists",
        "coding.md",
      );
      await writeFile(outsidePath, `${EXTERNAL_SENTINEL}\n`, "utf8");
      await unlink(checklistPath);
      await symlink(outsidePath, checklistPath);

      const result = await compile(workspaceRoot, taskSignature({ domains: ["coding"] }));

      assert.equal(result.status, "blocked");
      assert.equal(result.mode, "none");
      assert.doesNotMatch(JSON.stringify(result), new RegExp(EXTERNAL_SENTINEL, "u"));
      assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
    },
  );

  await t.test("invalid UTF-8 in an enabled checklist is never replacement-decoded", async (t) => {
    const workspaceRoot = await makeWorkspace(t);
    const checklistPath = join(
      workspaceRoot,
      ".agent-context",
      "checklists",
      "coding.md",
    );
    await writeFile(checklistPath, Buffer.from([0xff, 0xfe, 0xfd]));

    const result = await compile(workspaceRoot, taskSignature({ domains: ["coding"] }));

    assert.equal(result.status, "blocked");
    assert.equal(result.mode, "none");
    assert.equal(result.content.includes("\ufffd"), false);
  });
});

test("a configured but missing checklist blocks instead of silently omitting its rules", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  await unlink(join(
    workspaceRoot,
    ".agent-context",
    "checklists",
    "coding.md",
  ));

  const result = await compile(workspaceRoot, taskSignature({ domains: ["coding"] }));

  assert.equal(result.status, "blocked");
  assert.equal(result.mode, "none");
  assert.equal(result.reason, "enabled_checklist_missing");
  assert.equal(result.content, "");
  assert.deepEqual(result.catalog, []);
});

test("proposal attention is bounded, deterministic, non-authoritative, and body-free", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  for (const [index, id] of [
    "attention-proposed-a",
    "attention-proposed-b",
    "attention-proposed-c",
    "attention-proposed-d",
  ].entries()) {
    await writeProposal(workspaceRoot, {
      id,
      attentionTargets: ["context:package-boundary"],
      bodySentinel: `${BODY_SENTINEL}_${id}`,
      createdSecond: index,
    });
  }
  const applied = await readFile(join(proposalFixtureRoot, "valid.md"), "utf8");
  await writeFile(
    join(workspaceRoot, ".agent-context", "proposals", "terminal-applied.md"),
    insertAttentionTargets(applied, ["context:package-boundary"]),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 3);
  for (const item of result.attention) {
    assert.deepEqual(Object.keys(item).sort(), [
      "proposalId",
      "proposalPath",
      "reason",
      "status",
      "targets",
    ]);
    assert.equal(item.status, "proposed");
    assert.equal(item.reason, "nonterminal_proposal_attention");
    assert.deepEqual(item.targets, ["context:package-boundary"]);
    assert.match(item.proposalPath, /^\.agent-context\/proposals\/[a-z0-9._-]+\.md$/u);
    assert.ok(result.content.includes(item.proposalId));
  }
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(BODY_SENTINEL), false);
  assert.equal(serialized.includes("fixture-valid-proposal"), false);
  assert.equal(serialized.includes(workspaceRoot), false);
  assert.ok(result.warnings.length > 0, "attention truncation must be visible");
  assertMetrics(result);
});

test("all supported nonterminal proposal statuses can raise compact attention", async (t) => {
  for (const status of ["pending_current_fix", "proposed", "approved"]) {
    await t.test(status, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await writeProposal(workspaceRoot, {
        id: `attention-${status.replaceAll("_", "-")}`,
        status,
        attentionTargets: ["context:package-boundary"],
        bodySentinel: BODY_SENTINEL,
      });

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["package_metadata_change"],
        paths: ["package.json"],
        domains: ["coding"],
      }));

      assert.equal(result.attention.length, 1);
      assert.equal(result.attention[0].status, status);
      assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
    });
  }
});

test("mixed-case proposal IDs remain eligible for bounded attention", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const id = "Attention-A";
  await writeProposal(workspaceRoot, {
    id,
    attentionTargets: ["context:package-boundary"],
  });

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 1);
  assert.equal(result.attention[0].proposalId, id);
});

test("proposal frontmatter scanning accepts UTF-8 BOM and CRLF without parsing the body", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const id = "portable-frontmatter";
  await writeProposal(workspaceRoot, {
    id,
    attentionTargets: ["context:package-boundary"],
    bodySentinel: BODY_SENTINEL,
  });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    `${id}.md`,
  );
  const proposal = await readFile(proposalPath, "utf8");
  await writeFile(
    proposalPath,
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(proposal.replaceAll("\n", "\r\n"), "utf8"),
    ]),
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 1);
  assert.equal(result.attention[0].proposalId, id);
  assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
});

test("proposal symlinks and invalid UTF-8 are skipped without leaking or blocking active context", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
  await writeFile(join(proposalsRoot, "invalid-utf8.md"), Buffer.from([0xff, 0xfe]));
  if (process.platform !== "win32") {
    const outsidePath = join(workspaceRoot, "outside-proposal.md");
    await writeFile(outsidePath, `${EXTERNAL_SENTINEL}\n`, "utf8");
    await symlink(outsidePath, join(proposalsRoot, "unsafe-link.md"));
  }

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.attention, []);
  assert.equal(JSON.stringify(result).includes(EXTERNAL_SENTINEL), false);
  assert.equal(result.content.includes("\ufffd"), false);
  assert.ok(result.warnings.length > 0);
});

test("proposal attention ignores unsupported frontmatter schema without reading proposal prose into output", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const id = "unsupported-attention-schema";
  await writeProposal(workspaceRoot, {
    id,
    attentionTargets: ["context:package-boundary"],
    bodySentinel: BODY_SENTINEL,
  });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    `${id}.md`,
  );
  const proposal = await readFile(proposalPath, "utf8");
  await writeFile(
    proposalPath,
    proposal.replace("schema_version: 1", "schema_version: 2"),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.attention, []);
  assert.ok(result.warnings.includes("invalid_attention_proposal_schema"));
  assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
});

test("proposal attention rejects secret-like edges without echoing their value", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const secretLikeTargets = [
    "context:sk-live-abcdefgh",
    "context:sk-proj-abcdefghijklmnop1234",
    "context:sk-ant-api03-abcdefghijklmnop1234",
    "rule:foo#ghp_abcdefgh",
  ];
  await writeFile(
    join(
      workspaceRoot,
      ".agent-context",
      "proposals",
      "unsafe-attention-target.md",
    ),
    [
      "---",
      "schema_version: 1",
      "id: unsafe-attention-target",
      "status: proposed",
      "scope: workspace",
      "attention_targets:",
      ...secretLikeTargets.map((target) => `  - ${target}`),
      "---",
      "",
      BODY_SENTINEL,
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.attention, []);
  assert.ok(result.warnings.includes("invalid_attention_targets"));
  for (const target of secretLikeTargets) {
    assert.equal(JSON.stringify(result).includes(target), false);
  }
  assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
});

test("proposal attention rejects secret-like IDs without echoing their value", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const secretLikeIds = [
    "sk-live-abcdefgh",
    "sk-proj-abcdefghijklmnop1234",
    "sk-ant-api03-abcdefghijklmnop1234",
  ];
  for (const [index, secretLikeId] of secretLikeIds.entries()) {
    await writeFile(
      join(
        workspaceRoot,
        ".agent-context",
        "proposals",
        `unsafe-attention-id-${index}.md`,
      ),
      [
        "---",
        "schema_version: 1",
        `id: ${secretLikeId}`,
        "status: proposed",
        "scope: workspace",
        "attention_targets:",
        "  - context:package-boundary",
        "---",
        "",
        BODY_SENTINEL,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.deepEqual(result.attention, []);
  assert.ok(result.warnings.includes("invalid_attention_proposal_id"));
  for (const secretLikeId of secretLikeIds) {
    assert.equal(JSON.stringify(result).includes(secretLikeId), false);
  }
  assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
});

test("proposal body encoding is irrelevant because only bounded frontmatter is parsed", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const id = "body-bytes-ignored";
  await writeProposal(workspaceRoot, {
    id,
    attentionTargets: ["context:package-boundary"],
  });
  const proposalPath = join(
    workspaceRoot,
    ".agent-context",
    "proposals",
    `${id}.md`,
  );
  const proposal = await readFile(proposalPath);
  const frontmatterEnd = proposal.indexOf(Buffer.from("\n---\n", "utf8"), 4);
  assert.ok(frontmatterEnd > 0);
  proposal[frontmatterEnd + 6] = 0xff;
  await writeFile(proposalPath, proposal);

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  }));

  assert.equal(result.status, "compiled");
  assert.equal(result.attention.length, 1);
  assert.equal(result.attention[0].proposalId, id);
  assert.equal(result.content.includes("\ufffd"), false);
});

test("high-risk compilation falls back when the bounded proposal scan is incomplete", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  const proposalsRoot = join(workspaceRoot, ".agent-context", "proposals");
  const terminalFrontmatter = (id) => [
    "---",
    "schema_version: 1",
    `id: ${id}`,
    "status: applied",
    "scope: workspace",
    "---",
    "",
  ].join("\n");
  for (let index = 0; index < 513; index += 1) {
    const id = `terminal-scan-${String(index).padStart(3, "0")}`;
    await writeFile(join(proposalsRoot, `${id}.md`), terminalFrontmatter(id), "utf8");
  }

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["delete_cache"],
    paths: ["tmp/cache.bin"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.mode, "legacy_full");
  assert.equal(result.reason, "high_risk_attention_scan_incomplete");
  assert.ok(result.warnings.includes("proposal_scan_limit_reached"));
  assert.match(result.content, /could not be inspected within the bounded attention scan/u);
  assert.equal(result.metrics.fullContextBytes, result.metrics.modelVisibleBytes);
});

test("the catalog has a hard 64-block bound and overflow falls back without truncation", async (t) => {
  const atLimitRoot = await makeWorkspace(t);
  const overflowRoot = await makeWorkspace(t);
  await appendCatalogPacks(atLimitRoot, 59);
  await appendCatalogPacks(overflowRoot, 60);
  const task = taskSignature({
    operations: ["package_metadata_change"],
    paths: ["package.json"],
    domains: ["coding"],
  });

  const atLimit = await compile(atLimitRoot, task);
  const overflow = await compile(overflowRoot, task);

  assert.equal(atLimit.status, "compiled");
  assert.equal(atLimit.mode, "progressive");
  assert.equal(atLimit.catalog.length, 64);
  assert.equal(overflow.status, "fallback");
  assert.equal(overflow.mode, "legacy_full");
  assert.deepEqual(overflow.catalog, []);
  assert.deepEqual(overflow.selectedPackIds, []);
  assert.ok(overflow.warnings.includes("context_catalog_limit_exceeded"));
  assert.match(overflow.content, /BOUNDED_CATALOG_FIXTURE_059/u);
  assert.equal(overflow.metrics.savedBytes, 0);
});

test("invalid proposal attention envelopes make high-risk inspection incomplete", async (t) => {
  for (const variant of [
    {
      name: "unknown status",
      status: "proposeed",
      scope: "workspace",
      warning: "invalid_attention_proposal_status",
    },
    {
      name: "unknown scope",
      status: "proposed",
      scope: "workspcae",
      warning: "invalid_attention_proposal_scope",
    },
    {
      name: "incomplete envelope",
      status: "proposed",
      scope: "workspace",
      warning: "invalid_attention_proposal_frontmatter",
    },
  ]) {
    await t.test(variant.name, async (t) => {
      const workspaceRoot = await makeWorkspace(t);
      await writeFile(
        join(
          workspaceRoot,
          ".agent-context",
          "proposals",
          `invalid-${variant.name.replaceAll(" ", "-")}.md`,
        ),
        [
          "---",
          "schema_version: 1",
          `id: invalid-${variant.name.replaceAll(" ", "-")}`,
          `status: ${variant.status}`,
          `scope: ${variant.scope}`,
          "attention_targets:",
          "  - context:destructive-safety",
          "---",
          "",
          BODY_SENTINEL,
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await compile(workspaceRoot, taskSignature({
        operations: ["delete_cache"],
        paths: ["tmp/cache.bin"],
        domains: ["coding"],
        risk: "high",
      }));

      assert.equal(result.status, "fallback");
      assert.equal(result.reason, "high_risk_attention_scan_incomplete");
      assert.ok(result.warnings.includes(variant.warning));
      assert.equal(JSON.stringify(result).includes(BODY_SENTINEL), false);
    });
  }
});

test("high-risk relevant attention overflow abandons the bounded projection and returns full context", async (t) => {
  const workspaceRoot = await makeWorkspace(t);
  for (let index = 0; index < 4; index += 1) {
    await writeProposal(workspaceRoot, {
      id: `safety-attention-${index}`,
      attentionTargets: ["context:destructive-safety"],
      createdSecond: index,
    });
  }

  const result = await compile(workspaceRoot, taskSignature({
    operations: ["delete_cache"],
    paths: ["tmp/cache.bin"],
    domains: ["coding"],
    risk: "high",
  }));

  assert.equal(result.status, "fallback");
  assert.equal(result.mode, "legacy_full");
  assert.ok(result.attention.length <= 3);
  assert.match(result.content, /PACKAGE_BOUNDARY_SENTINEL/u);
  assert.match(result.content, /DOCS_WORKFLOW_BODY_SENTINEL/u);
  assert.match(result.content, /RELEASE_WORKFLOW_BODY_SENTINEL/u);
  assert.equal(result.metrics.fullContextBytes, result.metrics.modelVisibleBytes);
  assert.equal(result.metrics.savedBytes, 0);
});

function assertResultEnvelope(result) {
  assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
  assert.equal(result.schemaVersion, 1);
  assert.ok(["compiled", "fallback", "blocked"].includes(result.status));
  assert.ok(["progressive", "legacy_full", "none"].includes(result.mode));
  assert.equal(typeof result.content, "string");
  assert.ok(Array.isArray(result.catalog));
  assert.ok(Array.isArray(result.selectedPackIds));
  assert.ok(Array.isArray(result.selections));
  assert.ok(Array.isArray(result.attention));
  assert.ok(Array.isArray(result.warnings));
  assertMetrics(result);
}

function assertMetrics(result) {
  assert.deepEqual(Object.keys(result.metrics).sort(), METRIC_KEYS);
  const modelVisibleBytes = Buffer.byteLength(result.content, "utf8");
  assert.equal(result.metrics.modelVisibleBytes, modelVisibleBytes);
  assert.notEqual(
    result.metrics.modelVisibleBytes,
    result.content.length,
    "the multibyte fixture must catch accidental JavaScript code-unit accounting",
  );
  const savedBytes = result.metrics.fullContextBytes - result.metrics.modelVisibleBytes;
  assert.equal(result.metrics.savedBytes, savedBytes);
  assert.equal(
    result.metrics.reductionBasisPoints,
    result.metrics.fullContextBytes === 0
      ? 0
      : Math.trunc((savedBytes * 10_000) / result.metrics.fullContextBytes),
  );
}

async function compile(workspaceRoot, signature) {
  return compileWorkspaceContext({
    workspaceRoot,
    taskSignature: signature,
  });
}

function taskSignature(overrides = {}) {
  return {
    schemaVersion: 1,
    operations: [],
    paths: [],
    tools: [],
    skills: [],
    domains: [],
    risk: "normal",
    requestedPacks: [],
    ...overrides,
  };
}

async function makeWorkspace(
  t,
  {
    markers = true,
    invalidMarker = false,
    includeSafety = true,
    writeOrder = "forward",
  } = {},
) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-compiler-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const sources = contextSources({ markers, invalidMarker, includeSafety });
  const entries = Object.entries(sources);
  if (writeOrder === "reverse") entries.reverse();
  for (const [path, source] of entries) {
    const absolutePath = join(workspaceRoot, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source, "utf8");
  }
  return workspaceRoot;
}

async function enableResearchDomain(
  workspaceRoot,
  {
    id = "research-only",
    includeCore = false,
    priority = "normal",
  } = {},
) {
  const configPath = join(workspaceRoot, ".agent-context", "config.yml");
  const config = await readFile(configPath, "utf8");
  await writeFile(
    configPath,
    config.replace("enabled_domains: [coding]", "enabled_domains: [coding, research]"),
    "utf8",
  );
  await writeFile(
    join(
      workspaceRoot,
      ".agent-context",
      "checklists",
      "research.md",
    ),
    [
      "# Research Context",
      "",
      ...(includeCore
        ? [
            contextBlock(
              {
                schemaVersion: 1,
                id: "research-core",
                kind: "core",
                description: "Research-only core guidance.",
              },
              "- RESEARCH_CORE_BODY_SENTINEL: apply only when research is task-relevant.",
            ),
            "",
          ]
        : []),
      contextBlock(
        {
          schemaVersion: 1,
          id,
          kind: "pack",
          description: "Research-only evidence collection.",
          priority,
          match:
            priority === "safety"
              ? { domains: ["research"], risks: ["high"] }
              : { domains: ["research"] },
        },
        packBody(
          "RESEARCH_ONLY_BODY_SENTINEL",
          "Collect primary research evidence for research tasks.",
        ),
      ),
      "",
    ].join("\n"),
    "utf8",
  );
}

async function appendCatalogPacks(workspaceRoot, count) {
  const checklistPath = join(
    workspaceRoot,
    ".agent-context",
    "checklists",
    "coding.md",
  );
  const source = await readFile(checklistPath, "utf8");
  const packs = Array.from({ length: count }, (_, index) =>
    contextBlock(
      {
        schemaVersion: 1,
        id: `bounded-pack-${String(index).padStart(3, "0")}`,
        kind: "pack",
        description: "Bounded catalog overflow fixture.",
        priority: "normal",
        match: { operations: ["bounded_catalog_fixture"] },
      },
      `- BOUNDED_CATALOG_FIXTURE_${String(index).padStart(3, "0")}`,
    )).join("\n\n");
  await writeFile(checklistPath, `${source}\n${packs}\n`, "utf8");
}

async function insertRuleMarker(workspaceRoot, { sentinel, marker }) {
  const checklistPath = join(
    workspaceRoot,
    ".agent-context",
    "checklists",
    "coding.md",
  );
  const source = await readFile(checklistPath, "utf8");
  const needle = `- ${sentinel}:`;
  assert.ok(source.includes(needle), `missing rule-marker fixture sentinel: ${sentinel}`);
  await writeFile(
    checklistPath,
    source.replace(needle, `${marker}\n${needle}`),
    "utf8",
  );
}

async function appendRuleMarkers(
  workspaceRoot,
  relativePath,
  sourcePrefix,
  count,
) {
  const path = join(workspaceRoot, relativePath);
  const source = await readFile(path, "utf8");
  const markers = Array.from({ length: count }, (_, index) => {
    const sourceId = `${sourcePrefix}-${index}`;
    return `<!-- acp-rule: ${sourceId}#1; source: ${sourceId}; subsumes: none -->`;
  }).join("\n");
  await writeFile(path, `${source.trimEnd()}\n${markers}\n`, "utf8");
}

function contextSources({ markers, invalidMarker, includeSafety }) {
  const core = contextBlock(
    {
      schemaVersion: 1,
      id: "workspace-safety",
      kind: "core",
      description: "Workspace safety and authority boundaries.",
    },
    "- CORE_AUTHORITY_SENTINEL: 核心安全边界，current source remains authoritative.",
  );
  const packagePack = contextBlock(
    {
      schemaVersion: 1,
      id: "package-boundary",
      kind: "pack",
      description: "Package metadata and distribution verification.",
      priority: "normal",
      match: {
        operations: ["package_metadata_change"],
        pathBasenames: ["package.json", "package-lock.json"],
        domains: ["coding"],
      },
    },
    packBody(
      "PACKAGE_BOUNDARY_SENTINEL",
      "Run distribution verification after package metadata changes.",
    ),
  );
  const docsPack = contextBlock(
    {
      schemaVersion: 1,
      id: "docs-workflow",
      kind: "pack",
      description: "Documentation-only validation.",
      priority: "normal",
      match: {
        operations: ["documentation_change"],
        pathBasenames: ["README.md"],
        domains: ["coding"],
      },
    },
    packBody(
      "DOCS_WORKFLOW_BODY_SENTINEL",
      "Validate links and prose without package distribution work.",
    ),
  );
  const releasePack = contextBlock(
    {
      schemaVersion: 1,
      id: "release-workflow",
      kind: "pack",
      description: "Release publication and rollback verification.",
      priority: "normal",
      match: {
        operations: ["publish_release"],
        tools: ["gh"],
        domains: ["coding"],
      },
    },
    packBody(
      "RELEASE_WORKFLOW_BODY_SENTINEL",
      "Verify immutable artifacts and rollback before publication.",
    ),
  );
  const safetyPack = contextBlock(
    {
      schemaVersion: 1,
      id: "destructive-safety",
      kind: "pack",
      description: "Safety checks for destructive or high-risk operations.",
      priority: "safety",
      match: {
        operations: ["database_migration"],
        pathPrefixes: ["db/"],
        domains: ["coding"],
        risks: ["high"],
      },
    },
    packBody(
      "DESTRUCTIVE_SAFETY_BODY_SENTINEL",
      "Resolve exact targets and preserve a recoverable boundary.",
    ),
  );
  let profile = [
    "# Project Profile",
    "",
    "- LEGACY_UNMARKED_MUST_SURVIVE: an old Schema 1 rule remains active.",
    "",
    core,
    "",
  ].join("\n");
  let coding = [
    "# Coding Context",
    "",
    packagePack,
    "",
    docsPack,
    "",
    releasePack,
    "",
    ...(includeSafety ? [safetyPack, ""] : []),
  ].join("\n");

  if (!markers) {
    profile = removeContextMarkers(profile);
    coding = removeContextMarkers(coding);
  } else if (invalidMarker) {
    coding = coding.replace(
      /^<!-- acp-context: \{"schemaVersion":1,"id":"package-boundary"[^\n]+$/mu,
      '<!-- acp-context: {"schemaVersion":1,"id":"package-boundary","kind":"pack" INVALID -->',
    );
  }

  return {
    ".agent-context/PROJECT_CONTEXT_INDEX.md": [
      "# Project Context Index",
      "",
      "Read PROJECT_PROFILE.md and only the relevant enabled checklist.",
      "Do not load proposals, reports, or archive by default.",
      "",
    ].join("\n"),
    ".agent-context/PROJECT_PROFILE.md": profile,
    ".agent-context/checklists/coding.md": coding,
    ".agent-context/config.yml": configSource(),
    ".agent-context/proposals/README.md": "# Proposals\n\nOn-demand history only.\n",
    ".agent-context/reports/README.md": "# Reports\n\nNot default context.\n",
    ".agent-context/archive/README.md": "# Archive\n\nNever default context.\n",
  };
}

function contextBlock(metadata, body) {
  return [
    `<!-- acp-context: ${JSON.stringify(metadata)} -->`,
    body,
    "<!-- /acp-context -->",
  ].join("\n");
}

function packBody(sentinel, sentence) {
  return [`- ${sentinel}: ${sentence}`, ...Array(48).fill(`- ${sentence}`)].join("\n");
}

function removeContextMarkers(source) {
  return source
    .split("\n")
    .filter((line) => !line.startsWith("<!-- acp-context:") && line !== "<!-- /acp-context -->")
    .join("\n");
}

function configSource() {
  return [
    "schema_version: 1",
    'created_with_kit_version: "0.5.6"',
    "last_migrated_with_kit_version: null",
    "",
    "context_write_policy: auto",
    "enabled_domains: [coding]",
    "",
    "budgets:",
    "  active_context:",
    "    unit: lines",
    "    warn: 500",
    "    block_auto: 800",
    "  single_proposal:",
    "    unit: lines",
    "    warn: 220",
    "  pending_proposals:",
    "    unit: count",
    "    warn: 8",
    "    block_auto: 12",
    "",
    "privacy:",
    "  raw_conversation_stored: false",
    "  full_logs_stored: false",
    "  secrets_stored: false",
    "  customer_data_stored: false",
    "  absolute_user_paths_stored: false",
    "",
  ].join("\n");
}

async function writeProposal(
  workspaceRoot,
  {
    id,
    status = "proposed",
    attentionTargets,
    bodySentinel = "SANITIZED_PROPOSAL_BODY",
    createdSecond = 0,
  },
) {
  const proposal = proposalSource({
    id,
    status,
    attentionTargets,
    bodySentinel,
    createdSecond,
  });
  assert.deepEqual(
    validateProposalDocument(proposal, `${id}.md`),
    [],
    `test setup generated an invalid proposal: ${id}`,
  );
  const path = join(workspaceRoot, ".agent-context", "proposals", `${id}.md`);
  await writeFile(path, proposal, "utf8");
}

function proposalSource({ id, status, attentionTargets, bodySentinel, createdSecond }) {
  const pending = status === "pending_current_fix";
  const timestamp = `2026-09-01T00:00:${String(createdSecond).padStart(2, "0")}Z`;
  const plan = pending
    ? undefined
    : {
        schemaVersion: 1,
        planId: `plan-${id}`,
        proposalId: id,
        semanticOperation: "update",
        requestedPolicy: "propose",
        policy: "propose",
        policyReason: "workspace_policy_propose",
        risk: "high",
        currentFixStatus: "verified",
        privacy: { safe: true },
        contextHealth: { autoAllowed: false },
        contextDelta: { activeLinesBefore: 10, activeLinesAfter: 10 },
        operations: [
          {
            type: "update",
            target: ".agent-context/checklists/coding.md",
            beforeHash: "1".repeat(64),
            content: `# Coding Context\n\nProposed candidate for ${id}.\n`,
          },
        ],
      };
  const planHash = plan ? evolveRuntime.computePlanHash(plan) : null;
  const decision =
    status === "approved"
      ? [
          "- decision: approved",
          `  decided_at: ${timestamp}`,
          "  decided_by: fixture_user",
          `  plan_hash: ${planHash}`,
          "  reason: Exact fixture plan approved for attention testing.",
        ].join("\n")
      : "None.";
  const proposedPatch = pending
    ? "Current fix remains in progress; no PatchPlan exists yet."
    : [
        "### PatchPlan JSON",
        "",
        "~~~~json",
        JSON.stringify(plan, null, 2),
        "~~~~",
      ].join("\n");

  return [
    "---",
    "schema_version: 1",
    `id: ${id}`,
    `status: ${status}`,
    "scope: workspace",
    "operation: update",
    `trigger: ${pending ? "stale_context" : "verification_fixture"}`,
    `current_fix_status: ${pending ? "in_progress" : "verified"}`,
    "target_files:",
    "  - .agent-context/checklists/coding.md",
    ...(attentionTargets
      ? ["attention_targets:", ...attentionTargets.map((target) => `  - ${target}`)]
      : []),
    "confidence: high",
    "authority: current_source",
    "retention_value: high",
    `plan_hash: ${planHash ?? "null"}`,
    "created_by: verification",
    `created_at: ${timestamp}`,
    `updated_at: ${timestamp}`,
    "privacy:",
    "  raw_conversation_stored: false",
    "  full_logs_stored: false",
    "  secrets_stored: false",
    "  customer_data_stored: false",
    "  absolute_user_paths_stored: false",
    "  redactions: []",
    "---",
    "",
    "## Observed Failure",
    "",
    "A bounded fixture indicates that selected context may need correction.",
    "",
    "## Evidence",
    "",
    `- pointer: tests/context-compiler/${id}`,
    "- summary: Sanitized compiler attention fixture.",
    "",
    "## Root Cause",
    "",
    bodySentinel,
    "",
    "## Future Risk",
    "",
    "The relevant rule may otherwise remain stale.",
    "",
    "## Proposed Patch",
    "",
    proposedPatch,
    "",
    "## Why This Scope",
    "",
    "The candidate targets one workspace checklist.",
    "",
    "## Why Not Broader",
    "",
    "No global behavior is changed.",
    "",
    "## Context Priority",
    "",
    "Current-source evidence with high retention value.",
    "",
    "## Privacy Check",
    "",
    "Only sanitized fixture metadata is retained.",
    "",
    "## Decision Log",
    "",
    decision,
    "",
    "## Apply Attempts",
    "",
    "None.",
    "",
    "## Supersession",
    "",
    "None.",
    "",
    "## Rejection Notes",
    "",
    "Not rejected.",
    "",
  ].join("\n");
}

function insertAttentionTargets(source, targets) {
  return source.replace(
    /^(target_files:\n(?:  - .+\n)+)/mu,
    `$1attention_targets:\n${targets.map((target) => `  - ${target}`).join("\n")}\n`,
  );
}

async function snapshotTree(workspaceRoot) {
  const entries = [];
  await visit(workspaceRoot);
  return entries.sort((left, right) => left.path.localeCompare(right.path));

  async function visit(path) {
    const info = await lstat(path);
    const relativePath = relative(workspaceRoot, path).replaceAll("\\", "/") || ".";
    const mode = info.mode & 0o777;
    if (info.isSymbolicLink()) {
      entries.push({ path: relativePath, type: "symlink", mode, target: await readlink(path) });
      return;
    }
    if (info.isDirectory()) {
      entries.push({ path: relativePath, type: "directory", mode });
      const children = await readdir(path);
      for (const child of children.toSorted()) await visit(join(path, child));
      return;
    }
    const bytes = await readFile(path);
    entries.push({
      path: relativePath,
      type: "file",
      mode,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
