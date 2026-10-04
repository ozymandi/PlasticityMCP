/** Projection: curves onto bodies, intersections, outlines, flattening onto a plane. */

import { withHint } from "./core.js";
import { FaceTools } from "./faces.js";
import { toMeters } from "./math.js";
import { BUSY_GUARD, FIND_TYPED, FIND_VIEW, PICK_TOPOLOGY, STUCK_CHECK, commandFunction } from "./snippets.js";
import { MutationResult, ProjectionSource, Vec3 } from "./types.js";

// Native codes, read from the running 26.1.3 app.
const PROJECTION_METHOD = { normal: 26520, vector: 26521 };

export class ProjectionTools extends FaceTools {
  /**
   * New curves by projection; what is projected stays as it is. Curves onto a body (along
   * `direction`, or onto the nearest surface along its normals), the intersection lines of
   * bodies, or two planar curves seen from two sides combined into one curve in space.
   */
  project(source: ProjectionSource): Promise<MutationResult> {
    if ("bodyIds" in source) {
      if (new Set(source.bodyIds).size !== source.bodyIds.length) {
        return Promise.reject(new Error("Body ids must be distinct"));
      }
      const setup = `
        const [target, ...tools] = args.bodyIds.map((id) => typed(id, 'Solid', 'Sheet'));
        factory.target = target;
        factory.tools = tools;`;
      return withHint(
        this.mutate(
          commandFunction("ProjectBodyBodyCommand", [], setup),
          ["ProjectBodyBodyFactory"],
          [source],
        ),
        /Operation has no effect|PK_ERROR/,
        "The bodies must cross each other.",
      );
    }
    if (source.targetId === undefined) {
      const setup = `
        factory.curve1 = typed(args.curveIds[0], 'Wire');
        factory.curve2 = typed(args.curveIds[1], 'Wire');`;
      return withHint(
        this.mutate(
          commandFunction("ProjectCurveCurveCommand", [], setup),
          ["ProjectCurveCurveFactory"],
          [source],
        ),
        /Operation has no effect|PK_ERROR|No basis found/,
        "Both curves must be planar, in two different planes, and overlap when each is swept along its plane normal.",
      );
    }
    const setup = `
        factory.target = typed(args.targetId, 'Solid', 'Sheet');
        factory.curves = args.curveIds.map((id) => typed(id, 'Wire'));
        factory.method = args.method;
        if (args.direction) factory.direction = new Vector3(...args.direction).normalize();`;
    return this.mutate(
      commandFunction("ProjectCurveBodyCommand", ["Vector3"], setup),
      ["ProjectCurveBodyFactory", "Vector3"],
      [{
        curveIds: source.curveIds,
        targetId: source.targetId,
        direction: source.direction,
        method: source.direction ? PROJECTION_METHOD.vector : PROJECTION_METHOD.normal,
      }],
    );
  }

  /**
   * The outline of bodies as seen along the normal of the active construction plane of the
   * Plasticity window: as curves in space on the bodies, or with `flat` projected onto that
   * plane. The factories take the plane from the window; it is the world XY plane unless the
   * user has set another.
   */
  createOutline(ids: number[], flat = false): Promise<MutationResult> {
    const setup = `factory.shells = args.ids.map((id) => typed(id, 'Solid', 'Sheet'));`;
    return this.mutate(
      commandFunction(flat ? "ProjectOutlineCommand" : "CreateOutlineCommand", [], setup),
      [flat ? "ProjectOutlineFromShellsFactory" : "CreateOutlineFromShellsFactory"],
      [{ ids }],
    );
  }

  /**
   * Copy curves, or edges of one body, and flatten the copies onto a plane (projected along
   * its normal). The originals stay.
   */
  duplicateAndProject(
    source: { curveIds: number[] } | { id: number; edgeIds: string[] },
    planeOriginMm: Vec3,
    planeNormal: Vec3,
  ): Promise<MutationResult> {
    const fromEdges = "edgeIds" in source;
    // Copy first (curves are duplicated, edges become curves), then flatten the copies; both
    // inside one command so that one Undo removes the result.
    return this.mutate(
      `async function (Copy, Planarize, Vector3, args) {
        ${BUSY_GUARD}
        ${FIND_VIEW}
        ${FIND_TYPED}
        ${PICK_TOPOLOGY}
        const editor = this;
        const list = (result) => (Array.isArray(result) ? result : [result]).filter(Boolean);
        let failure;
        let ran = false;
        const command = new this.commands.${fromEdges ? "DuplicateEdgeAndProjectCommand" : "DuplicateCurveAndProjectCommand"}(this);
        command.remember = false;
        command.execute = async function () {
          ran = true;
          try {
            const copy = new Copy(editor).resource(this);
            if (args.edgeIds) copy.edges = pick(typed(args.id, 'Solid', 'Sheet').high.edges, args.edgeIds, 'edge');
            else copy.curves = args.curveIds.map((id) => typed(id, 'Wire'));
            const copies = list(await copy.commit());
            if (copies.length === 0) throw new Error('Plasticity produced no curves to project');
            const flatten = new Planarize(editor).resource(this);
            flatten.curves = copies;
            flatten.origin.fromArray(args.origin);
            flatten.normal.copy(new Vector3(...args.normal).normalize());
            await flatten.commit();
          } catch (error) {
            failure = error;
            throw error;
          }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      [fromEdges ? "CreateCurveFromEdgesFactory" : "CurveDuplicateFactory", "PlanarizeCurveFactory", "Vector3"],
      [{ ...source, origin: toMeters(planeOriginMm), normal: planeNormal }],
    );
  }
}
