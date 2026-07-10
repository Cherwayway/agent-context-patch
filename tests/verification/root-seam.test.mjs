import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test(
  "npm test fails when the fake JavaScript demo behavior is broken",
  { skip: process.env.ACP_NESTED_VERIFICATION === "1" },
  () => {
    const sandbox = mkdtempSync(join(tmpdir(), "agent-context-patch-verification-"));

    try {
      cpSync(repositoryRoot, sandbox, {
        recursive: true,
        filter(source) {
          const relative = source.slice(repositoryRoot.length).replaceAll("\\", "/");
          return !relative.startsWith("/.git") && !relative.startsWith("/node_modules");
        },
      });
      keepOnlyDemoRegressionTests(sandbox);

      const greetingPath = join(sandbox, "demos", "fake-js-repo", "src", "greeting.js");
      const original = readFileSync(greetingPath, "utf8");
      writeFileSync(
        greetingPath,
        original.replace("`Hello, ${name}!`", '"Hello, World!"'),
        "utf8",
      );

      const result = spawnSync(npmCommand(), ["test"], {
        cwd: sandbox,
        encoding: "utf8",
        env: { ...process.env, ACP_NESTED_VERIFICATION: "1" },
        shell: process.platform === "win32",
        timeout: 60_000,
      });

      assert.ifError(result.error);
      assert.notEqual(
        result.status,
        0,
        [
          "The root npm test command passed even though the demo was broken.",
          "This means the public verification seam is not executing demo behavior.",
          result.stdout,
          result.stderr,
        ].join("\n"),
      );
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      assert.match(
        output,
        /the fake JavaScript repository passes its real test command/iu,
        "the nested root run failed, but did not execute the fake JavaScript demo test",
      );
      assert.match(
        output,
        /greeting must preserve caller-provided names/iu,
        "the nested root run did not surface the deliberately broken demo behavior",
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  },
);

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function keepOnlyDemoRegressionTests(sandbox) {
  rmSync(join(sandbox, "tests", "kernel"), { recursive: true, force: true });
  const verificationRoot = join(sandbox, "tests", "verification");
  const retained = new Set(["demo-runtime.test.mjs", "root-seam.test.mjs"]);
  for (const entry of readdirSync(verificationRoot)) {
    if (!retained.has(entry)) {
      rmSync(join(verificationRoot, entry), { recursive: true, force: true });
    }
  }
}
