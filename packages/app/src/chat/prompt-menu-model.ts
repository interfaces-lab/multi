// The composer suggestion menu, as pure functions: what the caret is typing,
// which list that opens, and what picking a row means.
//
// `/` and `@` share one model on purpose (the composer surface contract:
// "do not fork / and @ into separate editor implementations"). They differ
// only in which rows they build, and both hand the composer back the same
// small acceptance union — so the two menus cannot drift into two keyboard
// contracts, two selection rules, or two ideas of what a Back row does.
//
// Nothing here touches React, the DOM, or the SDK. The driver hook owns the
// asking; this module owns the deciding, which is why it is the part with
// tests.

import type { Commands } from "@honk/core/commands";
import type { Files } from "@honk/core";
import type { Skills } from "@honk/core/skills";

import type { PromptMenuItem } from "./prompt-menu";

/** More rows than anyone reads, and enough to fill the panel's scroll. */
const MAX_ITEMS = 32;

/**
 * How many rows per `/` section before the user has typed anything.
 *
 * An unfiltered `/` should read as a sample with room for both sections, not
 * as a wall of every skill the workspace defines. Typing lifts the cap,
 * because by then the list is an answer to a question.
 */
const UNFILTERED_PER_SECTION = 3;

/** What the caret is currently typing, if it is typing a trigger token. */
export type PromptTrigger = {
  readonly kind: "command" | "mention";
  /** Index of the trigger character itself, so the menu lines up with it. */
  readonly start: number;
  readonly query: string;
};

// A slash opens the menu only at the start of a word, so a path like
// "src/chat" never reads as a command halfway through typing it.
const COMMAND_PATTERN = /(^|\s)\/([\w:.-]*)$/;
// An "@" likewise opens only at a word start, and a second "@" ends the token
// so an email address is one trigger rather than two.
const MENTION_PATTERN = /(^|\s)@([^\s@]*)$/;

/**
 * The trigger token ending at the caret, or null.
 *
 * Both patterns anchor to the caret, so the menu tracks what is being typed
 * rather than the last trigger anywhere in the draft.
 */
export const promptTriggerOf = (text: string, caret: number): PromptTrigger | null => {
  const before = text.slice(0, caret);
  const command = COMMAND_PATTERN.exec(before);
  if (command !== null) {
    const query = command[2] ?? "";
    return { kind: "command", start: caret - query.length - 1, query };
  }
  const mention = MENTION_PATTERN.exec(before);
  if (mention !== null) {
    const query = mention[2] ?? "";
    return { kind: "mention", start: caret - query.length - 1, query };
  }
  return null;
};

const matches = (query: string, ...fields: readonly (string | null | undefined)[]): boolean => {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return fields.some(
    (field) => field !== null && field !== undefined && field.toLowerCase().includes(needle),
  );
};

/**
 * The `/` menu: skills first, then commands.
 *
 * Skills lead because they are the workspace's curated capabilities, while
 * commands are closer to shortcuts for text someone types often. A name that
 * exists in both lists appears once, as a skill — the same first-wins rule
 * core applies across resource directories.
 */
export const commandItemsOf = (input: {
  readonly skills: readonly Skills.Summary[];
  readonly commands: readonly Commands.Summary[];
  readonly query: string;
}): readonly PromptMenuItem[] => {
  const perSection = input.query.length === 0 ? UNFILTERED_PER_SECTION : MAX_ITEMS;
  const skillNames = new Set(input.skills.map((skill) => skill.name));
  const skills = input.skills
    .filter((skill) => matches(input.query, skill.name, skill.description))
    .slice(0, perSection)
    .map(
      (skill): PromptMenuItem => ({
        key: `skill:${skill.name}`,
        title: skill.name,
        detail: skill.description,
        kind: "skill",
        section: "Skills",
      }),
    );
  const commands = input.commands
    .filter(
      (command) =>
        !skillNames.has(command.name) && matches(input.query, command.name, command.description),
    )
    .slice(0, perSection)
    .map(
      (command): PromptMenuItem => ({
        key: `command:${command.name}`,
        title: command.name,
        detail: command.description,
        kind: "command",
        section: "Commands",
      }),
    );
  return [...skills, ...commands];
};

/**
 * The `@` menu: files and folders in the workspace.
 *
 * One level, no source picker. Pi's prompt verbs take text and images, so a
 * path is a mention it can act on and a branch diff or a past transcript is
 * not — those need a context primitive Pi does not have, and inventing one in
 * the client would mean the composer building prompt text Pi did not format.
 */
export const fileItemsOf = (entries: readonly Files.Entry[]): readonly PromptMenuItem[] =>
  entries.slice(0, MAX_ITEMS).map(
    (entry): PromptMenuItem => ({
      key: `${entry.kind}:${entry.path}`,
      title: entry.name,
      detail: entry.path === entry.name ? null : entry.path,
      kind: entry.kind === "directory" ? "folder" : "file",
      path: entry.path,
    }),
  );

/**
 * What picking a row does, decided here so both composers do the same thing.
 *
 * Exactly Pi's surface, one case each. A path is a mention the editor turns
 * into a chip; a skill and a command are turns Pi runs from its own resource
 * list. Nothing here builds prompt text — `formatSkillInvocation` and
 * `formatPromptTemplateInvocation` own that, on the host.
 */
export type PromptMenuAcceptance =
  | { readonly type: "mention"; readonly path: string }
  | { readonly type: "skill"; readonly name: string }
  | {
      readonly type: "command";
      readonly name: string;
      /** A template with placeholders waits for arguments instead of running. */
      readonly acceptsArguments: boolean;
    };

/**
 * Turns a picked row into what the composer should do about it.
 *
 * `commands` is consulted only for the argument shape, which the menu item
 * does not carry — that keeps `PromptMenuItem` a rendering type rather than a
 * payload.
 */
export const acceptanceOf = (
  item: PromptMenuItem,
  commands: readonly Commands.Summary[],
): PromptMenuAcceptance => {
  switch (item.kind) {
    case "file":
    case "folder":
      return { type: "mention", path: item.path ?? item.key };
    case "skill":
      return { type: "skill", name: item.title };
    case "command":
      return {
        type: "command",
        name: item.title,
        acceptsArguments:
          commands.find((candidate) => candidate.name === item.title)?.acceptsArguments ?? false,
      };
  }
};
