import { describe, expect, it } from "vitest";

import {
  buildTailscaleHttpsUrl,
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  parseTailscaleStatus,
  readTailscaleStatus,
  resolveTailscaleExecutable,
  resolveTailscaleHttpsEndpoint,
  runTailscaleCommand,
  TailscaleServeError,
  TailscaleServeNotEnabledError,
  TailscaleUnavailableError,
  type TailscaleCommandRequest,
  type TailscaleCommandRunner,
} from "../../src/tailscale";

const statusJson = JSON.stringify({
  BackendState: "Running",
  Self: {
    Online: true,
    DNSName: "workstation.example.ts.net.",
    TailscaleIPs: ["100.90.80.70", "100.90..70", "fd7a:115c:a1e0::1", "192.168.1.2"],
  },
});

describe("Tailscale status", () => {
  it("finds the CLI bundled with the macOS app", () => {
    const bundled = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    expect(resolveTailscaleExecutable("darwin", (path) => path === bundled)).toBe(bundled);
    expect(resolveTailscaleExecutable("darwin", () => false)).toBe("tailscale");
  });

  it("parses a running MagicDNS endpoint and Tailnet IPv4 addresses", () => {
    expect(parseTailscaleStatus(statusJson)).toEqual({
      running: true,
      magicDnsName: "workstation.example.ts.net",
      tailnetIpv4Addresses: ["100.90.80.70"],
    });
    expect(buildTailscaleHttpsUrl("workstation.example.ts.net.")).toBe(
      "https://workstation.example.ts.net",
    );
    expect(buildTailscaleHttpsUrl("workstation.example.ts.net", 8443)).toBe(
      "https://workstation.example.ts.net:8443",
    );
  });

  it("uses the platform executable and status arguments", async () => {
    const requests: TailscaleCommandRequest[] = [];
    const runner: TailscaleCommandRunner = async (request) => {
      requests.push(request);
      return { exitCode: 0, stdout: statusJson, stderrLength: 0 };
    };

    await expect(readTailscaleStatus({ platform: "win32", runner })).resolves.toMatchObject({
      running: true,
      magicDnsName: "workstation.example.ts.net",
    });
    expect(requests).toEqual([
      {
        executable: "tailscale.exe",
        args: ["status", "--json"],
        timeoutMs: 1_500,
        captureStdout: true,
      },
    ]);
  });

  it("requires an online MagicDNS identity", async () => {
    const runner: TailscaleCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ BackendState: "NeedsLogin", Self: {} }),
      stderrLength: 0,
    });
    await expect(resolveTailscaleHttpsEndpoint(443, { runner })).rejects.toBeInstanceOf(
      TailscaleUnavailableError,
    );
  });
});

describe("Tailscale HTTPS Serve", () => {
  it("configures and disables the requested HTTPS port without a shell", async () => {
    const requests: TailscaleCommandRequest[] = [];
    const runner: TailscaleCommandRunner = async (request) => {
      requests.push(request);
      return { exitCode: 0, stdout: "", stderrLength: 0 };
    };

    await enableTailscaleHttpsServe("http://127.0.0.1:3773", 8443, {
      executable: "tailscale",
      runner,
    });
    await disableTailscaleHttpsServe(8443, { executable: "tailscale", runner });

    expect(
      requests.map(({ executable, args, captureStdout }) => ({
        executable,
        args,
        captureStdout,
      })),
    ).toEqual([
      {
        executable: "tailscale",
        args: ["serve", "--bg", "--https=8443", "http://127.0.0.1:3773"],
        captureStdout: true,
      },
      {
        executable: "tailscale",
        args: ["serve", "--https=8443", "off"],
        captureStdout: false,
      },
    ]);
  });

  it("rejects non-loopback targets", async () => {
    await expect(enableTailscaleHttpsServe("http://192.168.1.2:3773")).rejects.toBeInstanceOf(
      TailscaleServeError,
    );
  });

  it("surfaces the tailnet enablement link when Serve is not enabled", async () => {
    const runner: TailscaleCommandRunner = async () => ({
      exitCode: 1,
      stdout:
        "Serve is not enabled on your tailnet.\nTo enable, visit:\n\thttps://login.tailscale.com/f/serve?node=nZ8wWAduHu11CNTRL\n",
      stderrLength: 0,
    });

    const failure = await enableTailscaleHttpsServe("http://127.0.0.1:3773", 443, { runner }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(TailscaleServeNotEnabledError);
    expect(failure).toMatchObject({
      enableUrl: "https://login.tailscale.com/f/serve?node=nZ8wWAduHu11CNTRL",
    });
    if (!(failure instanceof Error)) throw new Error("expected the enable operation to fail");
    expect(failure.message).not.toContain("To enable, visit");
  });

  it("reports missing enablement without a link when none can be trusted", async () => {
    const runner: TailscaleCommandRunner = async () => ({
      exitCode: 1,
      stdout: "Serve is not enabled on your tailnet.\nVisit https://evil.example.com/f/serve\n",
      stderrLength: 0,
    });

    await expect(
      enableTailscaleHttpsServe("http://127.0.0.1:3773", 443, { runner }),
    ).rejects.toMatchObject({ name: "TailscaleServeNotEnabledError", enableUrl: null });
  });

  it("kills a serve command that blocks awaiting enablement instead of waiting out the timeout", async () => {
    const script =
      "console.log('Serve is not enabled on your tailnet.');" +
      "console.log('To enable, visit:');" +
      "console.log('https://login.tailscale.com/f/serve?node=abc');" +
      "setInterval(() => {}, 1000);";

    const failure = await runTailscaleCommand({
      executable: process.execPath,
      args: ["-e", script],
      timeoutMs: 4_000,
      captureStdout: true,
      failFastPattern: /https:\/\/login\.tailscale\.com\/f\/serve\S*\s/i,
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(failure).toMatchObject({ name: "TailscaleCommandFailure", kind: "blocked" });
    expect(failure).toMatchObject({
      stdout: expect.stringContaining("login.tailscale.com/f/serve"),
    });
  });

  it("never exposes command output in user-facing errors", async () => {
    const secret = "super-secret-stderr";
    const runner: TailscaleCommandRunner = async () => {
      throw new Error(secret);
    };

    await expect(readTailscaleStatus({ runner })).rejects.toThrow(
      "Tailscale must be installed, connected, and have MagicDNS enabled.",
    );
    await expect(
      enableTailscaleHttpsServe("http://127.0.0.1:3773", 443, { runner }),
    ).rejects.toThrow("Tailscale HTTPS Serve could not be configured.");
    await expect(readTailscaleStatus({ runner })).rejects.not.toThrow(secret);
  });
});
