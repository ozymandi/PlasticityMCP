import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolFamily } from "./shared.js";

/**
 * The modelling rules, served by the server itself: a client without the skill
 * (skills/plasticity-mcp) gets them through a tool call. A condensed form of that skill —
 * when a rule changes there, change it here.
 */

/** Sent to the client at connection; clients that support it show it to the model. */
export const SERVER_INSTRUCTIONS =
  "Models real CAD geometry in a running Plasticity window. Units are millimetres and degrees, " +
  "Z is up. Before modelling call modelling_guide and follow it.";

const RULES = `Plasticity modelling rules

Basics
- Units: millimetres and degrees. Z is up. The front view looks along +Y, so the front of a model faces -Y.
- Start: native_status; when not connected, native_connect; when Plasticity is not running, native_launch. Never close Plasticity.
- If the tool list has find_tools: tools that are not listed are found with it and run with call_tool.

Order of work — finish a stage for the whole model before the next one
1. Blocking: the main volumes as simple bodies, in the right sizes and places. From large to small: no part gets details while another is still missing.
   Seating, right after blocking: a separate part that goes into another is not poked into it. Copy it, scale the copy up a little (a gap of 0.2-0.5 mm on a hand-sized part), boolean difference the copy from the receiving part, then seat the original. The gap gives extra edges and a thin shadow line. Chamfer the rim of every socket right after cutting it (0.2-0.4 mm).
2. Refining: the details, then the edges.
3. Merge: union the parts that are one piece in reality, bevel the edges where they meet.
4. Fine detail: knurling, text, screws, threads. Always last.

Rules
- Take sizes from the drawing or the description. Where there is none, estimate and say that it is an estimate.
- Before building anything of more than a few parts, tell the user the plan: the parts, their sizes and where the sizes come from, what will be left out.
- Choose the way to build a form by its kind: straight walls - extrude a profile; round - revolve; sections that change along the length - loft; one section along a path - sweep; free forms - curves and patches. Boxes and cylinders are only for boxy and round parts.
- No sharp edges on a finished model: fillet for cast and moulded shapes, chamfer for machined rims and holes. About 1-3 % of the part size; 0.3-0.5 mm on small rims.
- Face, edge and region ids change after every change of a body: read get_body_topology / list_regions again before each call that takes them.
- After every boolean, fillet or chamfer read the returned bounds and face count, then call check_bodies. An operation that succeeded can still give a wrong shape.
- Look at the result after each stage: set_view, then screenshot, from at least two sides. Compare with the drawing and correct before going on.
- Name the bodies (rename_body) and keep the parts of one assembly in a group.
- Undo only your own steps.

Before saying it is done
- Every stage is finished for the whole model, or you say which one is not.
- All outer edges are treated; all bodies pass check_bodies.
- Helper curves and sheets are deleted.
- Screenshots from the same sides as the reference were compared with it, and the differences are corrected or named.
- What is estimated or left out is said, not left for the user to find.

More: modelling_guide topic "drawing", "blocking", "edges", "merge", "detail", "surfacing" (free forms), "tools" (tool per job), "pitfalls" — read it before that stage.`;

