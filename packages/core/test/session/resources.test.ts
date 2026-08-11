// Workspace resources: the `/` menu's two lists, and the two verbs that run
// what a row names. The point of every case here is that one scan feeds both
// halves — a name `sdk.skills.list` offers must be a name `session.run_skill`
// can invoke, or the menu row is a dead control.

import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";

import { Commands } from "../../src/commands";
import { Session } from "../../src/session";
import { Skills } from "../../src/skills";
import {
  makeFauxSessionLayer,
  messageEntries,
  openTrustedWorkspace,
  textOf,
} from "../../src/testing";

// A workspace with one skill and two commands, written the way a person would.
const seedWorkspace = async (directory: string): Promise<void> => {
  await rm(directory, { force: true, recursive: true });
  await mkdir(join(directory, ".agents/skills/tidy"), { recursive: true });
  await mkdir(join(directory, ".agents/commands"), { recursive: true });
  await writeFile(
    join(directory, ".agents/skills/tidy/SKILL.md"),
    ["---", "name: tidy", "description: Tidies the imports.", "---", "", "Sort every import."].join(
      "\n",
    ),
  );
  await writeFile(
    join(directory, ".agents/commands/review.md"),
    ["---", "description: Reviews a diff.", "---", "", "Review $ARGUMENTS closely."].join("\n"),
  );
  await writeFile(join(directory, ".agents/commands/standup.md"), "Summarize yesterday.");
};

describe("workspace skills and commands", () => {
  it.effect("lists the skills and commands a workspace defines", () =>
    Effect.gen(function* () {
      const directory = "/tmp/honk-resources-list";
      yield* Effect.promise(() => seedWorkspace(directory));
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const workspace = yield* openTrustedWorkspace(directory);
        const skills = yield* Skills.Service;
        const commands = yield* Commands.Service;

        expect(yield* skills.list({ workspaceId: workspace.id })).toEqual([
          { name: "tidy", description: "Tidies the imports." },
        ]);

        const listed = yield* commands.list({ workspaceId: workspace.id });
        expect([...listed].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
          { name: "review", description: "Reviews a diff.", acceptsArguments: true },
          // No frontmatter, so the description is Pi's fallback — the body's
          // own first line. No placeholders either, so picking this row can
          // submit immediately instead of waiting for arguments.
          { name: "standup", description: "Summarize yesterday.", acceptsArguments: false },
        ]);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("answers an empty list for a workspace with no resource directories", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        // Having no skills is the common case, not a failure.
        const workspace = yield* openTrustedWorkspace("/tmp/honk-resources-bare");
        const skills = yield* Skills.Service;
        expect(yield* skills.list({ workspaceId: workspace.id })).toEqual([]);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("runs a listed skill as the turn's prompt", () =>
    Effect.gen(function* () {
      const directory = "/tmp/honk-resources-run-skill";
      yield* Effect.promise(() => seedWorkspace(directory));
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Tidied.")]);

      const program = Effect.gen(function* () {
        const workspace = yield* openTrustedWorkspace(directory);
        const session = yield* Session.Service;
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.runSkill({ sessionId: id, name: "tidy", instructions: "only src/" });

        const state = yield* session.reload({ sessionId: id });
        const messages = messageEntries(state.entries);
        // Pi formats the invocation, so the transcript's user message is the
        // skill's own instructions plus what the user typed after the name.
        expect(textOf(messages[0])).toContain("Sort every import.");
        expect(textOf(messages[0])).toContain("only src/");
        expect(textOf(messages[1])).toBe("Tidied.");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("substitutes arguments into a command template", () =>
    Effect.gen(function* () {
      const directory = "/tmp/honk-resources-run-command";
      yield* Effect.promise(() => seedWorkspace(directory));
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Reviewed.")]);

      const program = Effect.gen(function* () {
        const workspace = yield* openTrustedWorkspace(directory);
        const session = yield* Session.Service;
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.runCommand({ sessionId: id, name: "review", args: '"the auth flow"' });

        const state = yield* session.reload({ sessionId: id });
        expect(textOf(messageEntries(state.entries)[0])).toContain("Review the auth flow closely.");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("refuses a name the workspace does not define", () =>
    Effect.gen(function* () {
      const directory = "/tmp/honk-resources-unknown";
      yield* Effect.promise(() => seedWorkspace(directory));
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const workspace = yield* openTrustedWorkspace(directory);
        const session = yield* Session.Service;
        const { id } = yield* session.create({ workspaceId: workspace.id });

        // Pi's own refusal, passed through rather than restated: the resource
        // list moved under the client, and rescanning is the fix.
        const error = yield* session
          .runSkill({ sessionId: id, name: "nonexistent" })
          .pipe(Effect.flip);
        expect(error.code).toBe("invalid_argument");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("picks up a skill added while the host is running, after reload", () =>
    Effect.gen(function* () {
      const directory = "/tmp/honk-resources-reload";
      yield* Effect.promise(() => seedWorkspace(directory));
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const workspace = yield* openTrustedWorkspace(directory);
        const skills = yield* Skills.Service;
        expect(yield* skills.list({ workspaceId: workspace.id })).toHaveLength(1);

        yield* Effect.promise(async () => {
          await mkdir(join(directory, ".agents/skills/ship"), { recursive: true });
          await writeFile(
            join(directory, ".agents/skills/ship/SKILL.md"),
            ["---", "name: ship", "description: Ships it.", "---", "", "Ship."].join("\n"),
          );
        });

        // The cached list is the whole reason `reload` exists: without it the
        // only way to see a new skill would be restarting the host.
        expect(yield* skills.list({ workspaceId: workspace.id })).toHaveLength(1);
        expect(yield* skills.reload({ workspaceId: workspace.id })).toHaveLength(2);
        expect(yield* skills.list({ workspaceId: workspace.id })).toHaveLength(2);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );
});
