import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { HostAccess, openHostAccess, type AccessDeviceRecord } from "../../src/host-access";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const existingDevice = (bearerToken = "existing-bearer"): AccessDeviceRecord => ({
  id: "existing-device",
  label: "Existing phone",
  bearerHash: hash(bearerToken),
  createdAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
});

describe("HostAccess", () => {
  it("persists a stable environment identity and only bearer hashes", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-access-"));
    const first = await openHostAccess(dataDirectory);
    const pairing = first.access.issuePairing();
    const provisioned = await first.access.provision(pairing.token, "request-123");
    if (provisioned.status !== "provisional") throw new Error("expected provisional bearer");
    await first.access.confirm(provisioned.device.bearerToken);

    const restarted = await openHostAccess(dataDirectory);
    const raw = await readFile(join(dataDirectory, "access.json"), "utf8");
    expect(restarted.environmentId).toBe(first.environmentId);
    expect(restarted.access.authenticate(provisioned.device.bearerToken)?.id).toBe(
      provisioned.device.id,
    );
    expect(raw).not.toContain(provisioned.device.bearerToken);
    expect((await stat(join(dataDirectory, "access.json"))).mode & 0o777).toBe(0o600);
  });

  it("keeps a provisional bearer inactive until durable confirmation", async () => {
    const persist = vi
      .fn<(devices: readonly AccessDeviceRecord[]) => Promise<void>>()
      .mockResolvedValue();
    const access = new HostAccess([], persist);
    const pairing = access.issuePairing("Phone");
    const provisioned = await access.provision(pairing.token, "request-123", "My phone");

    expect(provisioned.status).toBe("provisional");
    if (provisioned.status !== "provisional") return;
    expect(access.authenticate(provisioned.device.bearerToken)).toBeNull();

    const confirmed = await access.confirm(provisioned.device.bearerToken);
    expect(confirmed).toMatchObject({
      status: "completed",
      device: { id: provisioned.device.id, label: "My phone" },
    });
    expect(access.authenticate(provisioned.device.bearerToken)?.id).toBe(provisioned.device.id);
    expect(persist).toHaveBeenCalledWith([
      expect.objectContaining({ bearerHash: hash(provisioned.device.bearerToken) }),
    ]);
  });

  it("replays one request id but rejects a competing claimant", async () => {
    const access = new HostAccess([], async () => {});
    const pairing = access.issuePairing();
    const first = await access.provision(pairing.token, "stable-request");
    const replay = await access.provision(pairing.token, "stable-request");
    const competitor = await access.provision(pairing.token, "other-request");

    expect(replay).toEqual(first);
    expect(competitor).toEqual({ status: "in-progress" });
  });

  it("does not activate a bearer when persistence fails", async () => {
    const access = new HostAccess([], async () => {
      throw new Error("save failed");
    });
    const pairing = access.issuePairing();
    const provisioned = await access.provision(pairing.token, "request-123");
    if (provisioned.status !== "provisional") throw new Error("expected provisional bearer");

    await expect(access.confirm(provisioned.device.bearerToken)).rejects.toThrow("save failed");
    expect(access.authenticate(provisioned.device.bearerToken)).toBeNull();
  });

  it("restores confirmed devices from persisted bearer hashes", () => {
    const access = new HostAccess([existingDevice()], async () => {});
    expect(access.authenticate("existing-bearer")?.id).toBe("existing-device");
    expect(access.authenticate("wrong-bearer")).toBeNull();
  });

  it("does not revoke a device when its completed invitation is cancelled", async () => {
    const access = new HostAccess([], async () => {});
    const pairing = access.issuePairing();
    const provisioned = await access.provision(pairing.token, "request-123");
    if (provisioned.status !== "provisional") throw new Error("expected provisional bearer");
    await access.confirm(provisioned.device.bearerToken);

    await expect(access.cancelPairing(pairing.id)).resolves.toEqual({
      cancelled: false,
      revokedDeviceID: null,
    });
    expect(access.authenticate(provisioned.device.bearerToken)?.id).toBe(provisioned.device.id);

    await expect(access.revoke(provisioned.device.id)).resolves.toBe(true);
    expect(access.authenticate(provisioned.device.bearerToken)).toBeNull();
  });

  it("revokes a replacement only after the new bearer is confirmed", async () => {
    const access = new HostAccess([existingDevice()], async () => {});
    const pairing = access.issuePairing();
    const provisioned = await access.provision(
      pairing.token,
      "request-123",
      "Replacement phone",
      "existing-device",
    );
    if (provisioned.status !== "provisional") throw new Error("expected provisional bearer");

    expect(access.authenticate("existing-bearer")?.id).toBe("existing-device");
    await access.confirm(provisioned.device.bearerToken);
    expect(access.authenticate("existing-bearer")).toBeNull();
    expect(access.authenticate(provisioned.device.bearerToken)?.id).toBe(provisioned.device.id);
  });
});
