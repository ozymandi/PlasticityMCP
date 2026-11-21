// Export the four example models as OBJ through the MCP server (native channel).
// usage: node export_meshes.mjs [nes tt cam bike]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync } from "node:fs";

const REPO = "E:/Projects/PlasticityMCP";
const OUT = `${REPO}/promo/assets/mesh`;
const FILES = {
  nes: `${REPO}/examples/nintendo-nes/nes.plasticity`,
  tt: `${REPO}/examples/technics-sl1200/technics-sl1200.plasticity`,
  cam: `${REPO}/examples/nikon-f2/nikon-f2-with-el-nikkor.plasticity`,
  bike: `${REPO}/examples/mountain-bike/mtb_final.plasticity`,
};
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FILES);

const transport = new StdioClientTransport({ command: "node", args: [`${REPO}/mcp-server/dist/index.js`], cwd: `${REPO}/mcp-server` });
const client = new Client({ name: "promo-export", version: "0.1" });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content || []).map((c) => c.text || "").join("\n");
  if (r.isError) throw new Error(`${name}: ${text}`);
  return text;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let st = await call("native_status");
console.log("status:", st.slice(0, 200));
if (!/"connected":\s*true/.test(st)) {
  try { console.log("launch:", (await call("native_launch")).slice(0, 300)); } catch (e) { console.log("launch:", e.message.slice(0, 300)); }
  for (let i = 0; i < 20; i++) {
    try { console.log("connect:", (await call("native_connect")).slice(0, 200)); break; } catch (e) { await sleep(3000); }
  }
}
for (const k of only) {
  console.log("== open", k);
  console.log((await call("open_document", { path: FILES[k] })).slice(0, 200));
  await sleep(4000);
  const bodies = await call("list_bodies");
  console.log("bodies:", bodies.slice(0, 160).replace(/\n/g, " "));
  const out = `${OUT}/${k}.obj`;
  const r = await call("export_mesh", { path: out, tolerance: 0.02, angle: 8, overwrite: true });
  console.log("export:", r.slice(0, 200));
}
await client.close();
process.exit(0);
