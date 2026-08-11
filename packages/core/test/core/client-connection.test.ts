import { afterEach, describe, expect, it, vi } from "vitest";

import { createHonkClient, type HonkConnection } from "../../src/client";

const connection: HonkConnection = {
  url: "https://laptop.example.ts.net",
  bearerToken: "device-secret",
};

describe("remote Core handshake", () => {
  afterEach(() => vi.restoreAllMocks());

  it("authenticates before constructing an RPC client", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(createHonkClient(connection)).rejects.toMatchObject({
      name: "HonkClientConnectionError",
      reason: "unauthorized",
    });
    expect(fetch).toHaveBeenCalledWith(new URL("https://laptop.example.ts.net/core/v1/handshake"), {
      headers: { authorization: "Bearer device-secret" },
    });
  });

  it("refuses malformed and mismatched protocol fingerprints", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(createHonkClient(connection)).rejects.toMatchObject({
      reason: "invalid_handshake",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ core: 2, pi: "0.83.0" }));
    await expect(createHonkClient(connection)).rejects.toMatchObject({
      reason: "protocol_mismatch",
    });
  });
});
