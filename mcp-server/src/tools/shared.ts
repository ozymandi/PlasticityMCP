import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NativeSession } from "../native.js";

/** Shared by the tool families in this folder: the native session, schema pieces, result helpers. */

export type ToolResult = {
  isError?: boolean;
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
};

export type ToolHandler = (rawArgs: unknown) => Promise<ToolResult>;

/** One family of tools: what the client sees and what runs. */
export interface ToolFamily {
  tools: Tool[];
  handlers: Record<string, ToolHandler>;
}

// Native CAD access over CDP (separate channel from the WS bridge).
export const native = new NativeSession();

export const Vec3Mm = z.tuple([z.number(), z.number(), z.number()]);

export const BodyId = z.number().int().nonnegative();

export const BodyIds = z.array(BodyId).min(1);

export const VEC3_SCHEMA = {
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description: "[x, y, z] in millimetres",
};

export const BODY_IDS_SCHEMA = {
  type: "array",
  items: { type: "number" },
  minItems: 1,
  description: "Stable body ids (from list_bodies)",
};

export function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function error(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}
