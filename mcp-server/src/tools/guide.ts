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
2. Refining: the details, then the edges.
3. Merge: union the parts that are one piece in reality, bevel the edges where they meet.
4. Fine detail: knurling, text, screws, threads. Always last.

Rules
- Take sizes from the drawing or the description. Where there is none, estimate and say that it is an estimate.
- Before building anything of more than a few parts, tell the user the plan: the parts, their sizes and where the sizes come from, what will be left out.
- No sharp edges on a finished model: fillet for cast and moulded shapes, chamfer for machined rims and holes. About 1-3 % of the part size; 0.3-0.5 mm on small rims.
- Face, edge and region ids change after every change of a body: read get_body_topology / list_regions again before each call that takes them.
- After every boolean, fillet or chamfer read the returned bounds and face count, then call check_bodies. An operation that succeeded can still give a wrong shape.
- Look at the result after each stage: set_view, then screenshot, from at least two sides. Compare with the drawing and correct before going on.
- Name the bodies (rename_body) and keep the parts of one assembly in a group.
- Undo only your own steps.

More: modelling_guide with topic "drawing", "blocking", "edges", "merge" or "detail" — read the topic before that stage.`;

const TOPICS = {
  drawing: `Working from a drawing
- Read the overall sizes first: width, height, depth. Then the sizes and positions of the main parts.
- Choose the origin on a feature the drawing dimensions from (an axis of symmetry, the axis of the main round feature, a base face) and keep it.
- Views to axes: the front view is the XZ plane seen along +Y (X to the right, Z up); the top view is the XY plane; the side view is the YZ plane.
- Before building, write the list of parts: name, shape, size, position. Mark every number that is not on the drawing as an estimate.
- What the drawing does not show (the back, hidden sides) — ask the user or look for references; do not invent in silence.
- Check: set_view front / top / right (these three are X-ray views) and screenshot; compare outlines and positions with the drawing view by view.`,

  blocking: `Blocking
- One simple body per main volume: create_box, create_cylinder, or a closed create_polyline + extrude_profile for an outline that is not a rectangle.
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
      "edges, merge, detail (knurling, text, threads). Changes nothing, needs no connection.",
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
