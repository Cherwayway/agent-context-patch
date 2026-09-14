import assert from "node:assert/strict";
import test from "node:test";

import { parseFrontmatter, parseYaml, serializeFrontmatter, toYaml } from "../../skills/evolve/runtime/yaml.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

test("parseYaml reads the config subset: nested mappings, floats, inline lists, comments", () => {
  const document = parseYaml(`# config
schema_version: 2
kit_version: "0.7.0"
budgets:
  catalog_bytes: 8192 # bytes
  similarity_block: 0.5
tags: [a, "b c", 'd''e']
empty: []
nothing: {}
flag: true
none: null
`);
  assert.deepEqual(plain(document), {
    schema_version: 2,
    kit_version: "0.7.0",
    budgets: { catalog_bytes: 8192, similarity_block: 0.5 },
    tags: ["a", "b c", "d'e"],
    empty: [],
    nothing: {},
    flag: true,
    none: null,
  });
});

test("parseYaml handles sequences of mappings, quoted keys, and single-line scalars", () => {
  assert.deepEqual(plain(parseYaml("[]\n")), []);
  assert.deepEqual(plain(parseYaml("")), {});
  const state = parseYaml(`- id: a
  expires: 2026-09-20
  text: "x: y"
- id: b
  repos: [ilands]
`);
  assert.equal(state.length, 2);
  assert.deepEqual(plain(state[0]), { id: "a", expires: "2026-09-20", text: "x: y" });
  assert.deepEqual(plain(state[1]), { id: "b", repos: ["ilands"] });
  const hashes = parseYaml(`after_hashes:\n  ".agent-context/rules/a.md": abc\n  .agent-context/STATE.yml: def\n`);
  assert.deepEqual(plain(hashes.after_hashes), { ".agent-context/rules/a.md": "abc", ".agent-context/STATE.yml": "def" });
});

test("parseYaml rejects tabs, duplicate keys, and unclosed quotes with line numbers", () => {
  assert.throws(() => parseYaml("a:\n\tb: 1\n"), /:2: tabs are not supported/u);
  assert.throws(() => parseYaml("a: 1\na: 2\n", "config.yml"), /config\.yml:2: duplicate key a/u);
  assert.throws(() => parseYaml('a: "open\n'), /unclosed quoted string/u);
  assert.throws(() => parseYaml("a: [1, 2\n"), /unclosed inline list/u);
});

test("toYaml round-trips through parseYaml and quotes unsafe scalars and keys", () => {
  const document = {
    id: "x",
    hook: "Never run `git stash`: it pops other sessions",
    version: "0.7.0",
    number: "0123",
    colon: "a: b",
    hash: "a #b",
    list: ["plain", "with, comma", "true", 1.5],
    nested: { "path/with.dots": "ok", inner: [] },
    records: [{ id: "a", n: 1 }, { id: "b" }],
    nothing: null,
  };
  const text = toYaml(document);
  assert.match(text, /^version: "0\.7\.0"$/mu, "dotted versions must be quoted so YAML parsers keep them as strings");
  assert.match(text, /^  "path\/with\.dots": ok$/mu);
  assert.deepEqual(plain(parseYaml(text)), document);
});

test("frontmatter serializes with a trailing newline and parses back to the same body", () => {
  const text = serializeFrontmatter({ id: "a", list: [] }, "\n\nBody line\n\n");
  assert.equal(text, "---\nid: a\nlist: []\n---\n\nBody line\n");
  const parsed = parseFrontmatter(text);
  assert.deepEqual(plain(parsed.data), { id: "a", list: [] });
  assert.equal(parsed.body, "\nBody line\n");
  assert.equal(serializeFrontmatter({ id: "a" }, ""), "---\nid: a\n---\n");
  assert.throws(() => parseFrontmatter("no frontmatter"), /missing opening frontmatter delimiter/u);
  assert.throws(() => parseFrontmatter("---\nid: a\n"), /missing closing frontmatter delimiter/u);
});
