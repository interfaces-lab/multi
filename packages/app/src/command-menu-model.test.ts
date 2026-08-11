import { describe, expect, it } from "vitest";

import { rankCommandMenuItems } from "./command-menu-model";
import { sessionSummary } from "./test-fixtures";

const thread = sessionSummary({
  id: "ses_1",
  workspaceId: "ws_1",
  directory: "/repo/honk",
  title: "Fix tab title generation",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
  phase: "idle",
});

const threadRows = (query: string) =>
  rankCommandMenuItems({ door: "threads", query, threads: [thread] }).filter(
    (item) => item.kind === "thread",
  );

describe("command menu thread titles", () => {
  it("renders and searches Core's generated title", () => {
    expect(threadRows("")[0]?.title).toBe("Fix tab title generation");
    expect(threadRows("tab title")).toHaveLength(1);
  });

  it("keeps the workspace path searchable after the displayed title changes", () => {
    expect(threadRows("honk")).toHaveLength(1);
    expect(threadRows("/repo/honk")).toHaveLength(1);
  });
});
