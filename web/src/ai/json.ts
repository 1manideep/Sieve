// Structured output helpers (10 section 9.3): a small JSON schema check, fence stripping, and partial string reading
// for streamed answers.

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: unknown[];
  nullable?: boolean;
}

function asNode(schema: unknown): SchemaNode {
  return schema && typeof schema === 'object' ? (schema as SchemaNode) : {};
}

/** Supports type, properties, required, items, enum and nullable. Unknown keywords are ignored. */
export function validateJson(schema: object, value: unknown): boolean {
  return check(asNode(schema), value);
}

function check(node: SchemaNode, value: unknown): boolean {
  if (value === null) return node.nullable === true || node.type === undefined;
  if (node.enum && !node.enum.includes(value)) return false;
  switch (node.type) {
    case undefined:
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) return false;
      break;
    case 'array':
      if (!Array.isArray(value)) return false;
      break;
    case 'string':
      if (typeof value !== 'string') return false;
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return false;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return false;
      break;
    default:
      return false;
  }
  if (node.type === 'object' || (node.type === undefined && node.properties)) {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    for (const key of node.required ?? []) if (!(key in obj)) return false;
    for (const [key, sub] of Object.entries(node.properties ?? {})) {
      if (key in obj && obj[key] !== undefined && !check(asNode(sub), obj[key])) return false;
    }
  }
  if (Array.isArray(value) && node.items) {
    const itemNode = asNode(node.items);
    if (!value.every((v) => check(itemNode, v))) return false;
  }
  return true;
}

/** Removes a leading ```json / ``` fence and a trailing fence. */
export function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?[ \t]*\r?\n?/i, '').replace(/\r?\n?```\s*$/, '').trim();
}

/**
 * The decoded prefix of a JSON string value for `key` in possibly incomplete JSON, or '' when the key has not
 * started yet. Complete escapes are decoded; an incomplete escape at the end is dropped.
 */
export function partialJsonString(raw: string, key: string): string {
  const re = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`);
  const m = re.exec(raw);
  if (!m) return '';
  return decodePartial(m[1]);
}

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };

function decodePartial(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = s[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += SIMPLE_ESCAPES[next] ?? next;
    i += 1;
  }
  return out;
}
