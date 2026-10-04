#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { bridge } from "./tools/bridge.js";
import { curveEdit } from "./tools/curve-edit.js";
import { curves } from "./tools/curves.js";
import { exchange } from "./tools/exchange.js";
import { faces } from "./tools/faces.js";
import { instances } from "./tools/instances.js";
import { measure } from "./tools/measure.js";
import { primitives } from "./tools/primitives.js";
import { profiles } from "./tools/profiles.js";
import { projection } from "./tools/projection.js";
import { scene } from "./tools/scene.js";
import { session } from "./tools/session.js";
import { solids } from "./tools/solids.js";
import { surfaces } from "./tools/surfaces.js";
import { transforms } from "./tools/transforms.js";
import { view } from "./tools/view.js";
import { error, type ToolFamily } from "./tools/shared.js";

// Tool families: each file in src/tools/ holds the schemas, definitions and handlers of one.
const families: ToolFamily[] = [
  bridge,
  session,
  primitives,
  scene,
  transforms,
  instances,
  measure,
  solids,
  faces,
  curves,
  curveEdit,
  projection,
  surfaces,
  profiles,
  exchange,
  view,
];

const tools = families.flatMap((family) => family.tools);
const handlers = new Map(families.flatMap((family) => Object.entries(family.handlers)));

// ---------- Server wiring ----------

const server = new Server(
  { name: "plasticity-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  try {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return await handler(rawArgs);
  } catch (err) {
    return error((err as Error).message);
  }
});

// ---------- Boot ----------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[plasticity-mcp] ready (stdio)");
}

main().catch((err) => {
  console.error("[plasticity-mcp] fatal:", err);
  process.exit(1);
});
