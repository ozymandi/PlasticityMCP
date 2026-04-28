// Plasticity WebSocket binary protocol — see docs/ws-protocol.md
// All multi-byte ints are little-endian. Strings are UTF-8 with 4-byte zero padding.

export enum MessageType {
  TRANSACTION_1 = 0,
  ADD_1 = 1,
  UPDATE_1 = 2,
  DELETE_1 = 3,
  MOVE_1 = 4,
  ATTRIBUTE_1 = 5,

  NEW_VERSION_1 = 10,
  NEW_FILE_1 = 11,

  LIST_ALL_1 = 20,
  LIST_SOME_1 = 21,
  LIST_VISIBLE_1 = 22,
  SUBSCRIBE_ALL_1 = 23,
  SUBSCRIBE_SOME_1 = 24,
  UNSUBSCRIBE_ALL_1 = 25,
  REFACET_SOME_1 = 26,

  PUT_SOME_1 = 31,

  HANDSHAKE_1 = 100,
}

export enum ObjectType {
  SOLID = 0,
  SHEET = 1,
  WIRE = 2,
  GROUP = 5,
  EMPTY = 6,
}

export enum FacetShapeType {
  ANY = 20500,
  CUT = 20501,
  CONVEX = 20502,
}

export const PUT_KIND_MESH = 0;
export const PUT_KIND_SUBD = 1;

export interface RefacetParams {
  relativeToBbox?: boolean;
  curveChordTolerance?: number;
  curveChordAngle?: number;
  surfacePlaneTolerance?: number;
  surfacePlaneAngle?: number;
  matchTopology?: boolean;
  maxSides?: number;
  planeAngle?: number;
  minWidth?: number;
  maxWidth?: number;
  curveChordMax?: number;
  shape?: FacetShapeType;
}

const REFACET_DEFAULTS: Required<RefacetParams> = {
  relativeToBbox: true,
  curveChordTolerance: 0.01,
  curveChordAngle: 0.35,
  surfacePlaneTolerance: 0.01,
  surfacePlaneAngle: 0.35,
  matchTopology: true,
  maxSides: 3,
  planeAngle: 0,
  minWidth: 0,
  maxWidth: 0,
  curveChordMax: 0,
  shape: FacetShapeType.CUT,
};

// ------------------------- Writer -------------------------

class Writer {
  private chunks: Buffer[] = [];

  u32(v: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.chunks.push(b);
    return this;
  }

