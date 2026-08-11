// How a tool call reads to a person. Pure and keyed on core's seven real
// tools (read/write/edit/bash/websearch/mcp/task): a name, its arguments and
// its state in; a tensed verb, one human argument and a clipped body out.
//
// One table, two readers: the transcript's rows and the ticker in
// `turn-status`. A call named "Running pnpm vitest run" in the window is
// named the same way in the row it lands as.
//
// Arguments cross the wire straight from the model, validated only against
// the tool's own schema, so every read here is guarded and a shape this
// build cannot read yields nothing rather than a guess.

import { Option, Schema } from "effect";

/** How far a run has got. The row's state words, shared with the ticker. */
export type StepState = "running" | "ok" | "error";

/** One human argument is a label, not a payload: clip it to a line. */
const DETAIL_MAX_CHARS = 140;
/** A body is evidence, not a log: clip it to a screenful of scrollback. */
const OUTPUT_MAX_CHARS = 2400;

/** Clips the end: the head is the answer for text that starts with it. */
export const clipHead = (text: string, maxChars = OUTPUT_MAX_CHARS): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;

/** Clips the start: a command's newest lines are the ones worth reading. */
export const clipTail = (text: string, maxChars = OUTPUT_MAX_CHARS): string =>
  text.length <= maxChars ? text : `…${text.slice(-maxChars)}`;

const decodeArguments = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const decodeNonEmptyString = Schema.decodeUnknownOption(Schema.NonEmptyString);

const stringArg = (args: unknown, key: string): string | null =>
  Option.getOrNull(
    Option.flatMap(decodeArguments(args), (arguments_) => decodeNonEmptyString(arguments_[key])),
  );

/** A mission is one line: the first non-empty line stands for the prompt. */
const firstLine = (text: string): string | null =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;

/** The delegated role, from the call's own `subagent_type` argument. */
export const taskRoleOf = (args: unknown): string | null => stringArg(args, "subagent_type");

/**
 * The child session a settled delegation ran in. Core's task tool rides the
 * id on the result's `details` (delegation.ts DelegationResult) — untyped
 * across the wire, so the read is guarded like `editPatchOf`.
 */
export const taskChildIdOf = (details: unknown): string | null => {
  return stringArg(details, "sessionId");
};

/** The complete text carried by a write call. */
export const writeContentOf = (args: unknown): string | null => stringArg(args, "content");

/**
 * A machine name as a person would say it: `read_file` and `readFile` and
 * `posthog/query` all become sentence-cased words.
 */
export const humanizeToolName = (value: string): string => {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-/]+/g, " ")
    .trim();
  const [first] = spaced;
  return first === undefined ? "Tool call" : `${first.toUpperCase()}${spaced.slice(1)}`;
};

// The MCP proxy is one tool with four modes (spec/honk-built-ins.md §8), and
// the mode is what the row is about: calling a server's tool is not the same
// act as searching for one.
const mcpMode = (
  args: unknown,
): { readonly running: string; readonly settled: string; readonly detail: string | null } => {
  const tool = stringArg(args, "tool");
  if (tool !== null) {
    return { running: "Calling", settled: "Called", detail: humanizeToolName(tool) };
  }
  const describe = stringArg(args, "describe");
  if (describe !== null) {
    return { running: "Describing", settled: "Described", detail: humanizeToolName(describe) };
  }
  const search = stringArg(args, "search");
  if (search !== null) {
    return { running: "Finding tools", settled: "Found tools", detail: search };
  }
  return { running: "Checking MCP servers", settled: "Checked MCP servers", detail: null };
};

/**
 * The tensed verb for one call. Present tense while it runs, past tense once
 * it lands; only a failed delegation gets a verb of its own, because a task
 * row that still says "Completed" would be lying.
 */
export const toolVerb = (name: string, args: unknown, state: StepState): string => {
  const isRunning = state === "running";
  switch (name) {
    case "read":
      return isRunning ? "Reading" : "Read";
    case "write":
      return isRunning ? "Writing" : "Wrote";
    case "edit":
      return isRunning ? "Editing" : "Edited";
    case "bash":
      return isRunning ? "Running" : "Ran";
    case "websearch":
      return isRunning ? "Searching web" : "Searched web";
    case "task":
      if (state === "error") return "Work failed";
      return isRunning ? "Working" : "Completed";
    case "mcp": {
      const mode = mcpMode(args);
      return isRunning ? mode.running : mode.settled;
    }
    default: {
      const humanized = humanizeToolName(name);
      return isRunning ? `Running ${humanized}` : humanized;
    }
  }
};

/**
 * The one argument a person would name the call by: the path it touched, the
 * command it ran, the query it asked, the mission it delegated.
 */
export const toolDetail = (name: string, args: unknown): string | null => {
  const candidate = ((): string | null => {
    switch (name) {
      case "read":
      case "write":
      case "edit":
        return stringArg(args, "path");
      case "bash":
        return stringArg(args, "command");
      case "websearch":
        return stringArg(args, "query");
      case "task": {
        // The mission: an explicit description when the schema grows one,
        // else the prompt's first line — never the whole delegation text.
        const description = stringArg(args, "description");
        if (description !== null) return description;
        const prompt = stringArg(args, "prompt");
        return prompt === null ? null : firstLine(prompt);
      }
      case "mcp":
        return mcpMode(args).detail;
      default:
        return (
          stringArg(args, "path") ??
          stringArg(args, "command") ??
          stringArg(args, "query") ??
          stringArg(args, "description") ??
          stringArg(args, "name")
        );
    }
  })();
  return candidate === null ? null : clipHead(candidate, DETAIL_MAX_CHARS);
};

/**
 * The body a row shows under its line. A read's body is the file, and the
 * file already has a home — repeating it in the transcript is duplication,
 * not evidence, so a successful read shows nothing. A command's tail is what
 * happened last, so bash clips from the start; everything else clips the end.
 */
export const toolBody = (name: string, state: StepState, output: string): string => {
  if (name === "read" && state !== "error") return "";
  return name === "bash" ? clipTail(output) : clipHead(output);
};

/**
 * Pi's edit tool ships the unified patch it applied on the tool result's
 * `details` (its `EditToolDetails`). The value is untyped across the wire, so
 * a result without a readable patch renders as an ordinary row.
 */
export const editPatchOf = (details: unknown): string | null => {
  const patch = stringArg(details, "patch");
  return patch !== null && patch.trim().length > 0 ? patch : null;
};

/**
 * The diff stats the row shows. Counted from the patch Pi applied, never
 * from a write's own input: a write knows the file it produced and nothing
 * about the one it replaced, and inventing the difference would be a lie.
 */
export const measurePatch = (
  patch: string,
): { readonly added: number; readonly removed: number } => {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
};
