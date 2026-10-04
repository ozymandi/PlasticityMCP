import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolFamily, ToolHandler } from "./shared.js";

/**
 * What the client is shown. The full catalog lists every tool. The compact one — for models
 * with a small context — lists a few and adds two: one finds the rest, one calls them.
 */

export type CatalogMode = "full" | "compact";

/** Listed directly in the compact catalog. */
export const CORE_TOOLS = [
  "modelling_guide",
  "native_launch",
  "native_connect",
  "native_status",
  "undo",
  "list_bodies",
  "get_body_topology",
  "list_regions",
  "check_bodies",
  "create_box",
  "create_cylinder",
  "create_polyline",
  "create_circle",
  "extrude_profile",
  "revolve_profile",
  "boolean",
  "fillet",
  "chamfer",
  "move_bodies",
  "delete_bodies",
  "set_view",
  "screenshot",
  "save_document",
  "export_step",
];

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

const FindToolsArgs = z
  .object({
    query: z.string().min(1).optional(),
    family: z.string().min(1).optional(),
    names: z.array(z.string().min(1)).min(1).optional(),
    limit: z.number().int().positive().max(MAX_LIMIT).optional().default(DEFAULT_LIMIT),
  })
  .refine((a) => a.query !== undefined || a.family !== undefined || a.names !== undefined, "pass query, family or names");

const CallToolArgs = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).optional().default({}),
});

/** `--catalog=compact` among the start arguments; the full catalog without it. */
export function catalogMode(argv: string[]): CatalogMode {
  const arg = argv.find((a) => a.startsWith("--catalog="));
  if (arg === undefined) return "full";
  const mode = arg.slice("--catalog=".length);
  if (mode !== "full" && mode !== "compact") throw new Error(`Unknown catalog "${mode}": use full or compact`);
  return mode;
}

export function fullCatalog(families: Record<string, ToolFamily>): ToolFamily {
  const all = Object.values(families);
  return {
    tools: all.flatMap((family) => family.tools),
    handlers: Object.fromEntries(all.flatMap((family) => Object.entries(family.handlers))),
  };
}

/** Words of a text reduced to a common form: lower case, plurals folded, short ones dropped. */
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .map((word) => (word.endsWith("ies") ? word.slice(0, -3) + "y" : word.endsWith("s") ? word.slice(0, -1) : word));

/**
 * Search over the tools: a query word counts most in a tool's name, then in the first sentence
 * of its description, then in the rest — and the more, the fewer tools have the word at all,
 * so "mirror" outweighs "body".
 */
function searcher(tools: Tool[]) {
  const entries = tools.map((tool) => {
    const description = tool.description ?? "";
    return {
      tool,
      name: new Set(words(tool.name)),
      lead: new Set(words(description.split(". ")[0])),
      rest: new Set(words(description)),
    };
  });
  const rarity = (word: string) => {
    const having = entries.filter((e) => e.name.has(word) || e.rest.has(word)).length;
    return having === 0 ? 0 : Math.log(1 + entries.length / having);
  };
  return (query: string, among: (tool: Tool) => boolean): Tool[] => {
    const weighted = [...new Set(words(query))].map((word) => ({ word, weight: rarity(word) }));
    return entries
      .filter((e) => among(e.tool))
      .map((e) => ({
        tool: e.tool,
        score: weighted.reduce(
          (sum, { word, weight }) => sum + weight * (e.name.has(word) ? 3 : e.lead.has(word) ? 2 : e.rest.has(word) ? 1 : 0),
          0,
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((x, y) => y.score - x.score)
      .map((entry) => entry.tool);
  };
}

export function compactCatalog(families: Record<string, ToolFamily>): ToolFamily {
  const full = fullCatalog(families);
  const byName = new Map(full.tools.map((tool) => [tool.name, tool]));
  const familyOf = new Map(
    Object.entries(families).flatMap(([family, { tools }]) => tools.map((tool) => [tool.name, family] as const)),
  );
  const search = searcher(full.tools);
  const missing = CORE_TOOLS.filter((name) => !byName.has(name));
  if (missing.length > 0) throw new Error(`Core tools not in the catalog: ${missing.join(", ")}`);

  const index = Object.entries(families)
    .map(([family, { tools }]) => `${family}: ${tools.map((tool) => tool.name).join(", ")}`)
    .join("; ");

  const tools: Tool[] = [
    ...CORE_TOOLS.map((name) => byName.get(name)!),
    {
      name: "find_tools",
      description:
        "This server has more tools than are listed: the rest are found here and run with " +
        "call_tool. Returns the full definition (description and input schema) of the tools " +
        "named in `names`, or of the best matches for the words of `query`, optionally within " +
        "one `family`; `family` alone lists that family. At most `limit` definitions (default " +
        `${DEFAULT_LIMIT}); \`total\` says how many matched. All tools by family — ${index}.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words to look for, e.g. \"mirror copy\"" },
          family: { type: "string", enum: Object.keys(families) },
          names: { type: "array", items: { type: "string" }, minItems: 1, description: "Exact tool names" },
          limit: { type: "number", default: DEFAULT_LIMIT, maximum: MAX_LIMIT },
        },
      },
    },
    {
      name: "call_tool",
      description:
        "Run any tool of this server by `name` with its `arguments` — the way to use the tools " +
        "that are not listed. Take the argument names from find_tools first. Same checks and " +
        "same result as a direct call.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          arguments: { type: "object", description: "The tool's own arguments" },
        },
      },
    },
  ];

  const findTools: ToolHandler = async (rawArgs) => {
    const args = FindToolsArgs.parse(rawArgs ?? {});
    if (args.family !== undefined && !(args.family in families)) {
      throw new Error(`Unknown family "${args.family}": ${Object.keys(families).join(", ")}`);
    }
    let found: Tool[];
    if (args.names !== undefined) {
      const unknown = args.names.filter((name) => !byName.has(name));
      if (unknown.length > 0) throw new Error(`Unknown tool: ${unknown.join(", ")}`);
      found = args.names.map((name) => byName.get(name)!);
    } else {
      const inFamily = (tool: Tool) => args.family === undefined || familyOf.get(tool.name) === args.family;
      found = args.query === undefined ? full.tools.filter(inFamily) : search(args.query, inFamily);
    }
    // One definition per line: a pretty-printed schema would cost several times the text.
    const lines = found
      .slice(0, args.limit)
      .map(({ name, description, inputSchema }) => " " + JSON.stringify({ name, description, inputSchema }));
    const text = `{"count": ${lines.length}, "total": ${found.length}, "tools": [\n${lines.join(",\n")}\n]}`;
    return { content: [{ type: "text", text }] };
  };

  const callTool: ToolHandler = async (rawArgs) => {
    const args = CallToolArgs.parse(rawArgs ?? {});
    const handler = full.handlers[args.name];
    if (!handler) throw new Error(`Unknown tool: ${args.name}; look it up with find_tools`);
    return handler(args.arguments);
  };

  return { tools, handlers: { ...full.handlers, find_tools: findTools, call_tool: callTool } };
}
