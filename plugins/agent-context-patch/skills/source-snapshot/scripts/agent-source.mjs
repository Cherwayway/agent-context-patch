#!/usr/bin/env node

import {
  closeSourceSnapshot,
  createSourceSnapshot,
  defaultCacheRoot,
  defaultSessionRoot,
  resolveRemoteSource,
} from "../runtime/index.mjs";

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  let result;
  if (command === "resolve") {
    result = await resolveRemoteSource({
      repository: requireOption(options, "repo"),
      remote: options.remote ?? "origin",
      ref: requireOption(options, "ref"),
      cacheRoot: options["cache-root"] ?? defaultCacheRoot(),
      sessionRoot: options["session-root"] ?? defaultSessionRoot(),
    });
  } else if (command === "snapshot") {
    result = await createSourceSnapshot({
      receiptPath: requireOption(options, "receipt"),
      cacheRoot: options["cache-root"] ?? defaultCacheRoot(),
      sessionRoot: options["session-root"] ?? defaultSessionRoot(),
    });
  } else if (command === "close") {
    result = await closeSourceSnapshot({
      receiptPath: requireOption(options, "receipt"),
      cacheRoot: options["cache-root"] ?? defaultCacheRoot(),
      sessionRoot: options["session-root"] ?? defaultSessionRoot(),
    });
  } else {
    throw cliError("usage", usage());
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "unexpected_error";
  const message =
    code === "unexpected_error"
      ? "Source snapshot failed without a safe diagnostic."
      : error.message;
  process.stderr.write(`${JSON.stringify({ error: code, message }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArguments(arguments_) {
  const command = arguments_[0];
  const options = {};
  for (let index = 1; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw cliError("usage", usage());
    }
    const name = key.slice(2);
    if (
      ![
        "repo",
        "remote",
        "ref",
        "receipt",
        "cache-root",
        "session-root",
      ].includes(name) ||
      options[name] !== undefined
    ) {
      throw cliError("usage", usage());
    }
    options[name] = value;
  }
  return { command, options };
}

function requireOption(options, name) {
  if (!options[name]) throw cliError("usage", usage());
  return options[name];
}

function usage() {
  return [
    "usage:",
    "  agent-source resolve --repo <path> --ref <full-ref> [--remote origin]",
    "  agent-source snapshot --receipt <source.json>",
    "  agent-source close --receipt <source-or-snapshot.json>",
  ].join("\n");
}

function cliError(code, message) {
  return Object.assign(new Error(message), { code });
}