  i32(v: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v | 0, 0);
    this.chunks.push(b);
    return this;
  }

  u64(v: bigint | number): this {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(typeof v === "bigint" ? v : BigInt(v), 0);
    this.chunks.push(b);
    return this;
  }

  f32(v: number): this {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v, 0);
    this.chunks.push(b);
    return this;
  }

  // Length-prefixed UTF-8 string with 4-byte zero padding.
  str(s: string): this {
    const utf8 = Buffer.from(s, "utf-8");
    this.u32(utf8.length);
    this.chunks.push(utf8);
    const pad = (4 - (utf8.length % 4)) % 4;
    if (pad > 0) this.chunks.push(Buffer.alloc(pad));
    return this;
  }

  f32Array(values: ArrayLike<number>): this {
    const b = Buffer.alloc(values.length * 4);
    for (let i = 0; i < values.length; i++) b.writeFloatLE(values[i]!, i * 4);
    this.chunks.push(b);
    return this;
  }

  u32Array(values: ArrayLike<number>): this {
    const b = Buffer.alloc(values.length * 4);
    for (let i = 0; i < values.length; i++) b.writeUInt32LE(values[i]! >>> 0, i * 4);
    this.chunks.push(b);
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

// ------------------------- Reader -------------------------

class Reader {
  offset = 0;
  constructor(public buf: Buffer) {}

  u32(): number {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  i32(): number {
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  f32(): number {
    const v = this.buf.readFloatLE(this.offset);
    this.offset += 4;
    return v;
  }

  str(): string {
    const len = this.u32();
    const s = this.buf.toString("utf-8", this.offset, this.offset + len);
    this.offset += len;
    const pad = (4 - (len % 4)) % 4;
    this.offset += pad;
    return s;
  }

  bytes(n: number): Buffer {
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  f32Array(count: number): Float32Array {
    // Slice and copy because the underlying buffer may be reused / unaligned.
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.buf.readFloatLE(this.offset + i * 4);
    this.offset += count * 4;
    return out;
  }

  i32Array(count: number): Int32Array {
    const out = new Int32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.buf.readInt32LE(this.offset + i * 4);
    this.offset += count * 4;
    return out;
  }

  u32Array(count: number): Uint32Array {
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.buf.readUInt32LE(this.offset + i * 4);
    this.offset += count * 4;
    return out;
  }
}

// ------------------------- Encoders (client → server) -------------------------

export function encodeHandshake(msgId: number): Buffer {
  return new Writer().u32(MessageType.HANDSHAKE_1).u32(msgId).build();
}

export function encodeListAll(msgId: number): Buffer {
  return new Writer().u32(MessageType.LIST_ALL_1).u32(msgId).build();
}

export function encodeListVisible(msgId: number): Buffer {
  return new Writer().u32(MessageType.LIST_VISIBLE_1).u32(msgId).build();
}

export function encodeSubscribeAll(msgId: number): Buffer {
  return new Writer().u32(MessageType.SUBSCRIBE_ALL_1).u32(msgId).build();
}

export function encodeUnsubscribeAll(msgId: number): Buffer {
  return new Writer().u32(MessageType.UNSUBSCRIBE_ALL_1).u32(msgId).build();
}

export function encodeSubscribeSome(msgId: number, filename: string, ids: number[]): Buffer {
  const w = new Writer().u32(MessageType.SUBSCRIBE_SOME_1).u32(msgId).str(filename).u32(ids.length);
  for (const id of ids) w.u32(id);
  return w.build();
}

export function encodeRefacetSome(
  msgId: number,
  filename: string,
  ids: number[],
  params: RefacetParams = {},
): Buffer {
  const p = { ...REFACET_DEFAULTS, ...params };
  const w = new Writer().u32(MessageType.REFACET_SOME_1).u32(msgId).str(filename).u32(ids.length);
  for (const id of ids) w.u32(id);
  return w
    .u32(p.relativeToBbox ? 1 : 0)
    .f32(p.curveChordTolerance)
    .f32(p.curveChordAngle)
    .f32(p.surfacePlaneTolerance)
    .f32(p.surfacePlaneAngle)
    .u32(p.matchTopology ? 1 : 0)
    .u32(p.maxSides)
    .f32(p.planeAngle)
    .f32(p.minWidth)
    .f32(p.maxWidth)
    .f32(p.curveChordMax)
    .u32(p.shape)
    .build();
}

export interface PutGroup {
  clientGroupId: string;
  name: string;
  parentClientGroupId: string;
  existingGroupId?: number;
}

export interface PutItem {
  clientId: string;
  name: string;
  parentClientGroupId: string;
  existingStableId?: number;
  options?: bigint | number;
  positions: ArrayLike<number>; // flat xyz, length = vertexCount * 3
  indices: ArrayLike<number>; // flat loop indices
  sizes: ArrayLike<number>; // verts-per-face
}

export function encodePutSome(
  msgId: number,
  filename: string,
  groups: PutGroup[],
  items: PutItem[],
): Buffer {
  const w = new Writer().u32(MessageType.PUT_SOME_1).u32(msgId).str(filename);

  w.u32(groups.length);
  for (const g of groups) {
    w.str(g.clientGroupId);
    w.str(g.name);
    w.str(g.parentClientGroupId);
    w.u32(g.existingGroupId ?? 0);
  }

  w.u32(items.length);
  for (const it of items) {
    w.str(it.clientId);
    w.str(it.name);
    w.str(it.parentClientGroupId);
    w.u32(it.existingStableId ?? 0);
    w.u64(it.options ?? PUT_KIND_MESH);

    if (it.positions.length % 3 !== 0) {
      throw new Error(`positions length ${it.positions.length} is not a multiple of 3`);
    }
    const vertexCount = it.positions.length / 3;
    w.u32(vertexCount);
    w.f32Array(it.positions);

    const faceCount = it.sizes.length;
    const indexCount = it.indices.length;
    let expectedIndices = 0;
    for (let i = 0; i < faceCount; i++) expectedIndices += it.sizes[i]!;
    if (expectedIndices !== indexCount) {
      throw new Error(
        `sizes sum ${expectedIndices} does not match indices length ${indexCount}`,
      );
    }
    w.u32(faceCount);
    w.u32(indexCount);
    w.u32Array(it.indices);
    w.u32Array(it.sizes);
  }

  return w.build();
}

// ------------------------- Decoders (server → client) -------------------------

export interface PlasticityObject {
  type: ObjectType;
  id: number;
  version: number;
  parentId: number;
  materialId: number;
  flags: number;
  name: string;
  // Mesh payload — only present for SOLID/SHEET. Stored as flat typed arrays.
  vertices?: Float32Array; // length = vertexCount * 3
  faces?: Int32Array; // length = triCount * 3
  normals?: Float32Array; // length = loopCount * 3
  groups?: Int32Array; // packed (start, count) pairs
  faceIds?: Int32Array; // one per group
}

export interface Transaction {
  filename: string;
  version: number;
  delete: number[];
  add: PlasticityObject[];
  update: PlasticityObject[];
}

export interface ListResponse {
  msgId: number;
  code: number;
  filename: string;
  version: number;
  objects: PlasticityObject[];
}

export interface RefacetResponseItem {
  plasticityId: number;
  version: number;
  faces: Int32Array;
  positions: Float32Array;
  indices: Int32Array;
  normals: Float32Array;
  groups: number[];
  faceIds: number[];
}

export interface RefacetResponse {
  msgId: number;
  code: number;
  filename: string;
  fileVersion: number;
  items: RefacetResponseItem[];
}

export interface PutSomeResponse {
  msgId: number;
  code: number;
  groups: { clientGroupId: string; groupId: number }[];
  items: { clientId: string; stableId: number; versionId: number }[];
}

export interface HandshakeResponse {
  msgId: number;
  supportedOpcodes: Set<number>;
}

export type DecodedMessage =
  | { kind: "transaction"; data: Transaction }
  | { kind: "list"; data: ListResponse }
  | { kind: "refacet"; data: RefacetResponse }
  | { kind: "putSome"; data: PutSomeResponse }
  | { kind: "handshake"; data: HandshakeResponse }
  | { kind: "newVersion"; filename: string; version: number }
  | { kind: "newFile"; filename: string }
  | { kind: "unknown"; opcode: number };

function decodeObjectRecord(r: Reader): PlasticityObject {
  const type = r.u32() as ObjectType;
  const id = r.u32();
  const version = r.u32();
  const parentId = r.i32();
  const materialId = r.i32();
  const flags = r.u32();
  const name = r.str();

  const obj: PlasticityObject = { type, id, version, parentId, materialId, flags, name };

  if (type === ObjectType.SOLID || type === ObjectType.SHEET) {
    const numVertices = r.u32();
    obj.vertices = r.f32Array(numVertices * 3);

    const numFaces = r.u32();
    obj.faces = r.i32Array(numFaces * 3);

    const numNormals = r.u32();
    obj.normals = r.f32Array(numNormals * 3);

    const numGroups = r.u32();
    obj.groups = r.i32Array(numGroups);

    const numFaceIds = r.u32();
    obj.faceIds = r.i32Array(numFaceIds);
  }

  return obj;
}

function decodeTransactionBody(r: Reader): Transaction {
  const filename = r.str();
  const version = r.u32();
  const numMessages = r.u32();

  const tx: Transaction = { filename, version, delete: [], add: [], update: [] };

  for (let i = 0; i < numMessages; i++) {
    const itemLen = r.u32();
    const sub = new Reader(r.bytes(itemLen));
    const subType = sub.u32() as MessageType;
    if (subType === MessageType.DELETE_1) {
      const numIds = sub.u32();
      for (let j = 0; j < numIds; j++) tx.delete.push(sub.i32());
    } else if (subType === MessageType.ADD_1 || subType === MessageType.UPDATE_1) {
      const numObjects = sub.u32();
      const target = subType === MessageType.ADD_1 ? tx.add : tx.update;
      for (let j = 0; j < numObjects; j++) target.push(decodeObjectRecord(sub));
    }
    // MOVE_1 / ATTRIBUTE_1 currently ignored (addon also skips them).
  }

  return tx;
}

export function decodeMessage(buf: Buffer): DecodedMessage {
  const r = new Reader(buf);
  const opcode = r.u32();

  switch (opcode) {
    case MessageType.TRANSACTION_1:
      return { kind: "transaction", data: decodeTransactionBody(r) };

    case MessageType.LIST_ALL_1:
    case MessageType.LIST_SOME_1:
    case MessageType.LIST_VISIBLE_1: {
      const msgId = r.u32();
      const code = r.u32();
      // The remainder is a transaction body whose sub-messages are all ADD_1.
      const tx = decodeTransactionBody(r);
      return {
        kind: "list",
        data: {
          msgId,
          code,
          filename: tx.filename,
          version: tx.version,
          objects: tx.add,
        },
      };
    }

    case MessageType.NEW_VERSION_1: {
      const filename = r.str();
      const version = r.u32();
      return { kind: "newVersion", filename, version };
    }

    case MessageType.NEW_FILE_1: {
      const filename = r.str();
      return { kind: "newFile", filename };
    }

    case MessageType.REFACET_SOME_1: {
      const msgId = r.u32();
      const code = r.u32();
      const filename = r.str();
      const fileVersion = r.u32();
      const numItems = r.u32();
      const items: RefacetResponseItem[] = [];
      for (let i = 0; i < numItems; i++) {
        const plasticityId = r.u32();
        const version = r.u32();
        const numFaceFacets = r.u32();
        const faces = r.i32Array(numFaceFacets);
        const numPositions = r.u32();
        const positions = r.f32Array(numPositions);
        const numIndices = r.u32();
        const indices = r.i32Array(numIndices);
        const numNormals = r.u32();
        const normals = r.f32Array(numNormals);
        const numGroups = r.u32();
        const groups = Array.from(r.i32Array(numGroups));
        const numFaceIds = r.u32();
        const faceIds = Array.from(r.i32Array(numFaceIds));
        items.push({
          plasticityId,
          version,
          faces,
          positions,
          indices,
          normals,
          groups,
          faceIds,
        });
      }
      return { kind: "refacet", data: { msgId, code, filename, fileVersion, items } };
    }

    case MessageType.PUT_SOME_1: {
      const msgId = r.u32();
      const code = r.u32();
      const numGroups = r.u32();
      const groups: PutSomeResponse["groups"] = [];
      for (let i = 0; i < numGroups; i++) {
        const clientGroupId = r.str();
        const groupId = r.u32();
        groups.push({ clientGroupId, groupId });
      }
      const numItems = r.u32();
      const items: PutSomeResponse["items"] = [];
      for (let i = 0; i < numItems; i++) {
        const clientId = r.str();
        const stableId = r.u32();
        const versionId = r.u32();
        items.push({ clientId, stableId, versionId });
      }
      return { kind: "putSome", data: { msgId, code, groups, items } };
    }

    case MessageType.HANDSHAKE_1: {
      const msgId = r.u32();
      const num = r.u32();
      const supported = new Set<number>();
      for (let i = 0; i < num; i++) supported.add(r.u32());
      return { kind: "handshake", data: { msgId, supportedOpcodes: supported } };
    }

    default:
      return { kind: "unknown", opcode };
  }
}
