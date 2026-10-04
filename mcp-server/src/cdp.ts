/**
 * Minimal Chrome DevTools Protocol client (loopback only).
 *
 * Uses the `ws` package on purpose: Node's built-in WebSocket drops the connection (1006)
 * on the large Runtime.getProperties response for Plasticity's app-module closure.
 */
import WebSocket from "ws";

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface RemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  description?: string;
  objectId?: string;
  value?: unknown;
}

export interface PropertyDescriptor {
  name: string;
  value?: RemoteObject;
}

export interface GetPropertiesResult {
  result: PropertyDescriptor[];
  internalProperties?: PropertyDescriptor[];
}

export interface EvaluateResult {
  result: RemoteObject;
  exceptionDetails?: { text?: string; exception?: RemoteObject };
}

const DEFAULT_TIMEOUT_MS = 30_000;

function assertLoopback(url: string): void {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    throw new Error(`CDP access is restricted to loopback, got: ${host}`);
  }
}

/** GET /json/list on a CDP or Node inspector port. Throws if nothing is listening. */
export async function listTargets(port: number): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: "manual" });
  if (!res.ok) throw new Error(`CDP discovery failed with HTTP ${res.status}`);
  const payload: unknown = await res.json();
  if (!Array.isArray(payload)) throw new Error("CDP discovery returned a malformed target list");
  return payload as CdpTarget[];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class CdpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private waiters = new Map<string, Array<(params: unknown) => void>>();
  private closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("close", () => this.onClose());
    ws.on("error", () => this.onClose());
  }

  static connect(webSocketDebuggerUrl: string): Promise<CdpClient> {
    assertLoopback(webSocketDebuggerUrl);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
      ws.once("open", () => resolve(new CdpClient(ws)));
      ws.once("error", (err) => reject(new Error(`CDP connect failed: ${err.message}`)));
    });
  }

  isOpen(): boolean {
    return !this.closed;
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("CDP connection is closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolve with the params of the next event named `method`. */
  once(method: string): Promise<unknown> {
    return new Promise((resolve) => {
      const list = this.waiters.get(method) ?? [];
      list.push(resolve);
      this.waiters.set(method, list);
    });
  }

  close(): void {
    this.ws.close();
    this.onClose();
  }

  private onMessage(raw: string): void {
    const msg = JSON.parse(raw) as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message: string };
    };
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const list = this.waiters.get(msg.method);
      if (!list) return;
      this.waiters.delete(msg.method);
      for (const resolve of list) resolve(msg.params);
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("CDP connection closed"));
    }
    this.pending.clear();
  }
}
