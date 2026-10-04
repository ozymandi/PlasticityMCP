/** File export and import, reference meshes, saving. */
import { readFile, writeFile } from "node:fs/promises";

import { ProjectedView, buildDrawing } from "../drawing.js";
import { checkInput, checkOutput, writeStaged } from "../files.js";

import { COMMAND_TIMEOUT_MS } from "./core.js";
import { MM } from "./math.js";
import { BUSY_GUARD, FIND_VIEW, READ_STATE, STUCK_CHECK, commandFunction } from "./snippets.js";
import { TransformTools } from "./transforms.js";
import { DrawingResult, FileResult, ImportUnit, MeshResult, MutationResult, NativeState, ReferenceMeshInfo, ReferenceMutation, Vec3, ViewName } from "./types.js";

export const IMPORT_TIMEOUT_MS = 300_000;

export const STEP_EXTENSIONS = [".step", ".stp"];

export const PARASOLID_EXTENSIONS = [".x_t", ".x_b"];

// Mesh formats and the native exporter behind each.
export const SVG_EXTENSIONS = [".svg"];

export const MESH_IMPORT_EXTENSIONS = [".stl", ".obj", ".3mf"];

// Runs with `this` = editor. Imported meshes live among the "empties", tagged 'Object'.
export const READ_REFERENCES = `function () {
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const snapshot = this.db.empties.snapshot();
  const empties = Array.from(snapshot.empties ?? []);
  const infos = Array.from(snapshot.infos ?? []);
  const out = [];
  empties.forEach((empty, index) => {
    const info = infos[index];
    if (!empty || info?.tag !== 'Object') return;
    const stable = this.db.lookupEmptyById(Number(empty.versionId));
    if (stable?.constructor?.name !== 'Empties_ObjectEmpty') return;
    let triangles = 0;
    stable.traverse?.((node) => {
      const geometry = node?.geometry;
      const positions = geometry?.attributes?.position;
      if (!positions) return;
      const indices = Number(geometry.index?.count);
      triangles += Number.isFinite(indices) ? indices / 3 : positions.count / 3;
    });
    const box = stable.boundingBox?.clone?.()?.applyMatrix4?.(stable.matrixWorld);
    const key = this.db.nodes?.item2key?.(stable);
    const path = String(info.path ?? '');
    out.push({
      id: Number(stable.versionId),
      name: (key === undefined ? null : this.db.nodes.getName(key)) ?? (path.split(/[\\\\/]/).pop() || null),
      sourcePath: path,
      boundsMm: box ? { min: mm(box.min), max: mm(box.max) } : null,
      triangles: Math.round(triangles),
      visible: key === undefined ? Boolean(stable.visible) : Boolean(this.db.nodes.isVisible(key)) && !this.db.nodes.isHidden(key),
    });
  });
  return out.sort((a, b) => a.id - b.id);
}`;

export const MESH_EXPORTERS: Record<string, string> = {
  ".stl": "STLExportFactory",
  ".obj": "OBJExportFactory",
  ".3mf": "ThreeMfExportFactory",
};

/** Side of the square render target the hidden-line generator works on. */
export const DRAWING_RESOLUTION = 2048;

export const DRAWING_MAX_COORDINATES = 2_000_000;

// Camera position relative to the model and its up vector, per standard view (Z is up).
export const VIEW_CAMERAS: Record<ViewName, { direction: Vec3; up: Vec3 }> = {
  front: { direction: [0, -1, 0], up: [0, 0, 1] },
  back: { direction: [0, 1, 0], up: [0, 0, 1] },
  left: { direction: [-1, 0, 0], up: [0, 0, 1] },
  right: { direction: [1, 0, 0], up: [0, 0, 1] },
  top: { direction: [0, 0, 1], up: [0, 1, 0] },
  bottom: { direction: [0, 0, -1], up: [0, 1, 0] },
  isometric: { direction: [1, -1, 1], up: [0, 0, 1] },
};

