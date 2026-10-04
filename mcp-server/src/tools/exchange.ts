import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BODY_IDS_SCHEMA, BodyIds, native, ok, type ToolFamily } from "./shared.js";

/** Import, export, reference meshes and saving. */

const ExportStepArgs = z.object({
  path: z.string().min(1),
  ids: BodyIds.optional(),
  overwrite: z.boolean().optional().default(false),
});

const ExportParasolidArgs = z.object({
  path: z.string().min(1),
  ids: BodyIds.optional(),
  overwrite: z.boolean().optional().default(false),
});

const ExportMeshArgs = z.object({
  path: z.string().min(1),
  ids: BodyIds.optional(),
  tolerance: z.number().positive().max(10).optional().default(0.05),
  angle: z.number().positive().max(90).optional().default(15),
  overwrite: z.boolean().optional().default(false),
});

const ViewNameSchema = z.enum(["front", "back", "left", "right", "top", "bottom", "isometric"]);

const ExportDrawingArgs = z.object({
  path: z.string().min(1),
  ids: BodyIds.optional(),
  views: z.array(ViewNameSchema).min(1).max(7).optional().default(["front", "top", "right"]),
  hiddenLines: z.boolean().optional().default(true),
  overwrite: z.boolean().optional().default(false),
});

const ImportStepArgs = z.object({
  path: z.string().min(1),
});

const ImportUnitSchema = z.enum(["millimeter", "centimeter", "meter", "inch"]);

const ImportParasolidArgs = z.object({
  path: z.string().min(1),
});

const ImportSvgArgs = z.object({
  path: z.string().min(1),
  unit: ImportUnitSchema.optional().default("millimeter"),
});

const ImportMeshArgs = z.object({
  path: z.string().min(1),
  unit: ImportUnitSchema.optional().default("millimeter"),
});

const DeleteReferenceMeshesArgs = z.object({
  ids: z.array(z.number().int().nonnegative()).min(1),
});

const SaveDocumentArgs = z.object({
  path: z.string().min(1),
  overwrite: z.boolean().optional().default(false),
});

