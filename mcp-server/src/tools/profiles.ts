import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BodyId,
  BOX_SCHEMA,
  BoxMm,
  native,
  ok,
  RegionIds,
  type ToolFamily,
  VEC3_SCHEMA,
  Vec3Mm,
} from "./shared.js";

/** Regions, and solids or sheets made from profiles. */

const oneProfile = (a: { id?: number; profileId?: number; regionIds?: string[] }) =>
  ((a.id ?? a.profileId) === undefined) !== (a.regionIds === undefined);

const ONE_PROFILE_MESSAGE = "pass exactly one of the curve id or regionIds";

const ListRegionsArgs = z.object({ box: BoxMm.optional() });

const REGION_BOX_SLACK_MM = 0.02;

const ExtrudeProfileArgs = z
  .object({
    id: BodyId.optional(),
    regionIds: RegionIds.optional(),
    distance: z.number().refine((d) => d !== 0, "distance must be non-zero"),
    distanceBack: z.number().positive().optional(),
    thickness: z.number().positive().optional(),
  })
  .refine(oneProfile, ONE_PROFILE_MESSAGE);

const RevolveProfileArgs = z
  .object({
    id: BodyId.optional(),
    regionIds: RegionIds.optional(),
    axisOrigin: Vec3Mm,
    axis: Vec3Mm.refine((a) => Math.hypot(...a) > 0, "axis must be non-zero"),
    angle: z
      .number()
      .min(-360)
      .max(360)
      .refine((a) => a !== 0, "angle must be non-zero")
      .optional()
      .default(360),
    thickness: z.number().positive().optional(),
  })
  .refine(oneProfile, ONE_PROFILE_MESSAGE);

const SweepProfileArgs = z
  .object({
    profileId: BodyId.optional(),
    regionIds: RegionIds.optional(),
    pathId: BodyId,
    twist: z.number().optional().default(0),
    scale: z.number().positive().optional().default(1),
    guideIds: z.array(BodyId).max(3).optional(),
    alignment: z.enum(["normal", "parallel"]).optional(),
    corners: z.enum(["mitre", "round"]).optional(),
    thickness: z.number().positive().optional(),
  })
  .refine(oneProfile, ONE_PROFILE_MESSAGE);

const LoftProfilesArgs = z
  .object({
    profileIds: z.array(BodyId).min(2).optional(),
    regionIds: z.array(z.string().min(1)).min(2).optional(),
    guideIds: z.array(BodyId).optional().default([]),
    closed: z.boolean().optional().default(false),
  })
  .refine(
    (a) => (a.profileIds === undefined) !== (a.regionIds === undefined),
    "pass exactly one of profileIds or regionIds",
  );

const REGION_IDS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description: "Region ids from list_regions (alternative to the curve id)",
};

