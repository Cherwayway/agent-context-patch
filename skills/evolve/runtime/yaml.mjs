/**
 * A deliberately small YAML subset: mappings, sequences, scalars, inline
 * scalar lists, quoted strings, and `#` comments. It is enough for config,
 * rule frontmatter, and STATE.yml, and it round-trips through `toYaml`.
 */

export function parseYaml(source, label = "YAML") {
  if (typeof source !== "string") throw new TypeError(`${label}: source must be a string`);
  const lines = source
    .replace(/^﻿/u, "")
    .split(/\r?\n/u)
    .map((raw, index) => {
      if (raw.includes("\t")) throw new Error(`${label}:${index + 1}: tabs are not supported`);
      const withoutComment = stripInlineComment(raw);
      return {
        line: index + 1,
        indent: withoutComment.length - withoutComment.trimStart().length,
        content: withoutComment.trim(),
      };
    })
    .filter(({ content }) => content !== "");

  if (lines.length === 0) return createMapping();
  if (lines.length === 1 && !(lines[0].content.startsWith("- ") || lines[0].content === "-" || matchKey(lines[0].content))) {
    return parseScalar(lines[0].content, label, lines[0].line);
  }
  if (lines[0].indent !== 0) {
    throw new Error(`${label}:${lines[0].line}: the document must start at indentation zero`);
  }
  const [value, nextIndex] = parseBlock(lines, 0, 0, label);
  if (nextIndex !== lines.length) {
    throw new Error(`${label}:${lines[nextIndex].line}: unexpected indentation or unsupported syntax`);
  }
  return value;
}

export function parseFrontmatter(source, label = "Markdown") {
  const normalized = source.replace(/^﻿/u, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`${label}: missing opening frontmatter delimiter`);
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`${label}: missing closing frontmatter delimiter`);
  return {
    data: parseYaml(normalized.slice(4, end), `${label} frontmatter`),
    body: normalized.slice(end + 5),
  };
}

export function serializeFrontmatter(data, body) {
  const normalizedBody = body.replaceAll("\r\n", "\n").replace(/^\n+/u, "").replace(/\s+$/u, "");
  return `---\n${toYaml(data)}---\n${normalizedBody === "" ? "" : `\n${normalizedBody}\n`}`;
}

export function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value
      .map((item) =>
        isRecord(item)
          ? `${pad}- ${toYaml(item, indent + 2).slice(indent + 2)}`
          : `${pad}- ${scalar(item)}\n`,
      )
      .join("");
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${pad}{}\n`;
    return keys
      .map((rawKey) => {
        const item = value[rawKey];
        const key = /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(rawKey) ? rawKey : JSON.stringify(rawKey);
        if (Array.isArray(item)) {
          if (item.length === 0) return `${pad}${key}: []\n`;
          if (item.every((entry) => !isRecord(entry) && !Array.isArray(entry))) {
            return `${pad}${key}: [${item.map(scalar).join(", ")}]\n`;
          }
          return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
        }
        if (isRecord(item)) {
          if (Object.keys(item).length === 0) return `${pad}${key}: {}\n`;
          return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
        }
        return `${pad}${key}: ${scalar(item)}\n`;
      })
      .join("");
  }
  return `${pad}${scalar(value)}\n`;
}

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  const plainSafe =
    text !== "" &&
    !/^[\s"'\-[\]{}#&*!|>%@`,?:]/u.test(text) &&
    !/[:#]\s|\s#|\s$|^\s|[\n\r\t]|, /u.test(text) &&
    !/^(?:true|false|null|~|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+){2,}[0-9A-Za-z.+-]*)$/u.test(text) &&
    !text.endsWith(":");
  return plainSafe ? text : JSON.stringify(text);
}

function parseBlock(lines, startIndex, indent, label) {
  const isSequence = lines[startIndex].content.startsWith("- ") || lines[startIndex].content === "-";
  return isSequence ? parseSequence(lines, startIndex, indent, label) : parseMapping(lines, startIndex, indent, label);
}

