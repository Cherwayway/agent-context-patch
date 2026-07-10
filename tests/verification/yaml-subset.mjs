export function parseYamlSubset(source, label = "YAML") {
  const lines = source
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .map((raw, index) => {
      if (/^\s*\t/u.test(raw)) {
        throw new Error(`${label}:${index + 1}: tabs are not supported for indentation`);
      }
      const content = raw.trim();
      return {
        line: index + 1,
        indent: raw.length - raw.trimStart().length,
        content,
      };
    })
    .filter(({ content }) => content !== "" && !content.startsWith("#"));

  if (lines.length === 0) return {};
  if (lines[0].indent !== 0) {
    throw new Error(`${label}:${lines[0].line}: the document must start at indentation zero`);
  }

  const [value, nextIndex] = parseBlock(lines, 0, 0, label);
  if (nextIndex !== lines.length) {
    throw new Error(`${label}:${lines[nextIndex].line}: unexpected indentation`);
  }
  return value;
}

export function parseMarkdownFrontmatter(source, label = "Markdown") {
  const normalized = source.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error(`${label}: missing opening frontmatter delimiter`);
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`${label}: missing closing frontmatter delimiter`);
  }
  return {
    data: parseYamlSubset(normalized.slice(4, end), `${label} frontmatter`),
    body: normalized.slice(end + 5),
  };
}

function parseBlock(lines, startIndex, indent, label) {
  const isSequence = lines[startIndex].content.startsWith("- ") || lines[startIndex].content === "-";
  return isSequence
    ? parseSequence(lines, startIndex, indent, label)
    : parseMapping(lines, startIndex, indent, label);
}

function parseSequence(lines, startIndex, indent, label) {
  const values = [];
  let index = startIndex;

  while (index < lines.length && lines[index].indent === indent) {
    const { content, line } = lines[index];
    if (!(content.startsWith("- ") || content === "-")) break;
    const rawValue = content.slice(1).trim();
    if (rawValue !== "") {
      values.push(parseScalar(rawValue, label, line));
      index += 1;
      continue;
    }

    const child = lines[index + 1];
    if (!child || child.indent <= indent) {
      throw new Error(`${label}:${line}: empty sequence item`);
    }
    const [value, nextIndex] = parseBlock(lines, index + 1, child.indent, label);
    values.push(value);
    index = nextIndex;
  }

  return [values, index];
}

function parseMapping(lines, startIndex, indent, label) {
  const value = {};
  let index = startIndex;

  while (index < lines.length && lines[index].indent === indent) {
    const { content, line } = lines[index];
    const match = content.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/u);
    if (!match) break;
    const [, key, rawValue = ""] = match;
    if (Object.hasOwn(value, key)) {
      throw new Error(`${label}:${line}: duplicate key ${key}`);
    }

    if (rawValue !== "") {
      value[key] = parseScalar(rawValue, label, line);
      index += 1;
      continue;
    }

    const child = lines[index + 1];
    if (!child || child.indent <= indent) {
      value[key] = {};
      index += 1;
      continue;
    }
    const [childValue, nextIndex] = parseBlock(lines, index + 1, child.indent, label);
    value[key] = childValue;
    index = nextIndex;
  }

  return [value, index];
}

function parseScalar(rawValue, label, line) {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "null" || rawValue === "~") return null;
  if (/^-?(?:0|[1-9][0-9]*)$/u.test(rawValue)) return Number(rawValue);
  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    const inner = rawValue.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((part) => parseScalar(part.trim(), label, line));
  }
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error(`${label}:${line}: invalid quoted string`);
    }
  }
  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1).replaceAll("''", "'");
  }
  return rawValue;
}