const tools: Tool[] = [
  {
    name: "export_step",
    description:
      "Export bodies as exact B-Rep geometry to a STEP file (.step / .stp). `path` must be " +
      "absolute. Without `ids`, every Solid and Sheet of the document is exported. An existing " +
      "file is replaced only with overwrite: true. Does not change the document.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute output path ending in .step or .stp" },
        ids: BODY_IDS_SCHEMA,
        overwrite: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "export_parasolid",
    description:
      "Export bodies as exact B-Rep geometry to a Parasolid file: `.x_t` (text) or `.x_b` " +
      "(binary), chosen by the extension. `path` must be absolute. Without `ids`, every Solid " +
      "and Sheet of the document is exported. An existing file is replaced only with " +
      "overwrite: true. Does not change the document.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute output path ending in .x_t or .x_b" },
        ids: BODY_IDS_SCHEMA,
        overwrite: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "export_mesh",
    description:
      "Export bodies as a triangle mesh for 3D printing or rendering. The extension of `path` " +
      "(absolute) picks the format: `.stl` (binary), `.obj` or `.3mf`. STL and OBJ are written " +
      "in millimetres (they carry no unit); 3MF is written in metres with that unit declared, " +
      "so it has the right size wherever units are honoured. Z is up. " +
      "`tolerance` is the largest allowed gap between the mesh and the " +
      "true surface in millimetres (default 0.05; smaller = more triangles), `angle` the " +
      "largest angle between neighbouring facets in degrees (default 15). Without `ids`, every " +
      "Solid and Sheet is exported. Returns the triangle count for STL and OBJ. An existing " +
      "file is replaced only with overwrite: true. Does not change the document.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute output path ending in .stl, .obj or .3mf" },
        ids: BODY_IDS_SCHEMA,
        tolerance: { type: "number", default: 0.05 },
        angle: { type: "number", default: 15 },
        overwrite: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "export_drawing",
    description:
      "Export a technical drawing as SVG in millimetres (1 unit = 1 mm): one orthographic " +
      "hidden-line projection per entry of `views` (front, back, left, right, top, bottom, " +
      "isometric; default front, top, right), laid out left to right. Visible edges are solid " +
      "lines, hidden edges dashed; hiddenLines: false leaves the hidden ones out. Only Solids " +
      "can be drawn; without `ids` every Solid of the document is. Returns the size of each " +
      "view in millimetres. The viewport camera is not touched. An existing file is replaced " +
      "only with overwrite: true. Does not change the document.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute output path ending in .svg" },
        ids: BODY_IDS_SCHEMA,
        views: {
          type: "array",
          items: {
            type: "string",
            enum: ["front", "back", "left", "right", "top", "bottom", "isometric"],
          },
          minItems: 1,
        },
        hiddenLines: { type: "boolean", default: true },
        overwrite: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "import_step",
    description:
      "Add the geometry of a STEP file (.step / .stp, absolute path) to the current document. " +
      "The imported bodies are returned in `created`; their bounds can be up to a fraction of " +
      "a millimetre larger than the source because of import tolerances. Undoable.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", description: "Absolute path of the STEP file" } },
    },
  },
  {
    name: "import_parasolid",
    description:
      "Add the bodies of a Parasolid file (`.x_t` or `.x_b`, absolute path) to the current " +
      "document as exact B-Rep. The imported bodies are returned in `created`. Undoable.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", description: "Absolute path of the Parasolid file" } },
    },
  },
  {
    name: "import_svg",
    description:
      "Import the shapes of an SVG file (absolute path) as editable curves (Wires), returned " +
      "in `created`. One SVG user unit is read as one `unit` (default millimeter). Closed " +
      "shapes become regions that list_regions and the profile tools can use. Undoable.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute path of the SVG file" },
        unit: { type: "string", enum: ["millimeter", "centimeter", "meter", "inch"], default: "millimeter" },
      },
    },
  },
  {
    name: "import_mesh",
    description:
      "Import a triangle mesh (`.stl`, `.obj` or `.3mf`, absolute path) as a REFERENCE MESH: " +
      "it is shown in the viewport and on screenshots and can be modelled around, but it is " +
      "not a body — it has no faces to edit and list_bodies, move_bodies etc. do not see it. " +
      "Reference meshes have ids of their own (see list_reference_meshes). STL and OBJ carry " +
      "no units: one file unit is read as one `unit` (default millimeter). Undoable.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute path of the mesh file" },
        unit: { type: "string", enum: ["millimeter", "centimeter", "meter", "inch"], default: "millimeter" },
      },
    },
  },
  {
    name: "list_reference_meshes",
    description:
      "List the reference meshes of the document (imported with import_mesh): id, name, source " +
      "file, bounds in millimetres, triangle count, visibility. These ids are separate from " +
      "body ids.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "delete_reference_meshes",
    description:
      "Delete reference meshes by id (from list_reference_meshes). Undoable. Clears the " +
      "current selection.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: { type: "array", items: { type: "number" }, minItems: 1 } },
    },
  },
  {
    name: "save_document",
    description:
      "Save a copy of the current document as a .plasticity file (`path` must be absolute). " +
      "The open document keeps its own file association — an Untitled document stays " +
      "Untitled. An existing file is replaced only with overwrite: true.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute output path ending in .plasticity" },
        overwrite: { type: "boolean", default: false },
      },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  export_step: async (rawArgs) => {
    const args = ExportStepArgs.parse(rawArgs ?? {});
    return ok(await native.exportStep(args.path, args.ids, args.overwrite));
  },

  export_parasolid: async (rawArgs) => {
    const args = ExportParasolidArgs.parse(rawArgs ?? {});
    return ok(await native.exportParasolid(args.path, args.ids, args.overwrite));
  },

  export_mesh: async (rawArgs) => {
    const args = ExportMeshArgs.parse(rawArgs ?? {});
    return ok(
      await native.exportMesh(args.path, args.ids, args.tolerance, args.angle, args.overwrite),
    );
  },

  export_drawing: async (rawArgs) => {
    const args = ExportDrawingArgs.parse(rawArgs ?? {});
    return ok(
      await native.exportDrawing(args.path, args.ids, args.views, args.hiddenLines, args.overwrite),
    );
  },

  import_step: async (rawArgs) => {
    const args = ImportStepArgs.parse(rawArgs ?? {});
    return ok(await native.importStep(args.path));
  },

  import_parasolid: async (rawArgs) => {
    const args = ImportParasolidArgs.parse(rawArgs ?? {});
    return ok(await native.importParasolid(args.path));
  },

  import_svg: async (rawArgs) => {
    const args = ImportSvgArgs.parse(rawArgs ?? {});
    return ok(await native.importSvg(args.path, args.unit));
  },

  import_mesh: async (rawArgs) => {
    const args = ImportMeshArgs.parse(rawArgs ?? {});
    return ok(await native.importMesh(args.path, args.unit));
  },

  list_reference_meshes: async () => {
    const meshes = await native.listReferenceMeshes();
    return ok({ count: meshes.length, meshes });
  },

  delete_reference_meshes: async (rawArgs) => {
    const args = DeleteReferenceMeshesArgs.parse(rawArgs ?? {});
    return ok(await native.deleteReferenceMeshes(args.ids));
  },

  save_document: async (rawArgs) => {
    const args = SaveDocumentArgs.parse(rawArgs ?? {});
    return ok(await native.saveCopy(args.path, args.overwrite));
  },
};

export const exchange: ToolFamily = { tools, handlers };
