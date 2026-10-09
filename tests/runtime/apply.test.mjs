import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  applyProposal,
  expireWorkspaceState,
  formatReceipt,
  loadWorkspace,
  parseFrontmatter,
  parseYaml,
  sha256Text,
} from "../../skills/evolve/runtime/index.mjs";
import { createWorkspace, KIT, proposal, rule, seed, TODAY } from "./helpers.mjs";

const read = (root, ...segments) => readFileSync(join(root, ".agent-context", ...segments), "utf8");

test("apply add writes the rule, an audit with a unified diff and hashes, and the catalog", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    const result = await seed(root, "2026-09-14-first", [{ op: "add", rule: rule("first", { kind: "gate", applies_to: { ops: ["pr"] } }) }]);
    assert.deepEqual(result.targets, [".agent-context/rules/first.md"]);
    assert.equal(result.receipt, `Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=2026-09-14-first; targets=.agent-context/rules/first.md; catalog=${result.catalog.bytes}B/1 rules.`);
    const ruleFile = read(root, "rules", "first.md");
    const { data: audit, body } = parseFrontmatter(read(root, "proposals", "2026-09-14-first.md"));
    assert.equal(audit.decision, "auto_applied");
    assert.equal(audit.kit_version, KIT);
    assert.equal(audit.applied_at, "2026-09-14T08:00:00.000Z");
    assert.deepEqual(JSON.parse(JSON.stringify(audit.before_hashes)), {});
    assert.deepEqual(JSON.parse(JSON.stringify(audit.after_hashes)), { ".agent-context/rules/first.md": sha256Text(ruleFile) });
    assert.match(body, /## Evidence\n\ntests\/runtime fixture 2026-09-14-first\n/u);
    assert.match(body, /```diff\n--- \/dev\/null\n\+\+\+ \.agent-context\/rules\/first\.md\n/u);
    assert.ok(!body.includes("kind: gate\nkind: gate"), "the audit stores a diff, not a second full copy");
    assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /- gate \[first\] Hook first/u);
  } finally {
    dispose();
  }
});

test("supersede archives the replaced rule and retire records the reason", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "p-1", [
      { op: "add", rule: rule("old-one", { hook: "Old hook about deploy order" }) },
      { op: "add", rule: rule("doomed", { hook: "Something no longer true" }) },
    ]);
    const result = await seed(root, "p-2", [
      { op: "supersede", replaces: ["old-one"], rule: rule("new-one", { hook: "New hook about deploy order", body: "Replaces old-one." }) },
      { op: "retire", id: "doomed", reason: "the workflow was removed" },
    ], { approved: true });
    assert.deepEqual(result.targets, [
      ".agent-context/archive/rules/doomed.md",
      ".agent-context/archive/rules/old-one.md",
      ".agent-context/rules/new-one.md",
      ".agent-context/rules/old-one.md",
      ".agent-context/rules/doomed.md",
    ].sort());
    assert.ok(!existsSync(join(root, ".agent-context", "rules", "old-one.md")));
    const archived = parseFrontmatter(read(root, "archive", "rules", "old-one.md")).data;
    assert.equal(archived.superseded_by, "new-one");
    const retired = parseFrontmatter(read(root, "archive", "rules", "doomed.md")).data;
    assert.equal(retired.retired, TODAY);
    assert.equal(retired.retired_reason, "the workflow was removed");
    const fresh = parseFrontmatter(read(root, "rules", "new-one.md")).data;
    assert.deepEqual(fresh.supersedes, ["old-one"]);
    const audit = read(root, "proposals", "p-2.md");
    assert.match(audit, /--- \.agent-context\/rules\/old-one\.md\n\+\+\+ \/dev\/null/u);
    const workspace = await loadWorkspace(root);
    assert.deepEqual(workspace.rules.map((entry) => entry.id), ["new-one"]);
  } finally {
    dispose();
  }
});

test("state_set, state_clear, expiry, and profile operations manage STATE.yml and PROFILE.md", async () => {
  const { root, dispose } = await createWorkspace({ profile: "# Profile\n\n- Test: npm test\n" });
  try {
    await seed(root, "p-1", [
      { op: "state_set", entry: { id: "review", text: "PR 7 in review", repos: ["ilands"] } },
      { op: "state_set", entry: { id: "short", text: "expires soon", ttl_days: 1 } },
    ]);
    let state = parseYaml(read(root, "STATE.yml"));
    assert.deepEqual(state.map((entry) => [entry.id, entry.expires]), [["review", "2026-09-28"], ["short", "2026-09-15"]]);

    const later = "2026-09-20";
    const cleared = await applyProposal({
      workspaceRoot: root,
      proposal: proposal("p-2", [
        { op: "state_clear", id: "review" },
        { op: "profile", before_hash: sha256Text("# Profile\n\n- Test: npm test\n"), content: "# Profile\n\n- Test: npm test\n- Lint: npm run lint\n" },
      ]),
      today: later, kitVersion: KIT, now: `${later}T00:00:00.000Z`,
    });
    assert.equal(cleared.status, "applied", JSON.stringify(cleared));
    assert.deepEqual(cleared.expired, ["short"], "expired entries are archived as part of the same commit");
    assert.deepEqual(cleared.targets, [".agent-context/PROFILE.md", ".agent-context/STATE.yml", ".agent-context/archive/state.yml"]);
    state = parseYaml(read(root, "STATE.yml"));
    assert.deepEqual(JSON.parse(JSON.stringify(state)), []);
    assert.match(read(root, "PROFILE.md"), /Lint: npm run lint/u);

    const stale = await applyProposal({ workspaceRoot: root, proposal: proposal("p-3", [{ op: "profile", before_hash: sha256Text("old"), content: "x" }]), today: later, kitVersion: KIT });
    assert.equal(stale.status, "blocked");
    assert.equal(stale.reason, "profile_changed");

    await seed(root, "p-4", [{ op: "state_set", entry: { id: "gone", text: "will expire", expires: "2026-09-21" } }], { today: later });
    const expiry = await expireWorkspaceState({ workspaceRoot: root, today: "2026-10-01", kitVersion: KIT });
    assert.deepEqual(expiry.expired, ["gone"]);
    assert.match(read(root, "archive", "state.yml"), /id: gone\n[\s\S]*archived: 2026-10-01/u);
    assert.deepEqual(JSON.parse(JSON.stringify(parseYaml(read(root, "STATE.yml")))), []);
  } finally {
    dispose();
  }
});

test("gates: envelope, unverified fix, privacy, similarity, catalog budget, duplicates, and no-op", async () => {
  const { root, dispose } = await createWorkspace();
  try {
    await seed(root, "p-1", [{ op: "add", rule: rule("existing", { hook: "Never merge a pull request while any CI check is red" }) }]);
    const run = (id, operations, extra = {}, options = {}) =>
      applyProposal({ workspaceRoot: root, proposal: proposal(id, operations, extra), today: TODAY, kitVersion: KIT, ...options });

    const envelope = await run("Bad Id", [{ op: "add", rule: rule("x") }], { trigger: "vibes" });
    assert.equal(envelope.status, "failed");
    assert.equal(envelope.reason, "invalid_proposal");
    assert.match(envelope.details.join("\n"), /id must be|trigger must be/u);

    const unverified = await run("p-2", [{ op: "add", rule: rule("x") }], { fix_status: "unverified" });
    assert.deepEqual([unverified.status, unverified.reason], ["blocked", "current_fix_not_verified"]);

    const privacy = await run("p-3", [{ op: "add", rule: rule("x", { body: "token ghp_abcdefghijklmnopqrstuvwxyz0123" }) }]);
    assert.deepEqual([privacy.status, privacy.reason, privacy.details], ["failed", "privacy_hazard", ["credential"]]);
    const path = await run("p-3b", [{ op: "add", rule: rule("x") }], { evidence: "see /Users/me/notes.md" });
    assert.deepEqual([path.status, path.details], ["failed", ["absolute_user_path"]]);

    const similar = await run("p-4", [{ op: "add", rule: rule("dup-ish", { hook: "Never merge pull requests while a CI check is red" }) }]);
    assert.deepEqual([similar.status, similar.reason], ["blocked", "similar_rule_exists"]);
    assert.equal(similar.details.similar[0].id, "existing");
    const forced = await run("p-4", [{ op: "add", rule: rule("dup-ish", { hook: "Never merge pull requests while a CI check is red" }) }], {}, { approved: true });
    assert.equal(forced.status, "applied", "--approved bypasses the similarity gate");

    const duplicate = await run("p-5", [{ op: "add", rule: rule("existing") }]);
    assert.deepEqual([duplicate.status, duplicate.reason], ["failed", "invalid_rule"]);
    assert.match(duplicate.details.join("\n"), /already exists/u);

    const invalidRule = await run("p-6", [{ op: "add", rule: rule("x", { kind: "law" }) }]);
    assert.match(invalidRule.details.join("\n"), /kind must be one of/u);

    const missingRetire = await run("p-7", [{ op: "retire", id: "nope", reason: "gone" }]);
    assert.match(missingRetire.details.join("\n"), /is not active/u);

    const noop = await run("p-8", [{ op: "state_clear", id: "absent" }]);
    assert.deepEqual([noop.status, noop.reason], ["failed", "invalid_state"]);

    const replay = await run("p-1", [{ op: "add", rule: rule("another") }]);
    assert.deepEqual([replay.status, replay.reason], ["blocked", "proposal_exists"]);

    writeFileSync(join(root, ".agent-context", "config.yml"), read(root, "config.yml").replace("catalog_bytes: 8192", "catalog_bytes: 400"), "utf8");
    const budget = await run("p-9", [{ op: "add", rule: rule("too-much", { hook: "A completely different hook about deploy windows on Fridays" }) }]);
    assert.deepEqual([budget.status, budget.reason], ["blocked", "catalog_budget_exceeded"]);
    assert.ok(budget.details.catalog_bytes > 400);
  } finally {
    dispose();
  }
});

test("write_policy propose requires --approved, and a stale lock blocks the commit", async () => {
  const { root, dispose } = await createWorkspace({ writePolicy: "propose" });
  try {
    const pending = await applyProposal({ workspaceRoot: root, proposal: proposal("p-1", [{ op: "add", rule: rule("x") }]), today: TODAY, kitVersion: KIT });
    assert.deepEqual([pending.status, pending.reason, pending.targets], ["approval_required", "policy_requires_approval", [".agent-context/rules/x.md"]]);
    assert.ok(!existsSync(join(root, ".agent-context", "rules", "x.md")));
    writeFileSync(join(root, ".agent-context", ".lock"), "held", "utf8");
    const locked = await applyProposal({ workspaceRoot: root, proposal: proposal("p-1", [{ op: "add", rule: rule("x") }]), approved: true, today: TODAY, kitVersion: KIT });
    assert.deepEqual([locked.status, locked.reason], ["blocked", "workspace_locked"]);
  } finally {
    dispose();
  }
});

test("formatReceipt renders non-success stages with stable reasons", () => {
  assert.equal(
    formatReceipt({ detect: { status: "no_candidate", reason: "no_trigger" }, propose: { status: "not_needed", reason: "no_candidate" }, apply: { status: "not_attempted", reason: "no_proposal" } }),
    "Evolution outcome: detect=no_candidate(no_trigger); propose=not_needed(no_candidate); apply=not_attempted(no_proposal).",
  );
  assert.equal(
    formatReceipt({ detect: { status: "candidate" }, propose: { status: "created" }, apply: { status: "blocked", reason: "similar_rule_exists" }, proposalId: "p", targets: ["a"], catalog: { bytes: 10, rules: 1 } }),
    "Evolution outcome: detect=candidate; propose=created; apply=blocked(similar_rule_exists); proposal=p; targets=a; catalog=10B/1 rules.",
  );
});
