// Checks of the tool catalogs. No live Plasticity needed.
// Run with: npx tsx src/catalog.test.ts
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { catalogMode, compactCatalog, CORE_TOOLS, fullCatalog } from "./tools/catalog.js";
import { guide, SERVER_INSTRUCTIONS } from "./tools/guide.js";
import { scene } from "./tools/scene.js";
import type { ToolFamily } from "./tools/shared.js";
import { solids } from "./tools/solids.js";
import { transforms } from "./tools/transforms.js";

let failures = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const tool = (name: string, description: string): Tool => ({ name, description, inputSchema: { type: "object" } });
const called: unknown[] = [];

// Stand-ins for the core tools, plus three real families to search in.
const core: ToolFamily = {
  tools: CORE_TOOLS.filter((name) => ![solids, scene, transforms].some((f) => name in f.handlers)).map((name) =>
    tool(name, `Stand-in for ${name}.`),
  ),
  handlers: {},
};
const extra: ToolFamily = {
  tools: [tool("echo", "Return the arguments. Used by the test.")],
  handlers: {
    echo: async (rawArgs) => {
      called.push(rawArgs);
      return { content: [{ type: "text", text: JSON.stringify(rawArgs) }] };
    },
  },
};
const families = { core, solids, scene, transforms, extra };

const text = async (run: Promise<{ content: Array<{ type: string; text?: string }> }>) => (await run).content[0].text ?? "";
const fails = async (run: () => Promise<unknown>, part: string) => {
  try {
    await run();
    return false;
  } catch (err) {
    return (err as Error).message.includes(part);
  }
};

{
  console.log("[catalog mode]");
  check("full without the argument", catalogMode(["node", "index.js"]) === "full");
  check("compact on request", catalogMode(["node", "index.js", "--catalog=compact"]) === "compact");
  let refused = false;
  try {
    catalogMode(["--catalog=tiny"]);
  } catch {
    refused = true;
  }
  check("unknown mode refused", refused);
}

{
  console.log("[full catalog]");
  const full = fullCatalog(families);
  const count = Object.values(families).reduce((n, f) => n + f.tools.length, 0);
  check("every tool listed", full.tools.length === count);
  check("no find_tools / call_tool", !full.tools.some((t) => t.name === "find_tools" || t.name === "call_tool"));
}

{
  console.log("[compact catalog]");
  const full = fullCatalog(families);
  const compact = compactCatalog(families);
  const names = compact.tools.map((t) => t.name);
  check("core tools plus two", names.length === CORE_TOOLS.length + 2, String(names.length));
  check("core tools listed in order", CORE_TOOLS.every((name, i) => names[i] === name));
  check("a tool outside the core is not listed", !names.includes("mirror_bodies") && !names.includes("echo"));
  check(
    "a listed core tool is the full definition",
    compact.tools.find((t) => t.name === "boolean") === full.tools.find((t) => t.name === "boolean"),
  );
  const find = compact.tools.find((t) => t.name === "find_tools")!;
  check(
    "find_tools names every tool",
    full.tools.every((t) => (find.description ?? "").includes(t.name)),
  );

  console.log("[find_tools]");
  const byQuery = JSON.parse(await text(compact.handlers.find_tools({ query: "mirror a body" })));
  check("query: best match first", byQuery.tools[0]?.name === "mirror_bodies", byQuery.tools.map((t: Tool) => t.name).join(", "));
  check("query: definitions carry the schema", byQuery.tools[0]?.inputSchema?.type === "object");
  check("query: limit by default", byQuery.count <= 5 && byQuery.total >= byQuery.count);
  const byNames = JSON.parse(await text(compact.handlers.find_tools({ names: ["hollow", "echo"] })));
  check("names: in the asked order", byNames.tools.map((t: Tool) => t.name).join() === "hollow,echo");
  const byFamily = JSON.parse(await text(compact.handlers.find_tools({ family: "transforms", limit: 20 })));
  check("family: all of it", byFamily.total === transforms.tools.length && byFamily.count === transforms.tools.length);
  const both = JSON.parse(await text(compact.handlers.find_tools({ family: "scene", query: "material" })));
  check("family and query together", both.count > 0 && both.tools.every((t: Tool) => t.name in scene.handlers));
  const none = JSON.parse(await text(compact.handlers.find_tools({ query: "zzzz" })));
  check("no match: empty, not an error", none.count === 0 && none.total === 0);
  const raw = await text(compact.handlers.find_tools({ names: ["hollow"] }));
  check("one definition per line", raw.split("\n").length === 3);
  check("unknown name refused", await fails(() => compact.handlers.find_tools({ names: ["nope"] }), "Unknown tool: nope"));
  check("unknown family refused", await fails(() => compact.handlers.find_tools({ family: "nope" }), "Unknown family"));
  check("nothing asked refused", await fails(() => compact.handlers.find_tools({}), "query, family or names"));

  console.log("[call_tool]");
  const reply = await text(compact.handlers.call_tool({ name: "echo", arguments: { a: 1 } }));
  check("runs the tool with its arguments", reply === '{"a":1}' && JSON.stringify(called) === '[{"a":1}]');
  check("unknown tool refused", await fails(() => compact.handlers.call_tool({ name: "nope" }), "find_tools"));
  check(
    "the tool's own checks apply",
    await fails(() => compact.handlers.call_tool({ name: "mirror_bodies", arguments: {} }), ""),
  );
  check("cannot call itself", await fails(() => compact.handlers.call_tool({ name: "call_tool", arguments: {} }), "Unknown tool"));
}

