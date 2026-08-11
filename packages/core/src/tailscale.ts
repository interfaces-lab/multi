/** Node integration for publishing Honk's authenticated listener through Tailscale Serve. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";

import { Option, Schema } from "effect";

const STATUS_TIMEOUT_MS = 1_500;
const SERVE_TIMEOUT_MS = 10_000;
const MAX_STATUS_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_HTTPS_PORT = 443;

export interface TailscaleStatus {
  readonly running: boolean;
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

export interface TailscaleHttpsEndpoint {
  readonly url: string;
  readonly magicDnsName: string;
  readonly tailnetIpv4Addresses: readonly string[];
}

export interface TailscaleCommandRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly captureStdout: boolean;
  // Kills the command as soon as captured stdout matches, instead of waiting for the timeout.
  // Only meaningful together with captureStdout.
  readonly failFastPattern?: RegExp;
}

export interface TailscaleCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderrLength: number;
}

export type TailscaleCommandRunner = (
  request: TailscaleCommandRequest,
) => Promise<TailscaleCommandResult>;

export interface TailscaleCommandOptions {
  readonly platform?: NodeJS.Platform;
  readonly runner?: TailscaleCommandRunner;
  readonly executable?: string;
}

export class TailscaleUnavailableError extends Error {
  constructor() {
    super("Tailscale must be installed, connected, and have MagicDNS enabled.");
    this.name = "TailscaleUnavailableError";
  }
}

export class TailscaleStatusError extends Error {
  constructor() {
    super("Tailscale status could not be read.");
    this.name = "TailscaleStatusError";
  }
}

export class TailscaleServeError extends Error {
  constructor() {
    super("Tailscale HTTPS Serve could not be configured.");
    this.name = "TailscaleServeError";
  }
}

export class TailscaleServeNotEnabledError extends Error {
  constructor(readonly enableUrl: string | null) {
    super(
      enableUrl === null
        ? "Tailscale Serve is not enabled on your tailnet. Enable it in the Tailscale admin console, then try again."
        : `Tailscale Serve is not enabled on your tailnet. Approve it at ${enableUrl}, then try again.`,
    );
    this.name = "TailscaleServeNotEnabledError";
  }
}

class TailscaleCommandFailure extends Error {
  constructor(
    readonly kind: "spawn" | "timeout" | "output" | "blocked",
    readonly executable: string,
    readonly argumentCount: number,
    readonly stdout = "",
  ) {
    super(`Tailscale command failed (${kind}).`);
    this.name = "TailscaleCommandFailure";
  }
}

export function resolveTailscaleExecutable(
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean = existsSync,
): string {
  if (platform === "win32") return "tailscale.exe";
  if (platform !== "darwin") return "tailscale";
  return (
    [
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      "/usr/local/bin/tailscale",
      "/opt/homebrew/bin/tailscale",
    ].find(pathExists) ?? "tailscale"
  );
}

const TailscaleStatusResponse = Schema.Struct({
  BackendState: Schema.optionalKey(Schema.Unknown),
  Self: Schema.optionalKey(Schema.Unknown),
});
const TailscaleSelfResponse = Schema.Struct({
  Online: Schema.optionalKey(Schema.Unknown),
  DNSName: Schema.optionalKey(Schema.Unknown),
  TailscaleIPs: Schema.optionalKey(Schema.Unknown),
});
const decodeTailscaleStatus = Schema.decodeUnknownOption(TailscaleStatusResponse);
const decodeTailscaleSelf = Schema.decodeUnknownOption(TailscaleSelfResponse);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeUnknownArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

const tailnetIpv4AddressOf = (value: string): string | null => {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  const first = octets[0];
  const second = octets[1];
  return first === 100 && second !== undefined && second >= 64 && second <= 127 ? value : null;
};

const normalizedMagicDnsName = (value: unknown): string | null => {
  const decoded = decodeString(value);
  if (Option.isNone(decoded)) return null;
  const normalized = decoded.value.trim().replace(/\.+$/, "");
  if (normalized.length === 0 || normalized.includes("/") || normalized.includes("@")) return null;
  try {
    const url = new URL(`https://${normalized}`);
    return url.hostname === normalized.toLowerCase() ? normalized.toLowerCase() : null;
  } catch {
    return null;
  }
};

export function parseTailscaleStatus(rawStatusJson: string): TailscaleStatus {
  let value: unknown;
  try {
    value = JSON.parse(rawStatusJson);
  } catch {
    throw new TailscaleStatusError();
  }
  const parsed = decodeTailscaleStatus(value);
  if (Option.isNone(parsed)) throw new TailscaleStatusError();

  const self = Option.getOrNull(decodeTailscaleSelf(parsed.value.Self));
  const magicDnsName = normalizedMagicDnsName(self?.DNSName);
  const decodedAddresses = decodeUnknownArray(self?.TailscaleIPs);
  const rawAddresses = Option.isNone(decodedAddresses) ? [] : decodedAddresses.value;
  const tailnetIpv4Addresses = Object.freeze(
    rawAddresses.flatMap((candidate) => {
      const address = decodeString(candidate);
      if (Option.isNone(address)) return [];
      const parsedAddress = tailnetIpv4AddressOf(address.value);
      return parsedAddress === null ? [] : [parsedAddress];
    }),
  );
  const running = parsed.value.BackendState === "Running" && self?.Online !== false;

  return Object.freeze({ running, magicDnsName, tailnetIpv4Addresses });
}

export function buildTailscaleHttpsUrl(
  magicDnsName: string,
  httpsPort = DEFAULT_HTTPS_PORT,
): string {
  const normalized = normalizedMagicDnsName(magicDnsName);
  if (normalized === null) throw new TailscaleStatusError();
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new TailscaleServeError();
  }
  const url = new URL(`https://${normalized}`);
  if (httpsPort !== DEFAULT_HTTPS_PORT) url.port = String(httpsPort);
  return url.origin;
}

export const runTailscaleCommand: TailscaleCommandRunner = (request) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderrLength = 0;
    let stdoutLength = 0;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finish();
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(request.executable, [...request.args], {
        stdio: "pipe",
        windowsHide: true,
        // The macOS app bundle uses this to choose CLI mode instead of opening its window.
        env: { ...process.env, TAILSCALE_BE_CLI: "1" },
      });
      child.stdin.end();
    } catch {
      reject(new TailscaleCommandFailure("spawn", request.executable, request.args.length));
      return;
    }

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() =>
        reject(
          new TailscaleCommandFailure("timeout", request.executable, request.args.length, stdout),
        ),
      );
    }, request.timeoutMs);

    child.once("error", () => {
      settle(() =>
        reject(new TailscaleCommandFailure("spawn", request.executable, request.args.length)),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLength += chunk.byteLength;
      if (stdoutLength > MAX_STATUS_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        settle(() =>
          reject(new TailscaleCommandFailure("output", request.executable, request.args.length)),
        );
        return;
      }
      if (request.captureStdout) stdout += chunk.toString("utf8");
      if (request.failFastPattern?.test(stdout) === true) {
        child.kill("SIGKILL");
        settle(() =>
          reject(
            new TailscaleCommandFailure("blocked", request.executable, request.args.length, stdout),
          ),
        );
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrLength += chunk.byteLength;
    });
    child.once("close", (code) => {
      settle(() =>
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderrLength,
        }),
      );
    });
  });

const commandOptions = (
  options: TailscaleCommandOptions | undefined,
): {
  readonly executable: string;
  readonly runner: TailscaleCommandRunner;
} => ({
  executable:
    options?.executable ?? resolveTailscaleExecutable(options?.platform ?? process.platform),
  runner: options?.runner ?? runTailscaleCommand,
});

export async function readTailscaleStatus(
  options?: TailscaleCommandOptions,
): Promise<TailscaleStatus> {
  const { executable, runner } = commandOptions(options);
  let result: TailscaleCommandResult;
  try {
    result = await runner({
      executable,
      args: ["status", "--json"],
      timeoutMs: STATUS_TIMEOUT_MS,
      captureStdout: true,
    });
  } catch {
    throw new TailscaleUnavailableError();
  }
  if (result.exitCode !== 0) throw new TailscaleUnavailableError();
  return parseTailscaleStatus(result.stdout);
}

export async function resolveTailscaleHttpsEndpoint(
  httpsPort = DEFAULT_HTTPS_PORT,
  options?: TailscaleCommandOptions,
): Promise<TailscaleHttpsEndpoint> {
  const status = await readTailscaleStatus(options);
  if (!status.running || status.magicDnsName === null) throw new TailscaleUnavailableError();
  return Object.freeze({
    url: buildTailscaleHttpsUrl(status.magicDnsName, httpsPort),
    magicDnsName: status.magicDnsName,
    tailnetIpv4Addresses: status.tailnetIpv4Addresses,
  });
}

function normalizedLoopbackTarget(targetOrigin: string): string {
  try {
    const url = new URL(targetOrigin);
    const isLoopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    if (
      url.protocol !== "http:" ||
      !isLoopback ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new TailscaleServeError();
    }
    return url.origin;
  } catch (cause) {
    if (cause instanceof TailscaleServeError) throw cause;
    throw new TailscaleServeError();
  }
}

// When Serve is not enabled on the tailnet, the CLI prints this notice with a per-node
// enablement link and then blocks waiting for the user to approve it in the browser.
const SERVE_NOT_ENABLED_PATTERN = /serve is not enabled|https:\/\/login\.tailscale\.com\/f\/serve/i;

// Fail fast only once the enablement link is fully captured (trailing whitespace proves the
// URL is complete); killing on the notice line alone could truncate the link mid-chunk.
const SERVE_ENABLE_LINK_PATTERN = /https:\/\/login\.tailscale\.com\/f\/serve\S*\s/i;

const serveNotEnabledError = (output: string): TailscaleServeNotEnabledError | null => {
  if (!SERVE_NOT_ENABLED_PATTERN.test(output)) return null;
  // Only a validated login.tailscale.com link may reach users; raw output never does.
  const match = output.match(/https:\/\/login\.tailscale\.com\/f\/serve[^\s"'<>]*/i);
  const enableUrl =
    match !== null && URL.canParse(match[0]) && new URL(match[0]).hostname === "login.tailscale.com"
      ? match[0]
      : null;
  return new TailscaleServeNotEnabledError(enableUrl);
};

