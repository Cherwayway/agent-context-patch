import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  daysBetween,
  findPrivacyHazard,
  globMatch,
  isIdentifier,
  jaccard,
  similarityTokens,
  slugify,
  unifiedDiff,
} from "../../skills/evolve/runtime/text.mjs";

test("privacy scan flags keys, credentials, and home paths but not ordinary prose", () => {
  assert.equal(findPrivacyHazard("-----BEGIN RSA PRIVATE KEY-----"), "private_key");
  assert.equal(findPrivacyHazard("token ghp_abcdefghijklmnopqrstuvwxyz0123"), "credential");
  assert.equal(findPrivacyHazard("api_key = sk_live_abcdefgh12345"), "credential_assignment");
  assert.equal(findPrivacyHazard("see /Users/someone/Pawlogic/x.md"), "absolute_user_path");
  assert.equal(findPrivacyHazard("C:\\Users\\someone\\repo"), "absolute_user_path");
  assert.equal(findPrivacyHazard("password: redacted"), undefined);
  assert.equal(findPrivacyHazard("Run npm test after editing src/greeting.js under ilands/"), undefined);
});

test("identifiers and slugs are lowercase kebab-case", () => {
  assert.ok(isIdentifier("a-b-1"));
  assert.ok(!isIdentifier("A-b"));
  assert.ok(!isIdentifier("-a"));
  assert.ok(!isIdentifier("a".repeat(81)));
  assert.equal(slugify("Never run  Git Stash!! in worktrees"), "never-run-git-stash-in-worktrees");
  assert.equal(slugify("x".repeat(80), 10), "xxxxxxxxxx");
});

test("date helpers work in UTC", () => {
  assert.equal(addDays("2026-02-28", 2), "2026-03-02");
  assert.equal(daysBetween("2026-09-01", "2026-09-14"), 13);
  assert.equal(daysBetween("2026-09-14", "2026-09-01"), -13);
});

test("similarity ignores stop words and counts CJK characters", () => {
  const left = similarityTokens("Never merge a PR with a red CI check");
  const right = similarityTokens("Do not merge PRs when the CI check is red");
  assert.ok(left.has("merge") && !left.has("the") && !left.has("a"));
  const score = jaccard(left, right);
  assert.ok(score > 0.3 && score < 1, `unexpected score ${score}`);
  assert.equal(jaccard(new Set(), new Set()), 0);
  assert.ok(similarityTokens("送审后再 push").has("送"));
});

test("glob matching spans directories with ** and basenames without a slash", () => {
  assert.ok(globMatch("ilands/**/*.sql", "ilands/migrations/2026/001.sql"));
  assert.ok(!globMatch("ilands/*.sql", "ilands/migrations/001.sql"));
  assert.ok(globMatch("*.sql", "ilands/migrations/001.sql"), "a bare pattern matches the basename");
  assert.ok(globMatch("package.json", "demos/fake-js-repo/package.json"));
  assert.ok(globMatch("src/greeting.js", "src/greeting.js"));
  assert.ok(!globMatch("src/greeting.js", "lib/src/greeting.js"));
  assert.ok(globMatch("**/greeting.js", "lib/src/greeting.js"));
  assert.ok(globMatch("file?.md", "file1.md") && !globMatch("file?.md", "file10.md"));
});

test("unified diff renders creations, deletions, and in-place edits with context", () => {
  const created = unifiedDiff(null, "a\nb\n", ".agent-context/rules/x.md", ".agent-context/rules/x.md");
  assert.match(created, /^--- \/dev\/null\n\+\+\+ \.agent-context\/rules\/x\.md\n@@ -0,0 \+1,2 @@\n\+a\n\+b\n$/u);
  const removed = unifiedDiff("a\n", null, "x", "x");
  assert.match(removed, /^--- x\n\+\+\+ \/dev\/null\n@@ -1 \+0,0 @@\n-a\n$/u);
  const edited = unifiedDiff("1\n2\n3\n4\n5\n6\n7\n", "1\n2\n3\nX\n5\n6\n7\n", "f", "f");
  assert.match(edited, /@@ -2,5 \+2,5 @@\n 2\n 3\n-4\n\+X\n 5\n 6\n$/u);
  assert.equal(unifiedDiff("same\n", "same\n", "f", "f"), "");
});
