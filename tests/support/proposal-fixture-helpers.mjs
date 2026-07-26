import assert from "node:assert/strict";

export function replaceSectionContent(source, heading, content) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `fixture is missing ${marker}`);
  const next = source.indexOf("\n## ", start + marker.length);
  const end = next === -1 ? source.length : next;
  return `${source.slice(0, start + marker.length)}\n\n${content}\n${source.slice(end)}`;
}

export function replacePatchPlan(source, plan) {
  const opening = source.indexOf("~~~~json");
  assert.notEqual(opening, -1);
  const jsonStart = source.indexOf("\n", opening) + 1;
  const closing = source.indexOf("\n~~~~", jsonStart);
  assert.notEqual(closing, -1);
  return `${source.slice(0, jsonStart)}${JSON.stringify(plan, null, 2)}${source.slice(closing)}`;
}
