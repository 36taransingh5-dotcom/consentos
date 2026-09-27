/**
 * Deterministic JSON serialisation (RFC 8785 / JCS style).
 *
 * Two payloads that mean the same thing always serialise to the same bytes:
 * object keys are sorted by UTF-16 code unit, there is no whitespace, and
 * numbers use the ECMAScript shortest round-trip form. This is what gets
 * hashed and signed, so anything ambiguous is rejected instead of guessed:
 * non-finite numbers, bigints, functions, symbols, `undefined` inside arrays,
 * and objects that are not plain JSON objects (Dates, Maps, class instances).
 *
 * `undefined` object properties are omitted, matching JSON.stringify.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError(`Cannot canonicalize non-finite number ${value}`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalizationError(`Cannot canonicalize a value of type ${typeof value}`);
  }

  const obj = value as object;
  if (seen.has(obj)) throw new CanonicalizationError("Cannot canonicalize a circular structure");
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj
        .map((item) => {
          if (item === undefined) throw new CanonicalizationError("Cannot canonicalize undefined inside an array");
          return serialize(item, seen);
        })
        .join(",")}]`;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalizationError("Only plain objects can be canonicalized");
    }
    const record = obj as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const member = record[key];
      if (member === undefined) continue;
      members.push(`${JSON.stringify(key)}:${serialize(member, seen)}`);
    }
    return `{${members.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

export class CanonicalizationError extends Error {
  override name = "CanonicalizationError";
}
