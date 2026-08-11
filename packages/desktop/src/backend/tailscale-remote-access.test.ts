import { TailscaleServeNotEnabledError } from "@honk/core/tailscale";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import * as HonkCoreHost from "./honk-core-host";
import * as TailscaleRemoteAccess from "./tailscale-remote-access";
import * as DesktopAppSettings from "../settings/desktop-app-settings";

const hostLayer = Layer.succeed(
  HonkCoreHost.HonkCoreHost,
  HonkCoreHost.HonkCoreHost.of({
    connection: { url: "http://127.0.0.1:43123", bearerToken: "owner" },
    environmentId: "environment",
    issuePairing: () => {
      throw new Error("not used");
    },
    pairingState: () => ({ status: "unknown" }),
    cancelPairing: async () => false,
    devices: () => [],
    revokeDevice: async () => false,
  }),
);

const testLayer = (dependencies: TailscaleRemoteAccess.TailscaleRemoteAccessDependencies) =>
  TailscaleRemoteAccess.make(dependencies).pipe(
    Layer.provideMerge(Layer.merge(hostLayer, DesktopAppSettings.layerTest())),
  );

describe("TailscaleRemoteAccess", () => {
  it("publishes the protected Core origin, verifies it, and persists intent", async () => {
    const calls: string[] = [];
    const dependencies: TailscaleRemoteAccess.TailscaleRemoteAccessDependencies = {
      resolveEndpoint: async () => {
        calls.push("resolve");
        return {
          url: "https://laptop.example.ts.net",
          magicDnsName: "laptop.example.ts.net",
          tailnetIpv4Addresses: ["100.64.0.1"],
        };
      },
      enableServe: async (origin) => {
        calls.push(`enable:${origin}`);
      },
      probe: async (url) => {
        calls.push(`probe:${url}`);
      },
      disableServe: async () => {
        calls.push("disable");
      },
    };

    const program = Effect.gen(function* () {
      const access = yield* TailscaleRemoteAccess.TailscaleRemoteAccess;
      const settings = yield* DesktopAppSettings.DesktopAppSettings;
      expect(yield* access.enable).toEqual({
        status: "connected",
        url: "https://laptop.example.ts.net",
      });
      expect((yield* settings.get).tailscaleRemoteAccessEnabled).toBe(true);
      expect(yield* access.disable).toEqual({ status: "disabled" });
      expect((yield* settings.get).tailscaleRemoteAccessEnabled).toBe(false);
    });

    await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(testLayer(dependencies))));
    expect(calls).toEqual([
      "resolve",
      "enable:http://127.0.0.1:43123",
      "probe:https://laptop.example.ts.net",
      "disable",
    ]);
  });

  it("surfaces the trusted Tailscale Serve approval URL", async () => {
    const dependencies: TailscaleRemoteAccess.TailscaleRemoteAccessDependencies = {
      resolveEndpoint: async () => ({
        url: "https://laptop.example.ts.net",
        magicDnsName: "laptop.example.ts.net",
        tailnetIpv4Addresses: [],
      }),
      enableServe: async () => {
        throw new TailscaleServeNotEnabledError("https://login.tailscale.com/f/serve?node=abc");
      },
      probe: async () => {},
      disableServe: async () => {},
    };
    const program = Effect.gen(function* () {
      const access = yield* TailscaleRemoteAccess.TailscaleRemoteAccess;
      expect(yield* access.enable).toMatchObject({
        status: "error",
        reason: "serve_not_enabled",
        enableUrl: "https://login.tailscale.com/f/serve?node=abc",
      });
    });

    await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(testLayer(dependencies))));
  });
});
