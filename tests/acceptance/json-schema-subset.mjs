export function validateJsonSchema(value, schema) {
  return validate(value, schema, "$");
}

function validate(value, schema, path) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [`${path}: invalid schema`];
  }

  if (Array.isArray(schema.oneOf)) {
    const alternatives = schema.oneOf.map((alternative) =>
      validate(value, alternative, path),
    );
    const matching = alternatives.filter((failures) => failures.length === 0);
    if (matching.length !== 1) {
      return [`${path}: expected exactly one oneOf alternative`];
    }
  }

  if ("const" in schema && !jsonEqual(value, schema.const)) {
    return [`${path}: value does not match const`];
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => jsonEqual(value, candidate))
  ) {
    return [`${path}: value is not in enum`];
  }
  if (schema.type && !matchesType(value, schema.type)) {
    return [`${path}: expected type ${schema.type}`];
  }

  const failures = [];
  if (schema.type === "object") {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        failures.push(`${path}: missing required property ${required}`);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) {
        failures.push(...validate(item, properties[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        failures.push(`${path}: additional property is not allowed: ${key}`);
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        failures.push(
          ...validate(item, schema.additionalProperties, `${path}.${key}`),
        );
      }
    }
  }

  if (schema.type === "array" && schema.items) {
    value.forEach((item, index) => {
      failures.push(...validate(item, schema.items, `${path}[${index}]`));
    });
  }

  if (schema.type === "string" && schema.pattern) {
    let pattern;
    try {
      pattern = new RegExp(schema.pattern, "u");
    } catch {
      failures.push(`${path}: invalid schema pattern`);
      return failures;
    }
    if (!pattern.test(value)) failures.push(`${path}: string does not match pattern`);
  }

  return failures;
}

function matchesType(value, type) {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
