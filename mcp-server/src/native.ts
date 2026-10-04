/**
 * Native CAD access to a running Plasticity window over CDP.
 *
 * Plasticity exposes no globals, but `editor` and every Factory class are reachable through the
 * closure scopes of the <command-log> element's `handleCommandStarted` callback. We keep remote
 * object references to them and run operations with Runtime.callFunctionOn — a native command is
 * constructed from `editor.commands`, its `execute` is replaced with a parameterised factory
 * call, and it goes through `editor.exec`, so results are real B-Rep with native Undo/Redo.
 *
 * This is an unofficial integration against internal APIs, pinned to SUPPORTED_VERSION.
 * Public units are millimetres; Plasticity's internal units are metres.
 */
import { ViewTools } from "./native/view.js";

export * from "./native/types.js";

/** Every native tool family in one session object; the families live in src/native/. */
export class NativeSession extends ViewTools {}
