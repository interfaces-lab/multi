import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCliCommand } from "./command";

describe("parseCliCommand", () => {
  it("requires the explicit serve command", () => {
    expect(parseCliCommand([])).toEqual({ type: "help" });
    expect(() => parseCliCommand(["workspace"])).toThrow("Unknown command: workspace");
  });

  it("parses one workspace and the host options", () => {
    expect(
      parseCliCommand(["serve", "./workspace", "--data", "./state", "--label", "Laptop"]),
    ).toEqual({
      type: "serve",
      options: {
        workspaceDirectory: resolve("./workspace"),
        dataDirectory: resolve("./state"),
        computerLabel: "Laptop",
      },
    });
  });

  it("rejects extra workspaces and incomplete options", () => {
    expect(() => parseCliCommand(["serve", "one", "two"])).toThrow(
      "Only one workspace directory is allowed.",
    );
    expect(() => parseCliCommand(["serve", "--data"])).toThrow("--data requires a value.");
    expect(() => parseCliCommand(["serve", "--label", " "])).toThrow("--label cannot be empty.");
  });
});