{
  console.log("[modelling guide]");
  const rules = await text(guide.handlers.modelling_guide({}));
  check("the rules name the four stages", ["Blocking", "Refining", "Merge", "Fine detail"].every((s) => rules.includes(s)));
  check("the rules are short", rules.length < 3000, String(rules.length));
  const topics = ["drawing", "blocking", "edges", "merge", "detail"];
  check("the rules name every topic", topics.every((t) => rules.includes(`"${t}"`)));
  const texts = await Promise.all(topics.map((topic) => text(guide.handlers.modelling_guide({ topic }))));
  check("each topic has its own text", new Set(texts).size === topics.length && texts.every((t) => t.length > 300));
  check("unknown topic refused", await fails(() => guide.handlers.modelling_guide({ topic: "nope" }), "topic"));
  check("the guide is the first core tool", CORE_TOOLS[0] === "modelling_guide");
  check("the server instructions point at the guide", SERVER_INSTRUCTIONS.includes("modelling_guide"));
  // Every tool the guide names has to exist, or the guide sends a model looking for nothing.
  const { readdirSync } = await import("node:fs");
  const known = new Set<string>(["find_tools", "call_tool"]);
  for (const file of readdirSync(new URL("./tools/", import.meta.url))) {
    if (file === "shared.ts" || file === "output.ts" || file === "catalog.ts") continue;
    const mod = (await import(`./tools/${file.replace(/\.ts$/, ".js")}`)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      const family = value as Partial<ToolFamily>;
      if (family && typeof family === "object" && Array.isArray(family.tools)) family.tools.forEach((t) => known.add(t.name));
    }
  }
  const named = new Set([rules, ...texts].join(" ").match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
  const unknown = [...named].filter((name) => !known.has(name));
  check("every tool named in the guide exists", unknown.length === 0, unknown.join(", "));
}

{
  console.log("[rules with native_connect]");
  const session: ToolFamily = {
    tools: [tool("native_connect", "Stand-in.")],
    handlers: { native_connect: async () => ({ content: [{ type: "text", text: '{"connected": true}' }] }) },
  };
  const withGuide = { guide, session, core: { tools: core.tools.filter((t) => !["modelling_guide", "native_connect"].includes(t.name)), handlers: {} }, solids, scene, transforms };
  const rulesText = await text(guide.handlers.modelling_guide({}));

  const skipping = compactCatalog(withGuide);
  const first = await text(skipping.handlers.native_connect({}));
  check("a model that skipped the guide gets the rules with native_connect", first.startsWith('{"connected": true}') && first.endsWith(rulesText));
  check("only once", (await text(skipping.handlers.native_connect({}))) === '{"connected": true}');

  const reading = compactCatalog(withGuide);
  await reading.handlers.modelling_guide({});
  check("a model that read the guide gets a plain answer", (await text(reading.handlers.native_connect({}))) === '{"connected": true}');

  const viaCall = compactCatalog(withGuide);
  check("the same through call_tool", (await text(viaCall.handlers.call_tool({ name: "native_connect" }))).endsWith(rulesText));

  const failing = compactCatalog({ ...withGuide, session: { tools: session.tools, handlers: { native_connect: async () => ({ isError: true, content: [{ type: "text", text: "Error: no window" }] }) } } });
  check("a failed connection carries no rules", (await text(failing.handlers.native_connect({}))) === "Error: no window");

  check("the full catalog leaves native_connect as it is", fullCatalog(withGuide).handlers.native_connect === session.handlers.native_connect);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll catalog checks passed.");
