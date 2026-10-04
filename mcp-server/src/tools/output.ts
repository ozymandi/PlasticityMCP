/**
 * How results are printed for the client. A model reads every character, so: fields at their
 * usual value are left out, and whatever fits on one line stays on one line. The text is
 * still plain JSON.
 */

// Wide enough for one body, edge or region per line.
const LINE_WIDTH = 200;

// What almost every body and group has; a field at this value is left out.
const USUAL: Record<string, unknown> = {
  visible: true,
  locked: false,
  selected: false,
  materialId: null,
  name: null,
};

type Json = Record<string, unknown>;

const isBody = (r: Json) => "id" in r && "type" in r && "boundsMm" in r;
const isGroup = (r: Json) => "parentId" in r && "bodyIds" in r;

/** Drop the fields of bodies and groups that carry no news. */
export function slim(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slim);
  if (value === null || typeof value !== "object") return value;
  const record = value as Json;
  const body = isBody(record);
  const group = isGroup(record);
  const result: Json = {};
  for (const [key, item] of Object.entries(record)) {
    if ((body || group) && key in USUAL && item === USUAL[key]) continue;
    // A curve has no faces or edges.
    if (body && record.type === "Wire" && (key === "faceCount" || key === "edgeCount") && item === 0) continue;
    // Member lists of a group: only the kinds it has. `bodyIds` stays, also when empty.
    if (group && key !== "bodyIds" && Array.isArray(item) && item.length === 0) continue;
    result[key] = slim(item);
  }
  return result;
}

function flat(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(flat).join(", ")}]`;
  const fields = Object.entries(value as Json).filter(([, item]) => item !== undefined);
  return `{${fields.map(([key, item]) => `${JSON.stringify(key)}: ${flat(item)}`).join(", ")}}`;
}

function print(value: unknown, indent: string): string {
  const line = flat(value);
  if (value === null || typeof value !== "object" || indent.length + line.length <= LINE_WIDTH) return line;
  const inner = `${indent} `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => inner + print(item, inner)).join(",\n")}\n${indent}]`;
  }
  const fields = Object.entries(value as Json).filter(([, item]) => item !== undefined);
  const lines = fields.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${print(item, inner)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** The text of a tool result. */
export function formatResult(data: unknown): string {
  return print(slim(data), "");
}
