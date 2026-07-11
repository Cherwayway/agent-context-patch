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

test("fresh-context positive case preserves the canonical proposal lifecycle", () => {
  const positive = section("### Positive: 应该沉淀", "### Negative: 不应该沉淀");

  for (const expected of [
    "先运行验证并修好当前任务",
    "搜索 Active Context",
    "$evolve after-failure",
    "workspace checklist PatchPlan",
    "等待精确批准",
    "不得直接修改全局指令或脚手架",
  ]) {
    assert.ok(positive.includes(expected), `positive case is missing behavior: ${expected}`);
  }
});

test("fresh-context negative case makes one-off work produce no durable context", () => {
  const negative = section("### Negative: 不应该沉淀", "## First 30 Days");

  assert.match(negative, /一次性/u);
  assert.match(negative, /不运行 evolution loop/u);
  assert.match(negative, /不创建 Proposal、周报或长期\s*context/u);
});

test("the dogfood guide delegates approval semantics to the v1 protocol", () => {
  assert.match(playbook, /experimental-owner-dogfood/u);
  assert.match(playbook, /唯一规则来自 `protocol-v1\.md` 与 `proposal-schema\.md`/u);
  assert.match(playbook, /只有精确 PatchPlan 获批/u);
  assert.match(playbook, /只有在精确计划获批后才处理/u);
});

function section(startHeading, endHeading) {
  const start = playbook.indexOf(startHeading);
  const end = playbook.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(start, -1, `missing heading: ${startHeading}`);
  assert.notEqual(end, -1, `missing heading: ${endHeading}`);
  return playbook.slice(start, end);
}