export async function enableTailscaleHttpsServe(
  targetOrigin: string,
  httpsPort = DEFAULT_HTTPS_PORT,
  options?: TailscaleCommandOptions,
): Promise<void> {
  const target = normalizedLoopbackTarget(targetOrigin);
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new TailscaleServeError();
  }
  const { executable, runner } = commandOptions(options);
  let result: TailscaleCommandResult;
  try {
    result = await runner({
      executable,
      args: ["serve", "--bg", `--https=${httpsPort}`, target],
      timeoutMs: SERVE_TIMEOUT_MS,
      captureStdout: true,
      failFastPattern: SERVE_ENABLE_LINK_PATTERN,
    });
  } catch (cause) {
    const notEnabled =
      cause instanceof TailscaleCommandFailure ? serveNotEnabledError(cause.stdout) : null;
    throw notEnabled ?? new TailscaleServeError();
  }
  if (result.exitCode !== 0) {
    throw serveNotEnabledError(result.stdout) ?? new TailscaleServeError();
  }
}

export async function disableTailscaleHttpsServe(
  httpsPort = DEFAULT_HTTPS_PORT,
  options?: TailscaleCommandOptions,
): Promise<void> {
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new TailscaleServeError();
  }
  const { executable, runner } = commandOptions(options);
  let result: TailscaleCommandResult;
  try {
    result = await runner({
      executable,
      args: ["serve", `--https=${httpsPort}`, "off"],
      timeoutMs: SERVE_TIMEOUT_MS,
      captureStdout: false,
    });
  } catch {
    throw new TailscaleServeError();
  }
  if (result.exitCode !== 0) throw new TailscaleServeError();
}