function parseSequence(lines, startIndex, indent, label) {
  const values = [];
  let index = startIndex;
  while (index < lines.length && lines[index].indent === indent) {
    const { content, line } = lines[index];
    if (!(content.startsWith("- ") || content === "-")) break;
    const rawValue = content.slice(1).trim();
    if (rawValue === "") {
      const child = lines[index + 1];
      if (!child || child.indent <= indent) throw new Error(`${label}:${line}: empty sequence item`);
      const [value, nextIndex] = parseBlock(lines, index + 1, child.indent, label);
      values.push(value);
      index = nextIndex;
      continue;
    }
    const mappingMatch = matchKey(rawValue);
    if (mappingMatch) {
      // "- key: value" starts an inline mapping item whose siblings are indented by two.
      const itemIndent = indent + 2;
      const synthetic = { line, indent: itemIndent, content: rawValue };
      const rest = [];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor].indent >= itemIndent) {
        rest.push(lines[cursor]);
        cursor += 1;
      }
      const [value, consumed] = parseMapping([synthetic, ...rest], 0, itemIndent, label);
      if (consumed !== rest.length + 1) {
        throw new Error(`${label}:${line}: unsupported syntax inside sequence item`);
      }
      values.push(value);
      index = cursor;
      continue;
    }
    values.push(parseScalar(rawValue, label, line));
    index += 1;
  }
  return [values, index];
}

function parseMapping(lines, startIndex, indent, label) {
  const value = createMapping();
  let index = startIndex;
  while (index < lines.length && lines[index].indent === indent) {
    const { content, line } = lines[index];
    const match = matchKey(content);
    if (!match) break;
    const key = decodeKey(match[1], label, line);
    const rawValue = match[2] ?? "";
    if (Object.hasOwn(value, key)) throw new Error(`${label}:${line}: duplicate key ${key}`);
    if (rawValue !== "") {
      value[key] = parseScalar(rawValue, label, line);
      index += 1;
      continue;
    }
    const child = lines[index + 1];
    if (!child || child.indent <= indent) {
      value[key] = createMapping();
      index += 1;
      continue;
    }
    const [childValue, nextIndex] = parseBlock(lines, index + 1, child.indent, label);
    value[key] = childValue;
    index = nextIndex;
  }
  return [value, index];
}

const KEY_PATTERN = /^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_.][A-Za-z0-9_.\/-]*):(?:\s+(.*))?$/u;

function matchKey(content) {
  return KEY_PATTERN.exec(content);
}

function decodeKey(rawKey, label, line) {
  if (!rawKey.startsWith('"')) return rawKey;
  try {
    return JSON.parse(rawKey);
  } catch {
    throw new Error(`${label}:${line}: invalid quoted key`);
  }
}

function createMapping() {
  return Object.create(null);
}

function parseScalar(rawValue, label, line) {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "null" || rawValue === "~") return null;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(rawValue)) return Number(rawValue);
  if (rawValue === "[]") return [];
  if (rawValue === "{}") return createMapping();
  if (rawValue.startsWith("[")) {
    if (!rawValue.endsWith("]")) throw new Error(`${label}:${line}: unclosed inline list`);
    const inner = rawValue.slice(1, -1).trim();
    if (inner === "") return [];
    return splitInlineList(inner, label, line).map((part) => parseScalar(part, label, line));
  }
  if (rawValue.startsWith('"')) {
    if (!rawValue.endsWith('"')) throw new Error(`${label}:${line}: unclosed quoted string`);
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error(`${label}:${line}: invalid quoted string`);
    }
  }
  if (rawValue.startsWith("'")) {
    if (!rawValue.endsWith("'")) throw new Error(`${label}:${line}: unclosed quoted string`);
    return rawValue.slice(1, -1).replaceAll("''", "'");
  }
  return rawValue;
}

function splitInlineList(value, label, line) {
  const parts = [];
  let start = 0;
  let quote;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
    } else if (quote === "'") {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ",") {
      const part = value.slice(start, index).trim();
      if (!part) throw new Error(`${label}:${line}: empty inline list item`);
      parts.push(part);
      start = index + 1;
    }
  }
  if (quote) throw new Error(`${label}:${line}: unclosed quote in inline list`);
  const finalPart = value.slice(start).trim();
  if (!finalPart) throw new Error(`${label}:${line}: empty inline list item`);
  parts.push(finalPart);
  return parts;
}

function stripInlineComment(raw) {
  let quote;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
    } else if (quote === "'") {
      if (character === quote && raw[index + 1] === quote) index += 1;
      else if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/u.test(raw[index - 1]))) {
      return raw.slice(0, index).trimEnd();
    }
  }
  return raw;
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
