import { describe, expect, it } from "vitest";

import type { Commands } from "@honk/core/commands";
import type { Files } from "@honk/core";
import type { Skills } from "@honk/core/skills";

import type { PromptMenuItem } from "./prompt-menu";
import { acceptanceOf, commandItemsOf, fileItemsOf, promptTriggerOf } from "./prompt-menu-model";

const entry = (path: string, kind: Files.Entry["kind"] = "file"): Files.Entry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  kind,
  size: 1,
  modifiedAt: 1,
});

const skill = (name: string, description: string | null = null): Skills.Summary => ({
  name,
  description,
});

const command = (
  name: string,
  acceptsArguments = false,
  description: string | null = null,
): Commands.Summary => ({ name, description, acceptsArguments });

describe("prompt trigger", () => {
  it("opens a mention on a bare @ at the start or after whitespace", () => {
    expect(promptTriggerOf("@", 1)).toEqual({ kind: "mention", start: 0, query: "" });
    expect(promptTriggerOf("fix @", 5)).toEqual({ kind: "mention", start: 4, query: "" });
    expect(promptTriggerOf("fix\n@", 5)).toEqual({ kind: "mention", start: 4, query: "" });
  });

  it("opens a command on a slash at a word start", () => {
    expect(promptTriggerOf("/", 1)).toEqual({ kind: "command", start: 0, query: "" });
    expect(promptTriggerOf("now /rev", 8)).toEqual({ kind: "command", start: 4, query: "rev" });
  });

  it("leaves a path alone: a slash mid-word is not a command", () => {
    // The regression this guards: typing "src/chat" must not put a menu over
    // the composer on the slash.
    expect(promptTriggerOf("src/chat", 8)).toBeNull();
    expect(promptTriggerOf("see /usr/bin", 12)).toBeNull();
  });

  it("carries the query typed after the @", () => {
    expect(promptTriggerOf("see @src/ch", 11)).toEqual({
      kind: "mention",
      start: 4,
      query: "src/ch",
    });
  });

  it("reads only up to the caret, so editing mid-draft still triggers", () => {
    expect(promptTriggerOf("see @src later words", 8)).toEqual({
      kind: "mention",
      start: 4,
      query: "src",
    });
  });

  it("never opens mid-word, after a second @, or across whitespace", () => {
    expect(promptTriggerOf("mail me@example", 15)).toBeNull();
    expect(promptTriggerOf("a@b@c", 5)).toBeNull();
    expect(promptTriggerOf("see @src file", 13)).toBeNull();
    expect(promptTriggerOf("no trigger", 10)).toBeNull();
  });
});

describe("command items", () => {
  it("lists skills before commands, each under its own section", () => {
    const items = commandItemsOf({
      skills: [skill("tidy", "Tidies imports.")],
      commands: [command("review")],
      query: "",
    });
    expect(items.map((item) => [item.section, item.title, item.kind])).toEqual([
      ["Skills", "tidy", "skill"],
      ["Commands", "review", "command"],
    ]);
  });

  it("shows a sample per section until something is typed", () => {
    const skills = ["a", "b", "c", "d", "e"].map((name) => skill(name));
    expect(commandItemsOf({ skills, commands: [], query: "" })).toHaveLength(3);
    expect(commandItemsOf({ skills, commands: [], query: "" }).length).toBeLessThan(skills.length);
  });

  it("lifts the cap and filters on name or description once typed", () => {
    const skills = ["alpha", "beta", "gamma", "delta"].map((name) => skill(name));
    expect(commandItemsOf({ skills, commands: [], query: "a" })).toHaveLength(4);
    expect(
      commandItemsOf({
        skills: [skill("tidy", "Sorts every import")],
        commands: [],
        query: "import",
      }),
    ).toHaveLength(1);
  });

  it("shows a name defined as both once, as the skill", () => {
    const items = commandItemsOf({
      skills: [skill("review")],
      commands: [command("review")],
      query: "",
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("skill");
  });
});

describe("file items", () => {
  it("maps entries onto rows, folders and files by kind", () => {
    expect(fileItemsOf([entry("src/app.ts"), entry("src", "directory")])).toEqual([
      {
        key: "file:src/app.ts",
        title: "app.ts",
        detail: "src/app.ts",
        kind: "file",
        path: "src/app.ts",
      },
      { key: "directory:src", title: "src", detail: null, kind: "folder", path: "src" },
    ]);
  });

  it("drops the detail line when the path adds nothing over the name", () => {
    expect(fileItemsOf([entry("README.md")])[0]?.detail).toBeNull();
  });
});

describe("acceptance", () => {
  const commands = [command("args", true), command("plain")];
  const item = (
    partial: Partial<PromptMenuItem> & Pick<PromptMenuItem, "kind">,
  ): PromptMenuItem => ({ key: "k", title: "t", detail: null, ...partial });

  it("turns a path row into a mention", () => {
    expect(acceptanceOf(item({ kind: "file", path: "src/a.ts" }), commands)).toEqual({
      type: "mention",
      path: "src/a.ts",
    });
    expect(acceptanceOf(item({ kind: "folder", path: "src" }), commands)).toEqual({
      type: "mention",
      path: "src",
    });
  });

  it("names the skill Pi will invoke", () => {
    expect(acceptanceOf(item({ kind: "skill", title: "tidy" }), commands)).toEqual({
      type: "skill",
      name: "tidy",
    });
  });

  it("carries whether a command still needs arguments", () => {
    expect(acceptanceOf(item({ kind: "command", title: "args" }), commands)).toEqual({
      type: "command",
      name: "args",
      acceptsArguments: true,
    });
    expect(acceptanceOf(item({ kind: "command", title: "plain" }), commands)).toEqual({
      type: "command",
      name: "plain",
      acceptsArguments: false,
    });
  });

  it("treats a command the catalog forgot as taking none", () => {
    expect(acceptanceOf(item({ kind: "command", title: "gone" }), commands)).toEqual({
      type: "command",
      name: "gone",
      acceptsArguments: false,
    });
  });
});
