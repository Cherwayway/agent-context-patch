#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { compileWorkspaceContext } from "./context-compiler.mjs";

const arguments_ = process.argv.slice(2);
const workspaceIndex = arguments_.indexOf("--workspace");
const taskIndex = arguments_.indexOf("--task");
if (
  arguments_.length !== 4 ||
  workspaceIndex === -1 ||
  taskIndex === -1 ||
  workspaceIndex === taskIndex ||
  arguments_[workspaceIndex + 1] === undefined ||
  arguments_[taskIndex + 1] === undefined
) {
  process.stderr.write(
    "usage: node context-compiler-cli.mjs --workspace <path> --task <task-signature.json>\n",
  );
  process.exit(1);
}

let taskSignature;
try {
  taskSignature = JSON.parse(
    await readFile(arguments_[taskIndex + 1], "utf8"),
  );
} catch {
  process.stderr.write("invalid_task_signature_file\n");
  process.exit(1);
}

const result = await compileWorkspaceContext({
  workspaceRoot: arguments_[workspaceIndex + 1],
  taskSignature,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.status === "blocked" ? 2 : 0;
