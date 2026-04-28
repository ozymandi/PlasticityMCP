// Smoke test against a LIVE Plasticity instance.
// Usage: npx tsx src/smoke.ts            (uses localhost:8980)
//        PLASTICITY_SERVER=host:port npx tsx src/smoke.ts
//
// Verifies: connect, handshake, list_scene. Prints supported opcodes and a
// summary of the scene.
import { PlasticityClient } from "./client.js";
import { MessageType, ObjectType } from "./protocol.js";

const server = process.env.PLASTICITY_SERVER ?? "localhost:8980";
const client = new PlasticityClient({ server });

async function main() {
  console.log(`[smoke] connecting to ws://${server} ...`);
  await client.connect();
  console.log("[smoke] connected + handshake OK");

  const supported: string[] = [];
  for (const v of Object.values(MessageType)) {
    if (typeof v === "number" && client.supports(v)) {
      supported.push(MessageType[v as MessageType] as string);
    }
  }
  console.log(`[smoke] server advertises ${supported.length} opcodes:`);
  console.log("        " + supported.join(", "));

  console.log("[smoke] list_all ...");
  const objs = await client.listAll();
  console.log(`[smoke] received ${objs.length} objects`);
  console.log(`[smoke] filename=${client.getFilename()}  version=${client.getVersion()}`);

  const counts: Record<string, number> = {};
  for (const o of objs) {
    const t = ObjectType[o.type] ?? `UNKNOWN(${o.type})`;
    counts[t] = (counts[t] ?? 0) + 1;
  }
  console.log(`[smoke] by type:`, counts);

  for (const o of objs.slice(0, 10)) {
    const t = ObjectType[o.type] ?? `UNKNOWN(${o.type})`;
    const meshInfo =
      o.vertices && o.faces ? ` verts=${o.vertices.length / 3} tris=${o.faces.length / 3}` : "";
    console.log(`  [${o.id}] ${t.padEnd(6)} parent=${String(o.parentId).padStart(4)}  ${o.name}${meshInfo}`);
  }
  if (objs.length > 10) console.log(`  ... (+${objs.length - 10} more)`);

  await client.disconnect();
  console.log("[smoke] done");
}

main().catch((err) => {
  console.error(`[smoke] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
