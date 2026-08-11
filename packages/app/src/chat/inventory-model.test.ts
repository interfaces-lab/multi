import { describe, expect, it } from "vitest";

import { sessionSummary, type SessionSummaryInput } from "../test-fixtures";
import { agoLabel, initialInventory, inventoryRows, reduceInventory } from "./inventory-model";

const summary = (id: string, overrides: Omit<SessionSummaryInput, "id"> = {}) =>
  sessionSummary({
    id,
    workspaceId: "ws-1",
    directory: "/tmp/project",
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    phase: "idle",
    ...overrides,
  });

describe("inventory fold", () => {
  it("starts connecting and empty", () => {
    expect(initialInventory.status).toBe("connecting");
    expect(initialInventory.sessions).toEqual([]);
  });

  it("each frame replaces the list wholesale and makes the store ready", () => {
    const first = reduceInventory(initialInventory, {
      type: "frame",
      sessions: [summary("a"), summary("b")],
    });
    expect(first.status).toBe("ready");
    expect(first.sessions).toHaveLength(2);

    const second = reduceInventory(first, {
      type: "frame",
      sessions: [summary("b", { title: "Fix tab title generation" })],
    });
    expect(second.sessions.map((row) => row.id)).toEqual(["b"]);
    expect(second.sessions[0]?.title).toBe("Fix tab title generation");
  });

  it("a stream end keeps the last authoritative list, only liveness changes", () => {
    const ready = reduceInventory(initialInventory, { type: "frame", sessions: [summary("a")] });
    const ended = reduceInventory(ready, { type: "stream_ended" });
    expect(ended.status).toBe("disconnected");
    expect(ended.sessions).toHaveLength(1);
  });

  it("failures carry the message", () => {
    const failed = reduceInventory(initialInventory, { type: "failed", message: "boom" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
  });
});

describe("inventory rows", () => {
  it("sorts newest activity first and flags non-idle phases as working", () => {
    const rows = inventoryRows([
      summary("old", { updatedAt: "2026-08-06T09:00:00.000Z" }),
      summary("busy", { updatedAt: "2026-08-06T11:00:00.000Z", phase: "turn" }),
      summary("recent", { updatedAt: "2026-08-06T10:30:00.000Z" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["busy", "recent", "old"]);
    expect(rows.map((row) => row.working)).toEqual([true, false, false]);
  });

  it("preserves Core's generated title in start-page rows", () => {
    const [row] = inventoryRows([summary("a", { title: "Fix tab title generation" })]);
    expect(row?.title).toBe("Fix tab title generation");
  });

  it("an unparseable timestamp sorts last instead of poisoning the order", () => {
    const rows = inventoryRows([
      summary("broken", { updatedAt: "not-a-date" }),
      summary("fine", { updatedAt: "2026-08-06T10:00:00.000Z" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["fine", "broken"]);
  });

  it("keeps delegation-owned sessions inside their parent thread", () => {
    const parent = summary("parent");
    const rows = inventoryRows([
      parent,
      summary("child", {
        delegation: { delegationOf: parent.id, role: "sidekick" },
      }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["parent"]);
  });
});

describe("ago labels", () => {
  const now = Date.parse("2026-08-06T12:00:00.000Z");

  it("uses the home rows' compact vocabulary", () => {
    expect(agoLabel(now, "2026-08-06T11:59:40.000Z")).toBe("now");
    expect(agoLabel(now, "2026-08-06T11:55:00.000Z")).toBe("5m");
    expect(agoLabel(now, "2026-08-06T09:00:00.000Z")).toBe("3h");
    expect(agoLabel(now, "2026-08-04T12:00:00.000Z")).toBe("2d");
  });

  it("an unparseable timestamp reads as now rather than lying with a number", () => {
    expect(agoLabel(now, "not-a-date")).toBe("now");
  });
});
