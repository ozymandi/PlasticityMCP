/**
 * Starts Plasticity with a loopback-only renderer CDP endpoint.
 *
 * Plasticity 26.x removes `--remote-debugging-port` during startup, but leaves the Node
 * main-process inspector available. We launch paused with `--inspect-brk`, re-add the switch
 * before any app code runs, then resume. Nothing on disk is modified.
 *
 * The same hook adds switches that keep a covered window drawing (see KEEP_ALIVE_SWITCHES).
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { CdpClient, CdpTarget, EvaluateResult, listTargets } from "./cdp.js";

const execFileAsync = promisify(execFile);

/** The only Plasticity version this adapter is verified against. Internal APIs differ per version. */
export const SUPPORTED_VERSION = "26.1.3";
export const CDP_PORT = 9223;
export const INSPECTOR_PORT = 9229;

const RENDERER_URL_MARKER = "/renderer/app_window/index.html";

// A window that is completely covered by other windows is treated by Chromium as hidden: it
// stops drawing frames and throttles timers, which makes every operation take about two seconds
// and breaks camera navigation and screenshots. These switches keep a covered window alive.
// (A minimized window still does not draw.)
const OCCLUSION_FEATURE = "CalculateNativeWinOcclusion";
const KEEP_ALIVE_SWITCHES = [
  "disable-backgrounding-occluded-windows",
  "disable-renderer-backgrounding",
  "disable-background-timer-throttling",
];

export function defaultExecutable(): string {
  if (process.env.PLASTICITY_EXE) return process.env.PLASTICITY_EXE;
  // Launch the versioned exe directly: the top-level Plasticity.exe is the Squirrel stub
  // and does not forward our arguments.
  const roots = [
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Plasticity"),
    join(process.env.LOCALAPPDATA ?? "", "Plasticity"),
  ];
  for (const root of roots) {
    const exe = join(root, `app-${SUPPORTED_VERSION}`, "Plasticity.exe");
    if (existsSync(exe)) return exe;
  }
  throw new Error(
    `Plasticity ${SUPPORTED_VERSION} not found under ${roots.join(" or ")}. ` +
      `Set PLASTICITY_EXE to the full path of app-${SUPPORTED_VERSION}\\Plasticity.exe.`,
  );
}

/** Plasticity app windows reachable over CDP. Empty if the port is not listening. */
export async function findRendererTargets(port = CDP_PORT): Promise<CdpTarget[]> {
  try {
    const targets = await listTargets(port);
    return targets.filter((t) => t.type === "page" && t.url.includes(RENDERER_URL_MARKER));
  } catch {
    return [];
  }
}

/** App version reported by the CDP endpoint's User-Agent ("… Plasticity/26.1.3 …"). */
export async function getAppVersion(port = CDP_PORT): Promise<string | undefined> {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, { redirect: "manual" });
  const info = (await res.json()) as { "User-Agent"?: string };
  return /Plasticity\/([\d.]+)/.exec(info["User-Agent"] ?? "")?.[1];
}

async function isPlasticityRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", "IMAGENAME eq Plasticity.exe", "/NH", "/FO", "CSV"],
      { encoding: "utf8" },
    );
    return /"Plasticity\.exe"/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Start a program as a process of its own, not a child of this server. A client that stops the
 * server takes the server's children down with it — LM Studio does, and the Plasticity window
 * closed with the work in it. On Windows the process is created by the system's process service
 * (WMI), so it belongs neither to our process tree nor to a job the client put us in.
 */
