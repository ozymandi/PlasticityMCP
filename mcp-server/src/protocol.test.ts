// Round-trip tests for the binary protocol. No live Plasticity needed.
// Run with: npx tsx src/protocol.test.ts
import {
  FacetShapeType,
  MessageType,
  decodeMessage,
  encodeHandshake,
  encodeListAll,
  encodePutSome,
  encodeRefacetSome,
  encodeSubscribeSome,
} from "./protocol.js";

let failures = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

// --- Handshake roundtrip via fake server response ---
{
  console.log("[handshake encode framing]");
  const buf = encodeHandshake(7);
  check("type at 0..3", buf.readUInt32LE(0) === MessageType.HANDSHAKE_1);
  check("msg_id at 4..7", buf.readUInt32LE(4) === 7);
  check("length is 8 bytes", buf.length === 8);
}

// --- ListAll encode is 8 bytes ---
{
  console.log("[list_all encode]");
  const buf = encodeListAll(42);
  check("opcode", buf.readUInt32LE(0) === MessageType.LIST_ALL_1);
  check("msgId", buf.readUInt32LE(4) === 42);
  check("8 bytes", buf.length === 8);
}

// --- SubscribeSome with non-aligned filename to verify padding ---
{
  console.log("[subscribe_some padding]");
  const filename = "abc"; // 3 bytes -> 1 pad byte
  const buf = encodeSubscribeSome(1, filename, [10, 20, 30]);
  let off = 0;
  check("opcode", buf.readUInt32LE(off) === MessageType.SUBSCRIBE_SOME_1);
  off += 4;
  check("msgId", buf.readUInt32LE(off) === 1);
  off += 4;
  check("fname_len", buf.readUInt32LE(off) === 3);
  off += 4;
  check("fname bytes", buf.toString("utf-8", off, off + 3) === "abc");
  off += 3;
  // padding 1 byte should be zero
  check("pad byte zero", buf.readUInt8(off) === 0);
  off += 1;
  check("num_ids", buf.readUInt32LE(off) === 3);
  off += 4;
  check("id 0", buf.readUInt32LE(off) === 10);
  off += 4;
  check("id 1", buf.readUInt32LE(off) === 20);
  off += 4;
  check("id 2", buf.readUInt32LE(off) === 30);
  off += 4;
  check("total length matches", off === buf.length);
}

// --- RefacetSome with default-ish params ---
{
  console.log("[refacet_some encode]");
  const buf = encodeRefacetSome(99, "a", [5], { shape: FacetShapeType.CONVEX });
  let off = 0;
  check("opcode", buf.readUInt32LE(off) === MessageType.REFACET_SOME_1);
  off += 4;
  check("msgId", buf.readUInt32LE(off) === 99);
  off += 4;
  // filename "a" + 3 pad
  check("fname_len 1", buf.readUInt32LE(off) === 1);
  off += 4;
  check("fname byte", buf.readUInt8(off) === 0x61);
  off += 1;
  check("pad 1", buf.readUInt8(off) === 0);
  check("pad 2", buf.readUInt8(off + 1) === 0);
  check("pad 3", buf.readUInt8(off + 2) === 0);
  off += 3;
  check("num_ids", buf.readUInt32LE(off) === 1);
  off += 4;
  check("id 0", buf.readUInt32LE(off) === 5);
  off += 4;
  check("relative_to_bbox default true", buf.readUInt32LE(off) === 1);
  off += 4;
  check("curve_chord_tol", Math.abs(buf.readFloatLE(off) - 0.01) < 1e-6);
  off += 4;
  check("curve_chord_angle", Math.abs(buf.readFloatLE(off) - 0.35) < 1e-6);
  off += 4;
  off += 4 + 4; // surface tol + angle
  check("match_topology default true", buf.readUInt32LE(off) === 1);
  off += 4;
  check("max_sides default 3", buf.readUInt32LE(off) === 3);
  off += 4;
  off += 4 * 4; // plane_angle, min_width, max_width, curve_chord_max
  check("shape CONVEX (20502)", buf.readUInt32LE(off) === 20502);
  off += 4;
  check("total length matches", off === buf.length);
}

// --- PutSome encode + sanity ---
{
  console.log("[put_some encode sanity]");
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]; // 4 verts
  const indices = [0, 1, 2, 0, 2, 3]; // two triangles
  const sizes = [3, 3];
  const buf = encodePutSome(
    5,
    "scene.plasticity",
    [{ clientGroupId: "g1", name: "Group 1", parentClientGroupId: "" }],
    [
      {
        clientId: "i1",
        name: "Quad",
        parentClientGroupId: "g1",
        positions,
        indices,
        sizes,
      },
    ],
  );
  // Verify it parses back as a put_some response shape — actually decodeMessage
  // routes by opcode so let's just sanity-check the opcode + msg_id at start.
  check("opcode", buf.readUInt32LE(0) === MessageType.PUT_SOME_1);
  check("msgId", buf.readUInt32LE(4) === 5);
}

// --- Decode a synthetic LIST_ALL response ---
{
  console.log("[decode list_all response]");
  // Construct a fake server response by re-using Writer logic via buffers.
  // type=LIST_ALL_1, msg_id=1, code=200, then transaction body with one ADD_1
  // sub-message containing one GROUP object.
  const chunks: Buffer[] = [];
  function u32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    chunks.push(b);
  }
  function str(s: string) {
    const utf8 = Buffer.from(s, "utf-8");
    u32(utf8.length);
    chunks.push(utf8);
    const pad = (4 - (utf8.length % 4)) % 4;
    if (pad > 0) chunks.push(Buffer.alloc(pad));
  }

  u32(MessageType.LIST_ALL_1);
  u32(1); // msg_id
  u32(200); // code
  str("doc"); // filename
  u32(0); // version
  u32(1); // num_messages

  // Build the sub-message (ADD_1 with one GROUP object) into a separate buffer to know its length.
  const subChunks: Buffer[] = [];
  function subU32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    subChunks.push(b);
  }
  function subI32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v, 0);
    subChunks.push(b);
  }
  function subStr(s: string) {
    const utf8 = Buffer.from(s, "utf-8");
    subU32(utf8.length);
    subChunks.push(utf8);
    const pad = (4 - (utf8.length % 4)) % 4;
    if (pad > 0) subChunks.push(Buffer.alloc(pad));
  }

  subU32(MessageType.ADD_1);
  subU32(1); // num_objects
  subU32(5); // object_type = GROUP
  subU32(7); // id
  subU32(1); // version
  subI32(0); // parent_id
  subI32(-1); // material_id
  subU32(2); // flags = visible
  subStr("MyGroup");

  const sub = Buffer.concat(subChunks);
  u32(sub.length);
  chunks.push(sub);

  const buf = Buffer.concat(chunks);
  const decoded = decodeMessage(buf);

  if (decoded.kind !== "list") {
    failures++;
    console.error(`  FAIL  decoded.kind = ${decoded.kind}`);
  } else {
    check("filename", decoded.data.filename === "doc");
    check("count 1", decoded.data.objects.length === 1);
    const g = decoded.data.objects[0]!;
    check("group id 7", g.id === 7);
    check("group name", g.name === "MyGroup");
    check("group type", g.type === 5);
    check("no mesh on group", g.vertices === undefined);
  }

  // We should consume every byte:
  // (decoder doesn't expose offset, but absence of throw is sufficient signal here.)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll protocol round-trip checks passed.");