export class ExchangeTools extends TransformTools {
  /** Ids to export when the caller gave none: every Solid and Sheet of the document. */
  private exportable(state: NativeState, ids?: number[]): number[] {
    const chosen =
      ids ?? state.bodies.filter((b) => b.type === "Solid" || b.type === "Sheet").map((b) => b.id);
    if (chosen.length === 0) throw new Error("Nothing to export: the document has no Solid or Sheet");
    return chosen;
  }

  /** Exact B-Rep export through ExportCadFactory; the file extension selects the format. */
  private exportCad(
    path: string,
    extensions: string[],
    ids: number[] | undefined,
    overwrite: boolean,
    isValid: (content: Buffer) => boolean,
  ): Promise<FileResult & { ids: number[] }> {
    return this.enqueue(async () => {
      const output = await checkOutput(path, extensions, overwrite);
      const exported = this.exportable(await this.call<NativeState>(READ_STATE), ids);
      const bytes = await writeStaged(
        output,
        overwrite,
        (staged) =>
          this.call(
            `async function (Factory, args) {
              ${BUSY_GUARD}
              ${FIND_VIEW}
              const factory = new Factory(this);
              factory.items = args.ids.map(find);
              factory.filePath = args.path;
              await factory.commit();
            }`,
            ["ExportCadFactory"],
            [{ ids: exported, path: staged }],
          ),
        async (staged) => {
          const content = await readFile(staged).catch(() => Buffer.alloc(0));
          if (!isValid(content)) throw new Error("Plasticity did not produce a valid file");
        },
      );
      return { path: output, bytes, ids: exported };
    });
  }

  /**
   * Export bodies as exact B-Rep to a STEP file. Without `ids`, every Solid and Sheet of the
   * document is exported. Does not touch the undo history.
   */
  exportStep(path: string, ids?: number[], overwrite = false): Promise<FileResult & { ids: number[] }> {
    return this.exportCad(path, STEP_EXTENSIONS, ids, overwrite, (content) => {
      const text = content.toString("utf8");
      return text.startsWith("ISO-10303-21;") && text.includes("END-ISO-10303-21;");
    });
  }

