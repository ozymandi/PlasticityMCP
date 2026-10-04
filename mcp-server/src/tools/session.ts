import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SUPPORTED_VERSION, launchPlasticity } from "../launcher.js";
import { native, ok, type ToolFamily } from "./shared.js";

/** Native session tools: launch, attach, status and history. */

const NativeLaunchArgs = z.object({
  executable: z.string().optional(),
});

const NativeConnectArgs = z.object({
  targetId: z.string().optional(),
});

const tools: Tool[] = [
  {
    name: "native_launch",
    description:
      `Start Plasticity ${SUPPORTED_VERSION} with native CAD access (loopback-only debugging endpoint). ` +
      "If a window with native access is already available, returns it. Never closes a running " +
      "Plasticity: if it runs without native access, the user must close it first. " +
      "Returns the reachable windows; follow with native_connect.",
    inputSchema: {
      type: "object",
      properties: {
        executable: {
          type: "string",
          description: `Full path to the Plasticity ${SUPPORTED_VERSION} executable (default: auto-detected)`,
        },
      },
    },
  },
  {
    name: "native_connect",
    description:
      "Attach to a Plasticity window for native CAD operations (create_*, undo, redo). " +
      "With several windows open, pass targetId from native_launch. " +
      `Only Plasticity ${SUPPORTED_VERSION} is supported.`,
    inputSchema: {
      type: "object",
      properties: { targetId: { type: "string" } },
    },
  },
  {
    name: "native_status",
    description:
      "Native connection state: connected window, whether Plasticity is busy with a command, " +
      "undo/redo depth, body count, and windowVisible — false when the window is minimized or " +
      "completely covered by other windows, in which case set_view and screenshot cannot work " +
      "(modelling tools still do).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "undo",
    description:
      "Undo the last operation in the connected Plasticity window (native history, same as " +
      "Ctrl+Z). Returns which bodies appeared/disappeared.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "redo",
    description: "Redo the last undone operation in the connected Plasticity window.",
    inputSchema: { type: "object", properties: {} },
  },
];

const handlers: ToolFamily["handlers"] = {
  native_launch: async (rawArgs) => {
    const args = NativeLaunchArgs.parse(rawArgs ?? {});
    const result = await launchPlasticity(args.executable);
    return ok({
      alreadyAvailable: result.alreadyAvailable,
      windows: result.targets.map((t) => ({ targetId: t.id, title: t.title })),
    });
  },

  native_connect: async (rawArgs) => {
    const args = NativeConnectArgs.parse(rawArgs ?? {});
    const target = await native.connect(args.targetId);
    const state = await native.state();
    return ok({
      connected: true,
      window: { targetId: target.id, title: target.title },
      version: SUPPORTED_VERSION,
      bodyCount: state.bodies.length,
      undoDepth: state.undoDepth,
      redoDepth: state.redoDepth,
    });
  },

  native_status: async () => {
    const target = native.getTarget();
    if (!target) return ok({ connected: false, supportedVersion: SUPPORTED_VERSION });
    const state = await native.state();
    return ok({
      connected: true,
      window: { targetId: target.id, title: target.title },
      version: SUPPORTED_VERSION,
      busy: state.busy,
      windowVisible: !state.windowHidden,
      bodyCount: state.bodies.length,
      undoDepth: state.undoDepth,
      redoDepth: state.redoDepth,
    });
  },

  undo: async () => {
    return ok(await native.undo());
  },

  redo: async () => {
    return ok(await native.redo());
  },
};

export const session: ToolFamily = { tools, handlers };