const tools: Tool[] = [
  {
    name: "list_regions",
    description:
      "List the regions Plasticity has built from closed loops of curves — one per enclosed " +
      "area, so a rectangle with a circle inside gives a ring (holes: 1) and a disc. A profile " +
      "drawn as several curves (lines and arcs) also shows up as a region. Each entry: id, " +
      "approximate bounds in millimetres (about 0.01 mm accurate), plane normal, number of " +
      "boundary edges, total boundary length, number of holes. Pass the ids as `regionIds` to " +
      "extrude_profile, revolve_profile, sweep_profile or loft_profiles. IMPORTANT: region ids " +
      "are valid only until curves in that plane change — re-read after creating, moving or " +
      "deleting curves. Text and overlapping curves give many regions: `box` ({min, max}) " +
      "lists only the regions whose bounds lie inside it (`count` is then the number listed, " +
      "`total` the number in the document).",
    inputSchema: { type: "object", properties: { box: BOX_SCHEMA } },
  },
  {
    name: "extrude_profile",
    description:
      "Extrude a curve by `distance` millimetres along the normal of its plane. A closed planar " +
      "curve becomes a Solid, an open curve becomes a Sheet; the new body is in `created` and " +
      "the curve is kept. Positive distance follows the plane normal (+Z for curves in the XY " +
      "plane, the `normal` given to create_circle), negative goes the other way — check the " +
      "returned bounds. A curve `id` is refused when its profile is ambiguous (other curves " +
      "in the same plane cross it or lie inside it); in that case, or for a profile made of " +
      "several curves, pass `regionIds` from list_regions instead of `id` — several regions " +
      "are extruded as one profile. `distanceBack` (millimetres) extrudes the other way too, so " +
      "the body spans distance + distanceBack across the plane. `thickness` (millimetres) makes a " +
      "wall of that thickness around the profile instead of a filled section — a tube from a " +
      "circle, a thin plate from an open curve. Undoable.",
    inputSchema: {
      type: "object",
      required: ["distance"],
      properties: {
        id: { type: "number", description: "Stable id of the curve (Wire)" },
        regionIds: REGION_IDS_SCHEMA,
        distanceBack: { type: "number", description: "Millimetres extruded the other way" },
        thickness: { type: "number", description: "Wall thickness in millimetres" },
        distance: { type: "number" },
      },
    },
  },
  {
    name: "revolve_profile",
    description:
      "Revolve a curve around an axis: a closed planar curve becomes a Solid, an open curve a " +
      "Sheet; the new body is in `created` and the curve is kept. The axis passes through " +
      "`axisOrigin` along `axis`; it must lie in the plane of the profile and must not pass " +
      "through it. `angle` in degrees (default 360) follows the right-hand rule around `axis`; " +
      "negative turns the other way. A curve `id` is refused when its profile is ambiguous " +
      "(other curves in its plane cross it or lie inside it); pass `regionIds` from " +
      "list_regions instead to choose the regions. `thickness` (millimetres, open profiles " +
      "only) gives the revolved surface a wall inside it, keeping its outer size — a revolve " +
      "then a thicken, two undo steps. For a section that changes on its way round use " +
      "sweep_profile with rails along a circular path. Undoable.",
    inputSchema: {
      type: "object",
      required: ["axisOrigin", "axis"],
      properties: {
        id: { type: "number", description: "Stable id of the profile curve (Wire)" },
        regionIds: REGION_IDS_SCHEMA,
        axisOrigin: VEC3_SCHEMA,
        axis: { ...VEC3_SCHEMA, description: "Axis direction [x, y, z]" },
        angle: { type: "number", default: 360, description: "Degrees, -360..360, non-zero" },
        thickness: { type: "number", description: "Wall thickness in millimetres (open profiles)" },
      },
    },
  },
  {
    name: "sweep_profile",
    description:
      "Sweep a profile curve along a path curve: a closed planar profile becomes a Solid, an " +
      "open one a Sheet; the new body is in `created`, both curves are kept. Draw the profile " +
      "perpendicular to the start of the path; a profile drawn away from the path keeps that " +
      "offset. Corners of a polyline path are mitred. `twist` (degrees, default 0) rotates the " +
      "profile gradually along the path, `scale` (default 1) is its relative size at the end. " +
      "A curve `profileId` is refused when its profile is ambiguous — note that a path lying " +
      "in the profile's own plane and crossing it makes it so; pass `regionIds` from " +
      "list_regions instead to choose the regions. A path made of several pieces must first " +
      "be merged with join. Rails (`guideIds`, 1–3 curves starting on the profile and running " +
      "along the path) reshape the section: one rail pulls its side out, two opposite rails " +
      "scale it evenly, a third controls the other direction; rails override twist and scale. " +
      "`alignment` normal (default; the section turns with the path) / parallel (it keeps its " +
      "start orientation, so the end face stays parallel to the start); " +
      "`corners` mitre (default) / round at the corners of a polyline path; `thickness` " +
      "(millimetres) sweeps a wall instead of a full section; where Plasticity's own wall fails " +
      "(seen on a rail-swept open section) the section is swept as a surface and thickened, half " +
      "to each side (`thickenedAfterSweep: true`, two undo steps). Undoable.",
    inputSchema: {
      type: "object",
      required: ["pathId"],
      properties: {
        profileId: { type: "number", description: "Stable id of the profile curve (Wire)" },
        regionIds: REGION_IDS_SCHEMA,
        pathId: { type: "number", description: "Stable id of the path curve (Wire)" },
        twist: { type: "number", default: 0 },
        guideIds: { type: "array", items: { type: "number" }, maxItems: 3, description: "Rail curves" },
        alignment: { type: "string", enum: ["normal", "parallel"] },
        corners: { type: "string", enum: ["mitre", "round"] },
        thickness: { type: "number", description: "Wall thickness in millimetres" },
        scale: { type: "number", default: 1 },
      },
    },
  },
  {
    name: "loft_profiles",
    description:
      "Loft a body through two or more profile curves, in the given order. Closed planar " +
      "profiles give a Solid, open curves give a Sheet; the two kinds cannot be mixed. The new " +
      "body is in `created`, the curves are kept. `guideIds` are curves that touch the " +
      "profiles and steer the surface between them. `closed` joins the last profile back to " +
      "the first (3+ profiles); it works for open curves, but Plasticity refuses a closed loop " +
      "of closed profiles — use revolve_profile or sweep_profile for ring-shaped solids. " +
      "Profiles that turn through more than about half a circle in total also fail. Bounds of " +
      "lofted bodies can be a few microns large. Instead of `profileIds`, `regionIds` from " +
      "list_regions (2+, in loft order) loft a Solid through chosen regions. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        profileIds: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          description: "Stable ids of the profile curves, in loft order",
        },
        regionIds: { ...REGION_IDS_SCHEMA, minItems: 2 },
        guideIds: { type: "array", items: { type: "number" } },
        closed: { type: "boolean", default: false },
      },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  list_regions: async (rawArgs) => {
    const { box } = ListRegionsArgs.parse(rawArgs ?? {});
    const all = await native.listRegions();
    if (!box) return ok({ count: all.length, regions: all });
    // Bounds come from the display mesh, about 0.01 mm accurate: the box gets that much slack.
    const inside = (p: number[], low: number[], high: number[]) =>
      p.every((v, i) => v >= low[i] - REGION_BOX_SLACK_MM && v <= high[i] + REGION_BOX_SLACK_MM);
    const regions = all.filter(
      (r) => inside(r.boundsMm.min, box.min, box.max) && inside(r.boundsMm.max, box.min, box.max),
    );
    return ok({ count: regions.length, total: all.length, regions });
  },

  extrude_profile: async (rawArgs) => {
    const args = ExtrudeProfileArgs.parse(rawArgs ?? {});
    return ok(await native.extrudeProfile((args.id ?? args.regionIds)!, args.distance, {
      backMm: args.distanceBack,
      thicknessMm: args.thickness,
    }));
  },

  revolve_profile: async (rawArgs) => {
    const args = RevolveProfileArgs.parse(rawArgs ?? {});
    const profile = (args.id ?? args.regionIds)!;
    if (args.thickness !== undefined) {
      return ok(await native.revolveShell(profile, args.axisOrigin, args.axis, args.angle, args.thickness));
    }
    return ok(await native.revolveProfile(profile, args.axisOrigin, args.axis, args.angle));
  },

  sweep_profile: async (rawArgs) => {
    const args = SweepProfileArgs.parse(rawArgs ?? {});
    if (args.thickness !== undefined) {
      return ok(
        await native.sweepWithThickness((args.profileId ?? args.regionIds)!, args.pathId, args.twist, args.scale, {
          guideIds: args.guideIds,
          alignment: args.alignment,
          corners: args.corners,
          thicknessMm: args.thickness,
        }),
      );
    }
    return ok(
      await native.sweepProfile(
        (args.profileId ?? args.regionIds)!,
        args.pathId,
        args.twist,
        args.scale,
        {
          guideIds: args.guideIds,
          alignment: args.alignment,
          corners: args.corners,
          thicknessMm: args.thickness,
        },
      ),
    );
  },

  loft_profiles: async (rawArgs) => {
    const args = LoftProfilesArgs.parse(rawArgs ?? {});
    return ok(
      await native.loftProfiles((args.profileIds ?? args.regionIds)!, args.guideIds, args.closed),
    );
  },
};

export const profiles: ToolFamily = { tools, handlers };
