import { afterEach, describe, expect, it, vi } from "vitest";

import type { Commands } from "@honk/core/commands";
import type { Files } from "@honk/core";
import type { Skills } from "@honk/core/skills";
import { Workspace } from "@honk/core/workspace";

import { MENTION_FIND_DEBOUNCE_MS } from "./file-mention";
import { createMentionResultsResource, createPromptCatalogResource } from "./prompt-menu-resources";

const WORKSPACE_ID = Workspace.WorkspaceId.make("workspace_prompt_menu_resources");

const entry = (path: string): Files.Entry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  kind: "file",
  size: 1,
  modifiedAt: 1,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("prompt menu resources", () => {
  it("loads the slash catalog once across repeat subscriptions", async () => {
    const skill: Skills.Summary = { name: "review", description: "Review the change" };
    const command: Commands.Summary = {
      name: "ship",
      description: "Ship the change",
      acceptsArguments: false,
    };
    const skillsList = vi.fn(async () => [skill]);
    const commandsList = vi.fn(async () => [command]);
    const resource = createPromptCatalogResource(
      {
        skills: { list: skillsList },
        commands: { list: commandsList },
      },
      WORKSPACE_ID,
    );
    const firstListener = vi.fn();

    const releaseFirst = resource.subscribe(firstListener);
    releaseFirst();
    const releaseSecond = resource.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(skillsList).toHaveBeenCalledOnce();
    expect(commandsList).toHaveBeenCalledOnce();
    expect(resource.getSnapshot()).toEqual({ skills: [skill], commands: [command] });
    releaseSecond();
  });

  it("keeps one bare-mention request through an immediate resubscribe", async () => {
    vi.useFakeTimers();
    const list = vi.fn(async () => [entry("README.md")]);
    const resource = createMentionResultsResource({ list, find: vi.fn() }, "");

    const releaseFirst = resource.subscribe(vi.fn());
    releaseFirst();
    const releaseSecond = resource.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(list).toHaveBeenCalledOnce();
    expect(resource.getSnapshot()).toEqual({
      phase: "ready",
      results: { entries: [entry("README.md")], truncated: false },
    });

    releaseSecond();
    vi.runAllTimers();
  });

  it("starts a typed mention only after the debounce", async () => {
    vi.useFakeTimers();
    const find = vi.fn(async () => ({ entries: [entry("src/chat.ts")], truncated: false }));
    const resource = createMentionResultsResource({ list: vi.fn(), find }, "chat");
    const release = resource.subscribe(vi.fn());

    expect(find).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MENTION_FIND_DEBOUNCE_MS);
    await Promise.resolve();

    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith("chat");
    expect(resource.getSnapshot().phase).toBe("ready");

    release();
    vi.runAllTimers();
  });
});
