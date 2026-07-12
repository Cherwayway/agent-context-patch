import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const playbook = readFileSync(
  join(repositoryRoot, "skills", "evolve", "references", "personal-dogfooding.zh-CN.md"),
  "utf8",
);

test("playbook positive case specifies eligible application without blocking", () => {
  const positive = section("### Positive: 应该沉淀", "### Negative: 不应该沉淀");
  const behavior = compact(positive);

  for (const expected of [
    "先运行验证并修好当前任务",
    "搜索 Active Context",
    "$evolve after-failure",
    "workspace checklist PatchPlan",
    "不得直接修改全局指令或脚手架",
  ]) {
    assert.ok(positive.includes(expected), `positive case is missing behavior: ${expected}`);
  }
  assert.match(behavior, /符合全部 `auto` gate 后立即应用/u);
  assert.match(behavior, /无需用户批准或回复/u);
  assert.match(behavior, /一次非阻塞回执/u);
  assert.doesNotMatch(behavior, /等待精确批准/u);
});

test("playbook negative case specifies no durable context for one-off work", () => {
  const negative = section("### Negative: 不应该沉淀", "## First 30 Days");

  assert.match(negative, /一次性/u);
  assert.match(negative, /不运行 evolution loop/u);
  assert.match(negative, /不创建 Proposal、周报或长期\s*context/u);
});

test("the dogfood guide defaults to auto with one non-blocking receipt", () => {
  const guide = compact(playbook);
  assert.match(guide, /experimental-owner-dogfood/u);
  assert.match(guide, /唯一规则来自 `protocol-v1\.md` 与 `proposal-schema\.md`/u);
  assert.match(guide, /个人使用默认保持 `context_write_policy: auto`/u);
  assert.match(guide, /符合全部 `auto` gate 后立即应用/u);
  assert.match(guide, /无需用户批准或回复/u);
  assert.match(guide, /一次非阻塞回执/u);
});

function section(startHeading, endHeading) {
  const start = playbook.indexOf(startHeading);
  const end = playbook.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(start, -1, `missing heading: ${startHeading}`);
  assert.notEqual(end, -1, `missing heading: ${endHeading}`);
  return playbook.slice(start, end);
}

function compact(value) {
  return value.replace(/\s+/gu, " ");
}