  /** Export bodies as exact B-Rep to Parasolid: `.x_t` (text) or `.x_b` (binary). */
  exportParasolid(path: string, ids?: number[], overwrite = false): Promise<FileResult & { ids: number[] }> {
    return this.exportCad(path, PARASOLID_EXTENSIONS, ids, overwrite, (content) =>
      content.subarray(0, 28).toString("latin1") === "**ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    );
  }

  /**
   * Export bodies as a triangle mesh; the extension picks STL, OBJ or 3MF. STL and OBJ are
   * written in millimetres, 3MF in metres with that unit declared; Z is up.
   * `toleranceMm` is the largest allowed gap between mesh and surface,
   * `angleDeg` the largest angle between neighbouring facets.
   */
  exportMesh(
    path: string,
    ids?: number[],
    toleranceMm = 0.05,
    angleDeg = 15,
    overwrite = false,
  ): Promise<MeshResult> {
    return this.enqueue(async () => {
      const output = await checkOutput(path, Object.keys(MESH_EXPORTERS), overwrite);
      const extension = output.slice(output.lastIndexOf(".")).toLowerCase();
      const format = extension.slice(1) as MeshResult["format"];
      const exported = this.exportable(await this.call<NativeState>(READ_STATE), ids);
      let triangles: number | undefined;
      const bytes = await writeStaged(
        output,
        overwrite,
        (staged) =>
          // STL and OBJ carry no unit and slicers assume millimetres, while Plasticity's
          // exporters default to metres. 3MF declares its unit, and Plasticity always writes
          // unit="meter" there whatever the coordinates are — so 3MF must stay in metres.
          this.call(
            `async function (Factory, args) {
              ${BUSY_GUARD}
              ${FIND_VIEW}
              const factory = new Factory(this);
              factory.shells = args.ids.map((id) => {
                const view = find(id);
                if (view.constructor.name === 'Wire') throw new Error('Body ' + id + ' is a curve and has no surface to mesh');
                return view;
              });
              factory.filePath = args.path;
              factory.unit = args.unit;
              factory.upAxis = 'z';
              factory.scale = 1;
              factory.showWireframe = false;
              factory.simplify = false;
              factory.curveChordTolerance = args.tolerance;
              factory.surfacePlaneTolerance = args.tolerance;
              factory.curveChordAngleDegrees = args.angle;
              factory.surfacePlaneAngleDegrees = args.angle;
              await factory.commit();
            }`,
            [MESH_EXPORTERS[extension]!],
            [
              {
                ids: exported,
                path: staged,
                tolerance: toleranceMm * MM,
                angle: angleDeg,
                unit: format === "3mf" ? "meter" : "millimeter",
              },
            ],
          ),
        async (staged) => {
          const content = await readFile(staged).catch(() => Buffer.alloc(0));
          if (format === "stl") {
            // Binary STL: 80-byte header, triangle count, 50 bytes per triangle.
            const count = content.length >= 84 ? content.readUInt32LE(80) : -1;
            if (count <= 0 || content.length !== 84 + count * 50) {
              throw new Error("Plasticity did not produce a valid binary STL file");
            }
            triangles = count;
          } else if (format === "obj") {
            const lines = content.toString("utf8").split(/\r?\n/);
            triangles = lines.filter((line) => line.startsWith("f ")).length;
            if (triangles === 0) throw new Error("Plasticity did not produce a valid OBJ file");
          } else if (content.subarray(0, 2).toString("latin1") !== "PK" || !content.includes("3dmodel.model")) {
            throw new Error("Plasticity did not produce a valid 3MF archive");
          }
        },
      );
      return { path: output, bytes, format, ids: exported, ...(triangles === undefined ? {} : { triangles }) };
    });
  }

  /**
   * Technical drawing as SVG in millimetres: one orthographic hidden-line projection per
   * requested view, laid out left to right. Uses its own cameras, so the viewport is untouched.
   */
  exportDrawing(
    path: string,
    ids?: number[],
    views: ViewName[] = ["front"],
    hiddenLines = true,
    overwrite = false,
  ): Promise<DrawingResult> {
    return this.enqueue(async () => {
      const output = await checkOutput(path, [".svg"], overwrite);
      const state = await this.call<NativeState>(READ_STATE);
      const exported = ids ?? state.bodies.filter((b) => b.type === "Solid").map((b) => b.id);
      if (exported.length === 0) throw new Error("Nothing to draw: the document has no Solid");
      const projections = await this.call<ProjectedView[]>(
        `async function (Factory, Vector2, Vector3, OrthographicCamera, args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          const items = args.ids.map((id) => {
            const item = findItem(id);
            if (item.view.constructor.name !== 'Solid') {
              throw new Error('Body ' + id + ' is a ' + item.view.constructor.name + '; only Solids can be drawn');
            }
            return item;
          });
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          for (const item of items) {
            const box = item.model.FindBox();
            ['x', 'y', 'z'].forEach((k, i) => {
              min[i] = Math.min(min[i], box.min[k]);
              max[i] = Math.max(max[i], box.max[k]);
            });
          }
          const center = new Vector3(...min.map((v, i) => (v + max[i]) / 2));
          // Half-width of the square view volume: the bounding sphere plus a little air.
          const reach = Math.max(1e-6, Math.hypot(...max.map((v, i) => v - min[i])) / 2) * 1.05;
          const out = [];
          for (const view of args.views) {
            // A fresh factory per view: reusing one made every view after the first come out
            // with the wrong outline.
            const factory = new Factory(this);
            try {
              factory.items = items.map((item) => item.view);
              factory.includeBackgroundImage = false;
              factory.useMaterialColors = false;
              const bodyData = factory.collectBodyData();
              const camera = new OrthographicCamera(-reach, reach, reach, -reach, reach * 0.01, reach * 4);
              camera.up.set(...view.up);
              camera.position.copy(center).add(new Vector3(...view.direction).normalize().multiplyScalar(reach * 2));
              camera.lookAt(center);
              camera.updateMatrixWorld(true);
              camera.updateProjectionMatrix();
              const projected = await factory.generator.generate(
                camera,
                new Vector2(args.resolution, args.resolution),
                bodyData.bodyIds,
                factory,
                bodyData.transforms,
              );
              if (projected.geo.length > args.maxCoordinates) {
                throw new Error('The drawing is too large to transfer; draw fewer bodies at a time');
              }
              out.push({
                view: view.name,
                positions: Array.from(projected.geo),
                segments: projected.segments.map((s) => ({
                  category: String(s.category),
                  type: Number(s.projectedGeomType),
                  offset: Number(s.offset),
                  count: Number(s.count),
                })),
                mmPerPixel: (2 * reach * 1000) / args.resolution,
              });
            } finally {
              factory.dispose?.();
            }
          }
          return out;
        }`,
        ["ExportHiddenLineFactory", "Vector2", "Vector3", "OrthographicCamera"],
        [
          {
            ids: exported,
            views: views.map((name) => ({ name, ...VIEW_CAMERAS[name] })),
            resolution: DRAWING_RESOLUTION,
            maxCoordinates: DRAWING_MAX_COORDINATES,
          },
        ],
      );
      const { svg, ...drawing } = buildDrawing(projections, hiddenLines);
      const bytes = await writeStaged(
        output,
        overwrite,
        (staged) => writeFile(staged, svg, "utf8"),
        async () => {},
      );
      return { path: output, bytes, ids: exported, ...drawing };
    });
  }

  /**
   * Run one of Plasticity's import factories inside its ImportCommand (which exists only in
   * the module closure). `setup` may set further options on `factory`.
   */
  private importFunction(setup = ""): string {
    return commandFunction(
      "ImportCommand",
      [],
      `factory.filePath = args.path;
        ${setup}`,
      true,
    );
  }

  /** Add the geometry of a STEP file to the current document. */
  async importStep(path: string): Promise<MutationResult> {
    const input = await checkInput(path, STEP_EXTENSIONS);
    return this.mutate(
      this.importFunction(),
      ["ExchangeImportFactory", "ImportCommand"],
      [{ path: input }],
      IMPORT_TIMEOUT_MS,
    );
  }

  /** Add the bodies of a Parasolid file (`.x_t` / `.x_b`) to the current document. */
  async importParasolid(path: string): Promise<MutationResult> {
    const input = await checkInput(path, PARASOLID_EXTENSIONS);
    return this.mutate(
      this.importFunction(),
      ["ParasolidImportFactory", "ImportCommand"],
      [{ path: input }],
      IMPORT_TIMEOUT_MS,
    );
  }

  /** Import the shapes of an SVG file as editable curves; one SVG unit is one `unit`. */
  async importSvg(path: string, unit: ImportUnit = "millimeter"): Promise<MutationResult> {
    const input = await checkInput(path, SVG_EXTENSIONS);
    return this.mutate(
      this.importFunction("factory.unit = args.unit;"),
      ["VectorImportFactory", "ImportCommand"],
      [{ path: input, unit }],
      IMPORT_TIMEOUT_MS,
    );
  }

  /** Imported meshes of the document. */
  listReferenceMeshes(): Promise<ReferenceMeshInfo[]> {
    return this.enqueue(() => this.call<ReferenceMeshInfo[]>(READ_REFERENCES));
  }

  /** Run a mutation and report how the set of reference meshes changed. */
  private mutateReferences(
    functionDeclaration: string,
    bindingNames: string[],
    values: unknown[],
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<ReferenceMutation> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      const before = await this.call<ReferenceMeshInfo[]>(READ_REFERENCES);
      await this.call(functionDeclaration, bindingNames, values, timeoutMs);
      const after = await this.call<ReferenceMeshInfo[]>(READ_REFERENCES);
      const state = await this.call<NativeState>(READ_STATE);
      const beforeIds = new Set(before.map((m) => m.id));
      const afterIds = new Set(after.map((m) => m.id));
      return {
        created: after.filter((m) => !beforeIds.has(m.id)),
        removedIds: before.filter((m) => !afterIds.has(m.id)).map((m) => m.id),
        referenceCount: after.length,
        undoDepth: state.undoDepth,
        redoDepth: state.redoDepth,
      };
    });
  }

  /**
   * Import a mesh (`.stl`, `.obj`, `.3mf`) as a reference object. STL and OBJ carry no units:
   * one file unit is read as one `unit`.
   */
  async importMesh(path: string, unit: ImportUnit = "millimeter"): Promise<ReferenceMutation> {
    const input = await checkInput(path, MESH_IMPORT_EXTENSIONS);
    if (input.toLowerCase().endsWith(".3mf")) {
      // 3MF has its own importer on editor.importer and carries its units.
      return this.mutateReferences(
        `async function (Command, args) {
          ${BUSY_GUARD}
          const editor = this;
          let failure;
          let ran = false;
          const command = new Command(this);
          command.remember = false;
          command.execute = async function () {
            ran = true;
            try { await editor.importer.import3mf(args.path); }
            catch (error) { failure = error; throw error; }
          };
          await this.exec(command);
          if (failure) throw failure;
          ${STUCK_CHECK}
        }`,
        ["ImportCommand"],
        [{ path: input }],
        IMPORT_TIMEOUT_MS,
      );
    }
    return this.mutateReferences(
      this.importFunction("factory.unit = args.unit;"),
      ["MeshImportFactory", "ImportCommand"],
      [{ path: input, unit }],
      IMPORT_TIMEOUT_MS,
    );
  }

  /** Delete reference meshes with the native Delete command. Clears the selection. */
  deleteReferenceMeshes(ids: number[]): Promise<ReferenceMutation> {
    return this.mutateReferences(
      `async function (args) {
        ${BUSY_GUARD}
        const empties = args.ids.map((id) => {
          let empty = null;
          try { empty = this.db.lookupEmptyById(id); } catch {}
          if (empty?.constructor?.name !== 'Empties_ObjectEmpty') {
            throw new Error('Unknown reference mesh id: ' + id);
          }
          return empty;
        });
        this.selection.selected.removeAll();
        for (const empty of empties) this.selection.selected.addEmpty(empty);
        let failure;
        let ran = false;
        const command = new this.commands.DeleteCommand(this);
        command.remember = false;
        const execute = command.execute.bind(command);
        command.execute = async function () {
          ran = true;
          try { return await execute(); }
          catch (error) { failure = error; throw error; }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      [],
      [{ ids }],
    );
  }

  /**
   * Save a copy of the document as a .plasticity file. The open document keeps its own
   * file association (an Untitled document stays Untitled).
   */
  saveCopy(path: string, overwrite = false): Promise<FileResult> {
    return this.enqueue(async () => {
      const output = await checkOutput(path, [".plasticity"], overwrite);
      const bytes = await writeStaged(
        output,
        overwrite,
        (staged) =>
          this.call(
            `async function (args) {
              ${BUSY_GUARD}
              await this.saver.save(args.path);
            }`,
            [],
            [{ path: staged }],
          ),
        async (staged) => {
          const header = await readFile(staged).catch(() => Buffer.alloc(0));
          if (header.subarray(0, 10).toString() !== "plasticity") {
            throw new Error("Plasticity did not produce a valid document file");
          }
        },
      );
      return { path: output, bytes };
    });
  }
}
