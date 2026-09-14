import { createHash } from "node:crypto";

const PRIVATE_KEY_MARKER = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/i;
const CREDENTIAL_ASSIGNMENT =
  /\b(?:[A-Z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*(?!["'`]?(?:false|true|null|none|redacted)\b)["'`]?[A-Za-z0-9_./+=:@-]{8,}/i;
const WELL_KNOWN_CREDENTIAL =
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{10,})\b/i;
const USER_HOME_ABSOLUTE_PATH =
  /(?:^|[\s"'`(])(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+(?:[\\/]|$)|\/(?:home|Users)\/[^/\s]+(?:\/|$))/m;

export function sha256Text(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

export function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Returns the first privacy hazard class found in `content`, or undefined. */
export function findPrivacyHazard(content) {
  if (PRIVATE_KEY_MARKER.test(content)) return "private_key";
  if (WELL_KNOWN_CREDENTIAL.test(content)) return "credential";
  if (CREDENTIAL_ASSIGNMENT.test(content)) return "credential_assignment";
  if (USER_HOME_ABSOLUTE_PATH.test(content)) return "absolute_user_path";
  return undefined;
}

export const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;

export function isIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function slugify(value, maxLength = 60) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, maxLength)
    .replace(/-+$/u, "");
  return slug;
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value));
}

export function addDays(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return isoDate(result);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "be",
  "before", "after", "when", "then", "that", "this", "it", "its", "as", "by", "at", "from",
  "not", "no", "do", "does", "any", "every", "only", "into", "than", "so", "if", "must",
]);

/** Tokens used for hook similarity: lowercase ASCII words plus CJK characters. */
export function similarityTokens(text) {
  const tokens = new Set();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9][a-z0-9_.-]*[a-z0-9]|[a-z0-9]|[\p{Script=Han}]/gu)) {
    const token = match[0];
    if (token.length === 1 && /[a-z0-9]/u.test(token)) continue;
    if (STOP_WORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

export function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/**
 * Minimal glob matcher for workspace-relative paths: `**` spans directories,
 * `*` spans within one segment. Patterns without a slash match against the
 * basename as well as the full path.
 */
export function globMatch(pattern, path) {
  const regex = globToRegExp(pattern);
  if (regex.test(path)) return true;
  if (!pattern.includes("/")) {
    const basename = path.slice(path.lastIndexOf("/") + 1);
    return regex.test(basename);
  }
  return false;
}

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "u");
}

/** Unified diff of two texts; both files are small so an LCS table is fine. */
export function unifiedDiff(beforeText, afterText, beforeName, afterName, context = 2) {
  const before = beforeText === null ? [] : splitLines(beforeText);
  const after = afterText === null ? [] : splitLines(afterText);
  const ops = diffOps(before, after);
  const hunks = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind === "equal") {
      index += 1;
      continue;
    }
    const start = Math.max(0, index - context);
    let end = index;
    let sinceChange = 0;
    while (end < ops.length && sinceChange <= context * 2) {
      if (ops[end].kind === "equal") sinceChange += 1;
      else sinceChange = 0;
      end += 1;
    }
    end = Math.min(ops.length, end - Math.max(0, sinceChange - context));
    hunks.push(ops.slice(start, end));
    index = end;
  }
  if (hunks.length === 0) return "";
  const lines = [`--- ${beforeText === null ? "/dev/null" : beforeName}`, `+++ ${afterText === null ? "/dev/null" : afterName}`];
  for (const hunk of hunks) {
    const beforeStart = (hunk.find((op) => op.kind !== "insert")?.beforeIndex ?? before.length) + 1;
    const afterStart = (hunk.find((op) => op.kind !== "delete")?.afterIndex ?? after.length) + 1;
    const beforeCount = hunk.filter((op) => op.kind !== "insert").length;
    const afterCount = hunk.filter((op) => op.kind !== "delete").length;
    lines.push(`@@ -${range(beforeStart, beforeCount)} +${range(afterStart, afterCount)} @@`);
    for (const op of hunk) {
      const prefix = op.kind === "equal" ? " " : op.kind === "delete" ? "-" : "+";
      lines.push(`${prefix}${op.line}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function range(start, count) {
  if (count === 0) return `${start - 1},0`;
  return count === 1 ? `${start}` : `${start},${count}`;
}

function splitLines(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function diffOps(before, after) {
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ kind: "equal", line: before[i], beforeIndex: i, afterIndex: j });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "delete", line: before[i], beforeIndex: i, afterIndex: j });
      i += 1;
    } else {
      ops.push({ kind: "insert", line: after[j], beforeIndex: i, afterIndex: j });
      j += 1;
    }
  }
  while (i < before.length) {
    ops.push({ kind: "delete", line: before[i], beforeIndex: i, afterIndex: j });
    i += 1;
  }
  while (j < after.length) {
    ops.push({ kind: "insert", line: after[j], beforeIndex: i, afterIndex: j });
    j += 1;
  }
  return ops;
}