const TOPICS = {
  pitfalls: `Pitfalls (field-tested)
- extrude_profile does not consume the source curve: the Wire stays in the scene. Delete every helper curve at the end.
- A default create_polygon (normal +Z) extrudes toward -Z. For an upward extrude pass normal [0, 0, -1]. Always check the returned bounds.
- A boolean union with a tool that does not touch the target does nothing ("Operation has no effect") and is not an error. After several unions check that the bounds grew; a missing part shows as bounds that never grew.
- Chamfering all edges of a box in one call can fail (error 1033) on good geometry: chamfer in groups - long parallel edges first, then the rim loops - or edge by edge.
- A chamfer over a long polygon rim (8-12 edges) with a large distance can give an invalid body without an error. Then chamfer that rim one edge at a time, long edges first, a smaller distance on short pieces, and run check_bodies after every chamfer batch on complex rims.
- Parameter names: copy_bodies and move_bodies take delta (not offset); delete_bodies takes ids (not bodyIds); create_cylinder takes base (not position); move_bodies returns changed, not bodies.
- Never delete bodies by name: one name can match the original and every copy. Keep explicit id lists and delete by id.
- Never trust the order of a saved id list: before a batch move or delete, check what each id is in list_bodies (name and the centre of its bounds) and give each body its own move; afterwards check every centre against its target. A success flag says nothing about which body went where.
- A sweep rail steers the whole section: an edge free between the rails can be lifted or dropped (a windscreen's bottom edge at 830 instead of 765). Check the edges that matter after a rail sweep and correct them with scale_bodies or one more rail.
- The full inner loop of a deep pocket (a wheel well) refuses a fillet (16063): fillet the visible rim alone and say the hidden edges stay sharp.
- loft_edges takes one edge per end: an opening bounded by several edges cannot be an end - fill it with patch, or loft from a curve made with curves_from_edges and join.`,
  surfacing: `Free-form surfacing (Indie licence)
When: a loft through closed sections is fine for one body that does not branch, with sections close together. Use curves and patches when the form branches (a wing out of a body), must flow tangentially into another surface, needs a cap or dome, or when sparse sections bulge.

Curves carry the tangents
- create_spline with controlPoints: true. The curve leaves its first point along the first leg of the control polygon (the tangent); the leg length is the tension; the third point sets the curvature. To leave a symmetry plane at a right angle, put the second point on the plane's normal.
- Two curves meet tangentially when the last-but-one point of one, the shared point and the second point of the other lie on one line. bridge joins curve ends with G1 / G2.
- A spline through points (without controlPoints) overshoots between far points: use it only through dense points.

Surfaces
- Opening in a Sheet: patch with id + edgeIds and continuity "G1" (tangent dome) or "G2". One value for the whole loop. Single topology and smooth smoothness only on a boundary without corners. guideIds must end exactly at boundary vertices.
- From the edge of one surface to the edge of another: loft_edges with tangency "clamped" and join: true. On a tight bend lower startMagnitude / endMagnitude (0.6 for a 90° elbow of 10 mm tubes).
- Section changing along a path: sweep_profile with 1-3 rails (guideIds); alignment "parallel" keeps the end face parallel to the start.
- Shells: revolve_profile or extrude_profile with thickness; thicken a Sheet.
- Blend two Sheets: bridge_surface (width larger than the gap; shape "conic" for a round blend; trimWalls: false for a separate Sheet).
- Close the volume with join; symmetric forms: one half, mirror_bodies, join.

Edges and checks
- fillet with shape "g2" for moulded edges (G2 seams); on many edges at once it can fail where a round fillet works - fewer edges per call.
- Fillet only sharp edges: measure_continuity, keep the edges G0 with an angle above about 5°.
- Check seams with measure_continuity. A body with boundsApproximate: true has spline faces - check its size with a boolean or set_section_view, not with the bounds.

Recipes
- Tangent nose or dome on a tube: control-polygon spline whose second point is straight above the first, revolve_profile, then join with the tube whose top face was removed (delete_faces with heal: false). The seam is G1.
- Fins, wings, handles: boolean union first, then a G2 root blend (fillet shape "g2" on the edges between a body face and a part face), then round the outer edges. Rounding the outer edges first makes the root blend fail.
- Rounded ends of a lofted body: delete_faces the flat ends with heal: false, patch each opening with continuity "G1".
- Quick car or product body: extrude the side outline, the plan outline and a cross-section through each other, one boolean intersection, round the sharp edges; cut wheel arches no deeper than the sill.
- Pipe elbow or branch: open tube ends, loft_edges clamped, join.`,
  tools: `Which tool for which job
- Straight walls from an outline: extrude_profile (distanceBack, thickness for a wall).
- Round part from a half section: revolve_profile (thickness for a shell).
- Sections that change along the length: loft_profiles (guideIds).
- Surface from edge to edge, tangent to the neighbours: loft_edges.
- One section along a path: sweep_profile (rails, alignment, corners).
- Bar or tube along a curve: pipe (sides for a polygon bar, twist).
- Close an opening, a dome, a cap: patch (continuity, topology, guideIds).
- Blend two Sheets: bridge_surface.
- Copies along a curve (chain links, rivets, ribs): array_curve. Around an axis: array_radial. In a grid: array_rectangular.
- Mirror a half: mirror_bodies.
- Split a body with a curve or a face: cut.
- Sheets into one or into a Solid, curves end to end: join; take apart: unjoin.
- Shell a Solid: hollow. Give a Sheet or faces a thickness: thicken.
- Parallel copy of curves or faces: offset.
- More control points on a curve or face: raise_degree. Clean up or lighten: rebuild.
- Project curves onto a body: project. Put curves or a body into faces as edges: imprint, then complete_edges.
- Round or bevel edges: fillet (shape round / conic / g2), chamfer (distance2 for an asymmetric bevel).
- Draft angle for moulding: draft_faces. Make faces flush with a reference face: match_faces.
- Continue a Sheet past its edge: extend.
- Wrap a flat detail onto a curved face: unwrap_faces, then deform (offsetNormal lifts it off the face).`,
  drawing: `Working from a drawing
- Read the overall sizes first: width, height, depth. Then the sizes and positions of the main parts.
- Choose the origin on a feature the drawing dimensions from (an axis of symmetry, the axis of the main round feature, a base face) and keep it.
- Views to axes: the front view is the XZ plane seen along +Y (X to the right, Z up); the top view is the XY plane; the side view is the YZ plane.
- Before building, write the list of parts: name, shape, size, position. Mark every number that is not on the drawing as an estimate.
- What the drawing does not show (the back, hidden sides) — ask the user or look for references; do not invent in silence.
- Check: set_view front / top / right and screenshot; compare outlines and positions with the drawing view by view. If the screenshots come out X-ray, the window's X-ray toggle is on - ask the user to turn it off.`,

  blocking: `Blocking
- One simple body per main volume: create_box, create_cylinder, or a closed create_polyline + extrude_profile for an outline that is not a rectangle.
- A plate or a wall of any outline: draw the closed outline, extrude_profile by the thickness.
- A form whose section changes along its length: draw closed sections at several stations (create_polyline, create_spline, create_ellipse, create_circle on parallel planes) and loft_profiles through them in order.
- A constant section along a path: draw the path curve and the closed section, sweep_profile.
- A symmetric form: build one half, mirror_bodies, boolean union.
- Right sizes and places first, no details and no rounded edges yet.
- Round parts (shafts, knobs, rings, bosses): draw half of the section as a closed polyline and revolve_profile it around the axis; chamfers can be drawn into the section.
- extrude_profile does not always go the way the sign suggests: read the returned bounds and correct with move_bodies.
- Let a part that will be united later run a little into its neighbour instead of only touching it.
- Check against the drawing from the front, the top and the side before refining.`,

  edges: `Edges
- Treat a body's edges while it is still simple, before text and small pockets: afterwards it has hundreds of edges.
- Go through all outer edges of a body, not only the ones facing the camera.
- Picking edges on a detailed body: get_body_topology with include "edges" and a thin \`box\` around the plane or line where they are, and \`kinds\` (line / circle / curve). A full listing is very long.
- Edges that meet in one vertex go into one fillet call with one radius. Corners first and the loop after is refused.
- A closed loop of edges takes a chamfer. An open chain that refuses a chamfer often takes a fillet of the same size.
- A fillet that is too large does not fail — it gives another shape. Check the bounds, the face count and a screenshot.
- Cheaper than filleting a solid: round the corners of the profile curve first (fillet / chamfer on the curve), then extrude.
- A seam between two flush bodies is not a sharp edge; an outer rim is.
- If an edge cannot be treated, say which one and why.`,

  merge: `Merge
- One piece: fixed parts that touch and are one part in reality (a housing and its bosses, ribs and lugs). Use boolean union.
- Stay separate: moving parts (whatever turns, slides or is pressed), removable parts (covers, lids, fasteners), parts that are separate pieces in reality.
- After the union bevel the junction: pick its edges with get_body_topology (include "edges", a thin \`box\` around the junction), then chamfer a closed loop or fillet an open chain.
- A junction can be bevelled only where the joined part ends on the body. A part that runs past the body leaves an edge that cannot be bevelled — keep such a part separate.
- Do not round a rim that will end up inside a junction.`,

  detail: `Fine detail — after everything else
- Knurling on a knob of radius R: a closed zig-zag polyline around the axis (points alternating R + 0.25 and R - 0.35), a circle a little larger around it, list_regions, extrude_profile the ring between them to the height of the band, boolean difference from the knob.
- Pyramid grip on a round handle: unwrap_faces of the grip wall, on the flat Sheet a thin plate with one row of small pyramids (loft_profiles from a square to a very small square, array_rectangular), union the row, array the rows, union them into the plate, deform the one body onto the wall. Delete the Sheet.
- Chamfer the rim of engraved text (0.05-0.1 mm). Letters can hold a tiny segment that makes the whole call fail: leave it out of the chain.
- Text on a flat face: create_text on that face, list_regions, extrude_profile the letter regions (not the holes inside letters) into the body, boolean difference. The region normal decides which way a positive distance goes: read it and the returned bounds.
- Text on a cylinder: unwrap_faces the wall, make the letter solids on the flat sheet, deform them onto the wall, boolean difference.
- Thread: create_spiral with a whole number of turns, a small triangle profile, sweep_profile, trim with a box (boolean intersection) where it sticks out, then boolean with the part.
- Screws and other small hardware: revolve_profile, then copy_bodies to each place.
- Delete helper curves and sheets when the detail is done.`,
} as const;

type Topic = keyof typeof TOPICS;
const TOPIC_NAMES = Object.keys(TOPICS) as [Topic, ...Topic[]];

const GuideArgs = z.object({ topic: z.enum(TOPIC_NAMES).optional() });

const tools: Tool[] = [
  {
    name: "modelling_guide",
    description:
      "Read this first: the rules of modelling with this server — order of work, edges, ids, " +
      "checking the result. Call it once before building anything; no arguments. With `topic` " +
      "it gives the detailed rules of one stage: drawing (working from a drawing), blocking, " +
      "edges, merge, detail (knurling, text, threads), surfacing (free forms: curves, patches, " +
      "tangents, combined recipes), tools (which tool for which job), pitfalls (known traps: " +
      "silent no-ops, chamfer batches, parameter names, id lists). Changes nothing, needs no " +
      "connection.",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string", enum: TOPIC_NAMES } },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  modelling_guide: async (rawArgs) => {
    const args = GuideArgs.parse(rawArgs ?? {});
    return { content: [{ type: "text", text: args.topic === undefined ? RULES : TOPICS[args.topic] }] };
  },
};

export const guide: ToolFamily = { tools, handlers };