async function startOnItsOwn(exe: string, args: string[]): Promise<void> {
  if (process.platform === "win32") {
    const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
    const commandLine = [`"${exe}"`, ...args].join(" ");
    const script =
      "$ErrorActionPreference = 'Stop'; " +
      "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ " +
      `CommandLine = ${quote(commandLine)}; CurrentDirectory = ${quote(dirname(exe))} }; ` +
      "if ($r.ReturnValue -ne 0) { exit 1 }";
    try {
      await execFileAsync(
        join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
        { timeout: 20_000, windowsHide: true },
      );
      return;
    } catch (err) {
      const why = (err as Error).message;
      console.error(`[plasticity-mcp] could not start Plasticity on its own (${why}); starting it as a child`);
    }
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await probe();
    if (hit !== undefined) return hit;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function unlockMainProcess(inspector: CdpClient, rendererPort: number): Promise<void> {
  const paused = inspector.once("Debugger.paused");
  await inspector.send("Runtime.enable");
  await inspector.send("Debugger.enable");
  await inspector.send("Runtime.runIfWaitingForDebugger");
  const pause = (await Promise.race([
    paused,
    delay(10_000).then(() => {
      throw new Error("Plasticity main process did not pause at startup");
    }),
  ])) as { callFrames?: Array<{ callFrameId?: string }> };
  const callFrameId = pause.callFrames?.[0]?.callFrameId;
  if (!callFrameId) throw new Error("Plasticity startup call frame is unavailable");

  const evaluation = await inspector.send<EvaluateResult>("Debugger.evaluateOnCallFrame", {
    callFrameId,
    returnByValue: true,
    expression: `(() => {
      const { app } = process.mainModule.require('electron');
      const commandLine = app.commandLine;
      const keep = ${JSON.stringify(["remote-debugging-port", "remote-debugging-pipe", ...KEEP_ALIVE_SWITCHES])};
      const removeSwitch = commandLine.removeSwitch.bind(commandLine);
      commandLine.removeSwitch = (name) => (keep.includes(name) ? undefined : removeSwitch(name));
      // disable-features is a single comma-separated value: merge ours into whatever is set,
      // now and on any later append by the app.
      const appendSwitch = commandLine.appendSwitch.bind(commandLine);
      const withOcclusionOff = (value) =>
        [...new Set([...String(value ?? '').split(',').filter(Boolean), '${OCCLUSION_FEATURE}'])].join(',');
      commandLine.appendSwitch = (name, value) =>
        name === 'disable-features' ? appendSwitch(name, withOcclusionOff(value)) : appendSwitch(name, value);
      commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
      commandLine.appendSwitch('remote-debugging-port', '${rendererPort}');
      commandLine.appendSwitch('disable-features', commandLine.getSwitchValue('disable-features'));
      for (const name of ${JSON.stringify(KEEP_ALIVE_SWITCHES)}) commandLine.appendSwitch(name);
      return { version: app.getVersion() };
    })()`,
  });
  const version = (evaluation.result?.value as { version?: string } | undefined)?.version;
  if (evaluation.exceptionDetails || !version) {
    throw new Error("Plasticity rejected the loopback CDP startup hook");
  }
  await inspector.send("Debugger.resume");
  if (version !== SUPPORTED_VERSION) {
    throw new Error(
      `Launched Plasticity ${version}, but this adapter is pinned to ${SUPPORTED_VERSION}.`,
    );
  }
}

export interface LaunchResult {
  alreadyAvailable: boolean;
  targets: CdpTarget[];
}

/**
 * Make sure a Plasticity window is reachable over CDP. Never closes or restarts a running
 * instance: if Plasticity runs without CDP, the user has to close it themselves.
 */
export async function launchPlasticity(executable?: string): Promise<LaunchResult> {
  const current = await findRendererTargets();
  if (current.length > 0) return { alreadyAvailable: true, targets: current };

  if (await isPlasticityRunning()) {
    throw new Error(
      "Plasticity is running without native access. Save your work, close Plasticity, " +
        "then call native_launch again. Nothing was closed.",
    );
  }

  const exe = executable ?? defaultExecutable();
  if (!existsSync(exe)) throw new Error(`Plasticity executable not found: ${exe}`);
  await startOnItsOwn(exe, [`--inspect-brk=127.0.0.1:${INSPECTOR_PORT}`]);

  const inspectorTarget = await waitFor(
    async () => {
      try {
        return (await listTargets(INSPECTOR_PORT)).find((t) => t.webSocketDebuggerUrl);
      } catch {
        return undefined;
      }
    },
    15_000,
    "the Plasticity main-process inspector",
  );
  const inspector = await CdpClient.connect(inspectorTarget.webSocketDebuggerUrl);
  try {
    await unlockMainProcess(inspector, CDP_PORT);
  } finally {
    inspector.close();
  }

  const targets = await waitFor(
    async () => {
      const found = await findRendererTargets();
      return found.length > 0 ? found : undefined;
    },
    40_000,
    "the Plasticity renderer CDP endpoint",
  );
  return { alreadyAvailable: false, targets };
}
