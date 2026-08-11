import { describe, expect, it } from "vitest";

import { buildDiffOptions, parseUnifiedPatchRows } from "./diff-rendering";

describe("buildDiffOptions", () => {
  it("scrolls long lines by default", () => {
    expect(buildDiffOptions("light", "unified").overflow).toBe("scroll");
  });

  it("wraps long lines when requested", () => {
    expect(buildDiffOptions("dark", "split", true).overflow).toBe("wrap");
  });

  it("leaves the gutter single-column when no patch is supplied", () => {
    expect(buildDiffOptions("light", "unified")).not.toHaveProperty("onPostRender");
  });

  it("attaches the dual-number gutter hook when a patch is supplied", () => {
    expect(buildDiffOptions("light", "unified", false, "@@ -1 +1 @@\n-a\n+b\n")).toHaveProperty(
      "onPostRender",
      expect.any(Function),
    );
  });

  // Vitest runs this package without a DOM, so the gutter cells are stubbed down
  // to the two attribute accessors the hook uses.
  it("writes the counterpart number onto context rows only, once per phase", () => {
    const cells = [
      stubGutterCell("context", 10),
      stubGutterCell("change-deletion", 11),
      stubGutterCell("change-addition", 11),
      stubGutterCell("change-addition", 12),
      stubGutterCell("context", 13),
    ];
    const node = { querySelectorAll: () => cells } as unknown as HTMLElement;
    const instance = {} as never;
    const options = buildDiffOptions(
      "dark",
      "unified",
      false,
      ["@@ -10,4 +10,5 @@", " alpha", "-beta", "+gamma", "+delta", " epsilon", ""].join("\n"),
    );

    options.onPostRender?.(node, instance, "mount");
    expect(cells.map((cell) => cell.attributes["data-alt-number"])).toEqual([
      "10",
      "",
      "",
      "",
      "12",
    ]);

    options.onPostRender?.(node, instance, "update");
    expect(cells.map((cell) => cell.attributes["data-alt-number"])).toEqual([
      "10",
      "",
      "",
      "",
      "12",
    ]);
  });
});

function stubGutterCell(lineType: string, columnNumber: number) {
  return {
    attributes: {
      "data-line-type": lineType,
      "data-column-number": `${columnNumber}`,
    } as Record<string, string>,
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
  };
}

describe("parseUnifiedPatchRows", () => {
  it("numbers context, deletion, and addition rows in gutter order", () => {
    const rows = parseUnifiedPatchRows(
      ["@@ -10,4 +10,5 @@", " alpha", "-beta", "+gamma", "+delta", " epsilon", ""].join("\n"),
    );
    expect(rows).toEqual([
      { kind: "context", originalLineNumber: 10, modifiedLineNumber: 10 },
      { kind: "deletion", originalLineNumber: 11, modifiedLineNumber: undefined },
      { kind: "addition", originalLineNumber: undefined, modifiedLineNumber: 11 },
      { kind: "addition", originalLineNumber: undefined, modifiedLineNumber: 12 },
      { kind: "context", originalLineNumber: 12, modifiedLineNumber: 13 },
    ]);
  });

  it("restarts numbering at every hunk header and skips file headers", () => {
    const rows = parseUnifiedPatchRows(
      [
        "diff --git a/file.ts b/file.ts",
        "index 1234567..89abcde 100644",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,2 +1,2 @@",
        "-one",
        "+uno",
        " two",
        "@@ -20,3 +20,2 @@ function scope()",
        " twenty",
        "-twentyone",
        " twentytwo",
      ].join("\n"),
    );
    expect(rows).toEqual([
      { kind: "deletion", originalLineNumber: 1, modifiedLineNumber: undefined },
      { kind: "addition", originalLineNumber: undefined, modifiedLineNumber: 1 },
      { kind: "context", originalLineNumber: 2, modifiedLineNumber: 2 },
      { kind: "context", originalLineNumber: 20, modifiedLineNumber: 20 },
      { kind: "deletion", originalLineNumber: 21, modifiedLineNumber: undefined },
      { kind: "context", originalLineNumber: 22, modifiedLineNumber: 21 },
    ]);
  });

  it("accepts single-line hunk headers and drops no-newline markers", () => {
    const rows = parseUnifiedPatchRows(
      ["@@ -5 +5 @@", "-old", "\\ No newline at end of file", "+new"].join("\n"),
    );
    expect(rows).toEqual([
      { kind: "deletion", originalLineNumber: 5, modifiedLineNumber: undefined },
      { kind: "addition", originalLineNumber: undefined, modifiedLineNumber: 5 },
    ]);
  });

  it("treats a blank line inside a hunk as context", () => {
    const rows = parseUnifiedPatchRows(["@@ -1,3 +1,3 @@", " a", "", "-b", "+c"].join("\n"));
    expect(rows.map((row) => row.kind)).toEqual(["context", "context", "deletion", "addition"]);
    expect(rows[2]).toEqual({
      kind: "deletion",
      originalLineNumber: 3,
      modifiedLineNumber: undefined,
    });
  });

  it("stops numbering when a second file header follows a hunk", () => {
    const rows = parseUnifiedPatchRows(
      ["@@ -1 +1 @@", "-a", "+b", "diff --git a/next.ts b/next.ts", "index abc..def 100644"].join(
        "\n",
      ),
    );
    expect(rows).toHaveLength(2);
  });
});
