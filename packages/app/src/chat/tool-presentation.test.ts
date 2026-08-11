import { describe, expect, it } from "vitest";

import {
  clipHead,
  clipTail,
  editPatchOf,
  humanizeToolName,
  measurePatch,
  toolBody,
  toolDetail,
  toolVerb,
} from "./tool-presentation";

describe("tool verbs", () => {
  it.each([
    ["read", {}, "Reading", "Read"],
    ["write", {}, "Writing", "Wrote"],
    ["edit", {}, "Editing", "Edited"],
    ["bash", {}, "Running", "Ran"],
    ["websearch", {}, "Searching web", "Searched web"],
    ["task", {}, "Working", "Completed"],
    ["mcp", { tool: "posthog/query" }, "Calling", "Called"],
    ["mcp", { describe: "search_flows" }, "Describing", "Described"],
    ["mcp", { search: "linear" }, "Finding tools", "Found tools"],
    ["mcp", {}, "Checking MCP servers", "Checked MCP servers"],
  ])("%s tenses in place", (name, args, running, settled) => {
    expect(toolVerb(name, args, "running")).toBe(running);
    expect(toolVerb(name, args, "ok")).toBe(settled);
  });

  it("only a failed delegation gets a verb of its own", () => {
    expect(toolVerb("task", {}, "error")).toBe("Work failed");
    // Every other failure keeps its past tense; the row's state tells.
    expect(toolVerb("bash", {}, "error")).toBe("Ran");
  });

  it("a tool this build does not know is named, not hidden", () => {
    expect(toolVerb("apply_patch", {}, "running")).toBe("Running Apply patch");
    expect(toolVerb("apply_patch", {}, "ok")).toBe("Apply patch");
  });
});

describe("tool details", () => {
  it("names each call by its one human argument", () => {
    expect(toolDetail("read", { path: "src/auth.ts" })).toBe("src/auth.ts");
    expect(toolDetail("edit", { path: "src/auth.ts", edits: [] })).toBe("src/auth.ts");
    expect(toolDetail("bash", { command: "pnpm vitest run" })).toBe("pnpm vitest run");
    expect(toolDetail("websearch", { query: "effect schema literals" })).toBe(
      "effect schema literals",
    );
    expect(toolDetail("task", { subagent_type: "review", prompt: "Check the fold" })).toBe(
      "Check the fold",
    );
  });

  it("a task's mission is its description, else the prompt's first line", () => {
    expect(
      toolDetail("task", { description: "Fix the fold", prompt: "Long delegation text" }),
    ).toBe("Fix the fold");
    expect(
      toolDetail("task", { prompt: "\nAudit the store.\nThen report every finding in detail." }),
    ).toBe("Audit the store.");
    const detail = toolDetail("task", { prompt: `${"x".repeat(400)}\nsecond line` });
    expect(detail).toHaveLength(141);
    expect(detail?.endsWith("…")).toBe(true);
  });

  it("humanizes the MCP proxy's machine names", () => {
    expect(toolDetail("mcp", { tool: "posthog/query_insights" })).toBe("Posthog query insights");
    expect(toolDetail("mcp", { search: "linear issues" })).toBe("linear issues");
    expect(toolDetail("mcp", {})).toBeNull();
    expect(humanizeToolName("searchFlows")).toBe("Search Flows");
    expect(humanizeToolName("")).toBe("Tool call");
  });

  it("a detail is a label, so it clips to one line", () => {
    const long = "x".repeat(400);
    const detail = toolDetail("bash", { command: long });
    expect(detail).toHaveLength(141);
    expect(detail?.endsWith("…")).toBe(true);
  });

  it("an argument shape this build cannot read yields nothing", () => {
    expect(toolDetail("read", { path: 7 })).toBeNull();
    expect(toolDetail("read", null)).toBeNull();
    expect(toolDetail("bash", {})).toBeNull();
  });
});

describe("tool bodies", () => {
  it("keeps the newest lines of a command, not the stale head", () => {
    const rolling = `stale:${"x".repeat(2_400)}:newest`;
    const body = toolBody("bash", "ok", rolling);

    expect(body.startsWith("…")).toBe(true);
    expect(body).toContain(":newest");
    expect(body).not.toContain("stale:");
  });

  it("clips everything else from the head", () => {
    const long = `head:${"x".repeat(2_400)}:tail`;
    const body = toolBody("websearch", "ok", long);

    expect(body.startsWith("head:")).toBe(true);
    expect(body.endsWith("…")).toBe(true);
    expect(body).not.toContain(":tail");
  });

  it("a successful read has no body: the file is not evidence about itself", () => {
    expect(toolBody("read", "ok", "1  export const value = 1;")).toBe("");
    // A read that failed still says why.
    expect(toolBody("read", "error", "ENOENT: no such file")).toBe("ENOENT: no such file");
  });

  it("clips only past the cap", () => {
    expect(clipHead("short", 2_400)).toBe("short");
    expect(clipTail("short", 2_400)).toBe("short");
  });
});

describe("edit patches", () => {
  const patch = [
    "--- src/value.ts",
    "+++ src/value.ts",
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const value = 2;",
  ].join("\n");

  it("reads Pi's applied patch off the result details", () => {
    expect(editPatchOf({ patch, diff: "…", firstChangedLine: 1 })).toBe(patch);
  });

  it("a result with no readable patch renders as an ordinary row", () => {
    expect(editPatchOf(undefined)).toBeNull();
    expect(editPatchOf({ patch: "   " })).toBeNull();
    expect(editPatchOf({ patch: 7 })).toBeNull();
    expect(editPatchOf({ sessionId: "child-1" })).toBeNull();
  });

  it("counts the stats from the patch, never from the file headers", () => {
    expect(measurePatch(patch)).toEqual({ added: 1, removed: 1 });
  });
});
