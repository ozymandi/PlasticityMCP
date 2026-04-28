# Plasticity WebSocket Protocol — Reverse-Engineered Spec

**Source:** [`nkallen/plasticity-blender-addon`](https://github.com/nkallen/plasticity-blender-addon) — `client.py`, `handler.py`, `__init__.py`.
**Verified against:** addon `main` branch (clone date 2026-04-28).
**Plasticity target:** 26.1.x (2026.1.x).

> ⚠️ Unofficial. Subject to change between Plasticity releases. The addon performs a `HANDSHAKE_1` to discover which opcodes the running server supports — **always handshake first**.

## Transport

- **URL:** `ws://localhost:8980` (default; the addon stores it as `prop_plasticity_server` and lets the user override). Plain WebSocket, no TLS.
- **Encoding:** Binary frames only. All integers are little-endian. All strings are UTF-8 with **4-byte zero-padding** after the length-prefixed payload.
- **Max message size:** `2^32 − 1` bytes (set by the addon client; the server presumably matches).
- **No auth.** Localhost trust only.

## Message framing

Every message starts with a 4-byte `u32` opcode. Client→server requests then carry a `u32 message_id` (monotonic, starting at 0, incremented by the client per request). Server responses echo that `message_id` (where applicable), followed by a `u32 code` (`200` = success).

```
┌──────────┬─────────────┬────────────┬─────── payload ───────┐
│ u32 type │ u32 msg_id  │ u32 code?  │ ...                   │
└──────────┴─────────────┴────────────┴───────────────────────┘
```

Server-pushed events (`TRANSACTION_1`, `NEW_VERSION_1`, `NEW_FILE_1`) **do not carry `message_id`** — they go straight from `type` into payload.

## Opcode table (`MessageType`)

| Value | Name | Direction | Purpose |
|------:|------|-----------|---------|
| 0 | `TRANSACTION_1` | S→C (push) | Batched scene mutations (delete + add + update). |
| 1 | `ADD_1` | S→C (inside transaction) | Object added. |
| 2 | `UPDATE_1` | S→C (inside transaction) | Object updated. |
| 3 | `DELETE_1` | S→C (inside transaction) | Object deleted. |
| 4 | `MOVE_1` | S→C (inside transaction) | *(not currently handled by addon)* |
| 5 | `ATTRIBUTE_1` | S→C (inside transaction) | *(not currently handled by addon)* |
| 10 | `NEW_VERSION_1` | S→C (push) | A new version of the open file is available. |
| 11 | `NEW_FILE_1` | S→C (push) | A different file was opened in Plasticity. |
| 20 | `LIST_ALL_1` | C↔S | List every object in the document. |
| 21 | `LIST_SOME_1` | S→C (response) | List of specific objects. |
| 22 | `LIST_VISIBLE_1` | C↔S | List currently-visible objects only. |
| 23 | `SUBSCRIBE_ALL_1` | C→S | Subscribe to all transactions for the open file. |
| 24 | `SUBSCRIBE_SOME_1` | C→S | Subscribe to specific object IDs. |
| 25 | `UNSUBSCRIBE_ALL_1` | C→S | Cancel subscription. |
| 26 | `REFACET_SOME_1` | C↔S | Request retessellation of given objects with quality params. |
| 31 | `PUT_SOME_1` | C↔S | Push mesh data **into** Plasticity (creates/updates objects from the client). |
| 100 | `HANDSHAKE_1` | C↔S | Exchange supported-message lists. |

## Enumerations

### `ObjectType`
| Value | Name | Notes |
|------:|------|-------|
| 0 | `SOLID` | B-Rep solid; carries vertices/faces/normals/groups/face_ids. |
| 1 | `SHEET` | Open surface; same payload shape as `SOLID`. |
| 2 | `WIRE` | Curves/edges; **no mesh payload** (header only). |
| 5 | `GROUP` | Collection node; **no mesh payload**. |
| 6 | `EMPTY` | Empty marker. |

### `FacetShapeType` (used in `REFACET_SOME_1`)
| Value | Name |
|------:|------|
| 20500 | `ANY` |
| 20501 | `CUT` |
| 20502 | `CONVEX` |

### Object flags (bitfield in `flags` field)
| Bit | Meaning |
|----:|---------|
| 1 | hidden |
| 2 | visible |
| 4 | selectable |

### `PUT_SOME_1` options bitfield (per item)
| Bits | Meaning |
|------|---------|
| 0–7 | kind: `0 = MESH`, `1 = SUBD` |
| 8 | SUBD boundary smooth = ALL |
| 9 | SUBD merge patches |
| 10 | SUBD interpolate boundary |

## Per-message wire formats

Notation: `u32`, `i32`, `f32` little-endian; `pad4` = zero bytes to round preceding string up to 4-byte alignment; `[N]T` = N elements of type T.

### `HANDSHAKE_1` (client → server)
```
u32 type=100
u32 msg_id
```

### `HANDSHAKE_1` (server → client)
```
u32 type=100
u32 msg_id
u32 num_supported
[num_supported] u32 supported_opcode
```

### `LIST_ALL_1` / `LIST_VISIBLE_1` (client → server)
```
u32 type
u32 msg_id
```

### `LIST_*` / `LIST_SOME_1` (server → client)
```
u32 type
u32 msg_id
u32 code           // 200 = OK
// Then a transaction body (see below) — only ADD_1 sub-messages expected.
```

### Transaction body (`TRANSACTION_1` push, or trailing payload of `LIST_*`)
```
u32 fname_len
[fname_len] u8 filename
pad4
u32 version
u32 num_messages
for i in 0..num_messages:
  u32 item_len
  [item_len] u8 sub_message    // a DELETE_1 / ADD_1 / UPDATE_1 record
```

#### Sub-message: `DELETE_1`
```
u32 type=3
u32 num_ids
[num_ids] i32 plasticity_id
```

#### Sub-message: `ADD_1` / `UPDATE_1`
```
u32 type=1 or 2
u32 num_objects
[num_objects] ObjectRecord
```

#### `ObjectRecord`
```
u32 object_type      // ObjectType enum
u32 object_id
u32 version_id
i32 parent_id        // signed; -1 / 0 = root
i32 material_id      // signed; -1 = none
u32 flags            // see Object flags above
u32 name_len
[name_len] u8 name
pad4

// Mesh payload — present only for SOLID / SHEET:
u32 num_vertices
[num_vertices] (f32,f32,f32)   // 12 bytes per vertex (positions)
u32 num_face_indices
[num_face_indices] (i32,i32,i32) // 12 bytes per triangle
u32 num_normals
[num_normals] (f32,f32,f32)    // 12 bytes per loop normal
u32 num_groups
[num_groups] i32                // packed (start, count) pairs — group spans
u32 num_face_ids
[num_face_ids] i32              // one per group (Plasticity-stable face id)
```

> Note: `num_vertices`/`num_normals`/`num_faces` are *element* counts; the wire stride is 12 bytes each (3 × 4-byte components). The mesh is **already triangulated**.

### `SUBSCRIBE_SOME_1` (client → server)
```
u32 type=24
u32 msg_id
u32 fname_len
[fname_len] u8 filename
pad4
u32 num_ids
[num_ids] u32 plasticity_id
```

`SUBSCRIBE_ALL_1` / `UNSUBSCRIBE_ALL_1`: just `type` + `msg_id`.

### `REFACET_SOME_1` (client → server)
```
u32 type=26
u32 msg_id
u32 fname_len
[fname_len] u8 filename
pad4
u32 num_ids
[num_ids] u32 plasticity_id
u32  relative_to_bbox        // 0/1
f32  curve_chord_tolerance   // default 0.01
f32  curve_chord_angle       // default 0.35
f32  surface_plane_tolerance // default 0.01
f32  surface_plane_angle     // default 0.35
u32  match_topology          // 0/1
u32  max_sides               // default 3
f32  plane_angle             // default 0
f32  min_width               // default 0
f32  max_width               // default 0
f32  curve_chord_max         // default 0
u32  shape                   // FacetShapeType enum (default CUT=20501)
```

### `REFACET_SOME_1` (server → client)
```
u32 type=26
u32 msg_id
u32 code               // 200 = OK
u32 fname_len
[fname_len] u8 filename
pad4
u32 file_version
u32 num_items
for i in 0..num_items:
  u32 plasticity_id
  u32 version
  u32 num_face_facets
  [num_face_facets] i32 face          // per-loop face span markers
  u32 num_positions
  [num_positions] f32                  // flat — divide by 3 for vertex count
  u32 num_indices
  [num_indices] i32
  u32 num_normals
  [num_normals] f32                    // flat — divide by 3
  u32 num_groups
  [num_groups] i32                     // packed (start,count) pairs
  u32 num_face_ids
  [num_face_ids] i32
```

### `PUT_SOME_1` (client → server)

Pushes mesh objects into Plasticity. Items are grouped into "groups" (= Blender collections). Each item carries vertex positions + per-face indices + per-face vertex counts (n-gons supported).

```
u32 type=31
u32 msg_id
u32 fname_len
[fname_len] u8 filename
pad4

u32 num_groups
for g in 0..num_groups:
  u32 client_group_id_len
  [client_group_id_len] u8 client_group_id    // any unique string the client controls
  pad4
  u32 client_name_len
  [client_name_len] u8 name
  pad4
  u32 parent_client_group_id_len
  [parent_client_group_id_len] u8 parent_client_group_id
  pad4
  u32 existing_group_id          // 0 if new, else known plasticity group id

u32 num_items
for i in 0..num_items:
  u32 client_id_len
  [client_id_len] u8 client_id
  pad4
  u32 client_name_len
  [client_name_len] u8 name
  pad4
  u32 parent_client_group_id_len
  [parent_client_group_id_len] u8 parent_client_group_id
  pad4
  u32 existing_stable_id          // 0 if new, else plasticity_id of object to replace
  u64 options                     // PUT_SOME options bitfield (see above)
  u32 vertex_count
  [vertex_count*3] f32 positions  // xyz interleaved
  u32 face_count
  u32 index_count
  [index_count]   u32 indices     // flat loop indices (per-face concatenated)
  [face_count]    u32 sizes       // verts-per-face (3 = tri, 4 = quad, n = n-gon)
```

### `PUT_SOME_1` (server → client)
```
u32 type=31
u32 msg_id
u32 code            // 200 = OK
u32 num_groups
for g in 0..num_groups:
  u32 client_group_id_len
  [client_group_id_len] u8 client_group_id
  pad4
  u32 group_id      // assigned plasticity group id
u32 num_items
for i in 0..num_items:
  u32 client_id_len
  [client_id_len] u8 client_id
  pad4
  u32 stable_id     // assigned plasticity_id
  u32 version_id
```

### `NEW_VERSION_1` (server push)
```
u32 type=10
u32 fname_len
[fname_len] u8 filename
pad4
u32 version
```

### `NEW_FILE_1` (server push)
```
u32 type=11
u32 fname_len
[fname_len] u8 filename
pad4
```

## Verified opcode support (Plasticity 26.1.2)

Empirical handshake against `localhost:8980` on Plasticity 26.1.2 returns these 13 supported opcodes:

```
TRANSACTION_1, ADD_1, UPDATE_1, DELETE_1,
NEW_VERSION_1, NEW_FILE_1,
LIST_ALL_1, LIST_VISIBLE_1,
SUBSCRIBE_ALL_1, SUBSCRIBE_SOME_1, UNSUBSCRIBE_ALL_1,
REFACET_SOME_1,
HANDSHAKE_1
```

**Notably NOT advertised by 26.1.2:** `PUT_SOME_1` (31), `LIST_SOME_1` (21), `MOVE_1` (4), `ATTRIBUTE_1` (5).

Implications:
- The Blender addon's `PUT_SOME_1` upload path is gated on a newer/different Plasticity build — possibly an experimental flag or post-26.1.2 release. **Mesh-push from the MCP server will currently fail** in stable 26.1.2; the client correctly throws "Server does not advertise PUT_SOME_1 support" before attempting.
- `LIST_SOME_1` is documented in the addon enum but the server only sends back `LIST_ALL_1` / `LIST_VISIBLE_1` for list responses.

## Implementation notes

- **Always send `HANDSHAKE_1` first.** The server replies with the set of supported opcodes; not every Plasticity build supports every opcode (e.g. `PUT_SOME_1` is gated).
- **Padding rule:** strings are stored as `len_u32 + bytes + (4-(len%4))%4` zero bytes, *except* in `LIST_*` `code` framing (no string there) — the padding always follows a length-prefixed UTF-8 payload.
- **`num_vertices` is vertex count, but `num_face_indices`/`num_normals` payloads are stored at 12-byte stride.** Don't confuse element count with byte count.
- **Wire payloads are pre-triangulated** in `ADD_1`/`UPDATE_1`/`LIST_*` flows. `REFACET_SOME_1` returns n-gons (face span via `face` array). `PUT_SOME_1` accepts n-gons (per-face `sizes`).
- **Subscriptions are per-filename.** `NEW_FILE_1` invalidates them; client must re-subscribe.

## Gaps for the MCP project

What the existing protocol **does** give us (no fork required):
- Connect, handshake, list scene, subscribe to changes
- Push meshes/n-gons into Plasticity (`PUT_SOME_1`)
- Refacet existing objects with quality params

What it does **not** give us (fork needed for these):
- Invoke `CommandExecutor` ops (Extrude, Fillet, Shell, Boolean Union/Diff/Intersect, etc.)
- Programmatic object selection / picking
- Sketch creation (constraints, dimensions)
- Export (STEP/IGES/OBJ/3DM) by command
- Undo/redo invocation (`bpy.ops.ed.undo_push` is Blender-side; Plasticity-side undo not exposed)
- Camera / viewport control
- Screenshot capture

→ These define the **Phase 3 fork patch surface**: a single `EXEC_COMMAND_1` opcode whose payload is `{command_name, json_args}` and which invokes the corresponding `CommandExecutor` entry inside Plasticity.
