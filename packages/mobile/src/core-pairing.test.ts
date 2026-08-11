import { describe, expect, it } from "vitest";

import type { PairingGrant, ProvisionalConnection } from "@honk/core/access";

import { CORE_CONNECTION_SCHEMA, type StoredCoreConnection } from "@honk/core/access";
import { adoptCorePairing, type CorePairingOperations } from "./core-pairing";

const current: StoredCoreConnection = {
  schema: CORE_CONNECTION_SCHEMA,
  url: "https://laptop.example.ts.net",
  bearerToken: "old-bearer",
  environmentId: "environment",
  computerLabel: "Laptop",
  device: { id: "old-device", label: "Phone" },
};

const provisional: ProvisionalConnection = {
  connection: { url: current.url, bearerToken: "new-bearer" },
  environmentId: current.environmentId,
  device: { id: "new-device", label: "Phone" },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const makeOperations = (events: string[]): CorePairingOperations => ({
  preview: async () => {
    events.push("preview");
    return {
      protocolVersion: 1,
      environmentId: current.environmentId,
      expiresAt: provisional.expiresAt,
      computerLabel: "Laptop",
    };
  },
  exchange: async (_grant: PairingGrant, input) => {
    events.push(`exchange:${input.replaceDeviceId ?? "new"}`);
    return provisional;
  },
  confirm: async () => {
    events.push("confirm");
    return { environmentId: current.environmentId, device: provisional.device };
  },
  cancel: async () => {
    events.push("cancel");
  },
  probe: async () => {
    events.push("probe");
  },
});

describe("Core pairing", () => {
  it("persists before confirmation and replaces only the same environment", async () => {
    const events: string[] = [];
    const result = await adoptCorePairing(
      {
        url: "honk://connect?origin=https%3A%2F%2Flaptop.example.ts.net#pairing=token",
        requestId: "request-id",
        deviceLabel: "Phone",
        current,
      },
      {
        save: async () => {
          events.push("save");
        },
        restore: async () => {
          events.push("restore");
        },
      },
      makeOperations(events),
    );

    expect(result.connection.bearerToken).toBe("new-bearer");
    expect(events).toEqual(["preview", "exchange:old-device", "save", "confirm"]);
  });

  it("rolls storage back when confirmation and the repair probe both fail", async () => {
    const events: string[] = [];
    const base = makeOperations(events);
    const operations: CorePairingOperations = {
      ...base,
      confirm: async () => {
        events.push("confirm");
        throw new Error("lost response");
      },
      probe: async () => {
        events.push("probe");
        throw new Error("not active");
      },
    };

    await expect(
      adoptCorePairing(
        {
          url: "honk://connect?origin=https%3A%2F%2Flaptop.example.ts.net#pairing=token",
          requestId: "request-id",
          deviceLabel: "Phone",
          current,
        },
        {
          save: async () => {
            events.push("save");
          },
          restore: async () => {
            events.push("restore");
          },
        },
        operations,
      ),
    ).rejects.toThrow("lost response");
    expect(events).toEqual([
      "preview",
      "exchange:old-device",
      "save",
      "confirm",
      "probe",
      "restore",
      "cancel",
    ]);
  });
});
