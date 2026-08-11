/**
 * The workspace resource scan behind `sdk.skills` and `sdk.commands`.
 *
 * Pi's harness takes skills and prompt templates together, as one
 * `AgentHarnessResources` value, and both come from the same walk of the same
 * workspace. Scanning once and handing the result to three callers — the two
 * RPC namespaces and the session layer that arms the harness — is what keeps
 * the list a client renders and the list `harness.skill()` can invoke the same
 * list. Two independent scans would eventually disagree, and the disagreement
 * would surface as a menu row that does nothing.
 *
 * This service has no RPCs of its own. It is host-side by construction: it
 * reads the workspace through the {@link Workspace.ExecutionEnv} that trust
 * created, so there is nothing here a browser bundle could run.
 *
 * Loading happens after trust and never before. `Workspace.env` only answers
 * for a `WorkspaceId`, and ids are minted only when trust is recorded, so
 * spec/core.md section 5's "Honk must not load its extensions, MCP
 * configuration, skills, prompts, instructions, or tools" holds by
 * construction rather than by a check anyone has to remember.
 *
 * @see spec/honk-built-ins.md section 6 for the two namespaces this feeds.
 * @module
 */

import type { PromptTemplate, Skill } from "@earendil-works/pi-agent-core";
import { loadPromptTemplates, loadSkills } from "@earendil-works/pi-agent-core";
import { Context, Effect, Layer, Path, Ref } from "effect";

import { Workspace } from "./workspace";

/**
 * Where a workspace keeps its skills, in precedence order.
 *
 * `.agents` first: it is the vendor-neutral location, and `.claude` is
 * frequently a symlink pointing back at it (this repository does exactly
 * that). Loading both and deduplicating by name means the symlink case
 * produces one row per skill instead of two, and a workspace that really does
 * keep separate trees gets `.agents` winning the name.
 */
const skillDirectories = [".agents/skills", ".claude/skills"];

/**
 * Where a workspace keeps its prompt templates — the `/name` commands.
 *
 * Same precedence and the same deduplication as {@link skillDirectories}. Pi
 * loads direct `.md` children of these non-recursively, which is the shape
 * both conventions already use.
 */
const commandDirectories = [".agents/commands", ".claude/commands"];

/**
 * One workspace's scan: exactly the two lists Pi's harness accepts.
 *
 * Pi's own types, not a Honk mirror. `Skill` carries the full instruction
 * content and its file path because `harness.skill()` needs them; the RPC
 * namespaces project this down to what a client should see.
 *
 * @category types
 */
export interface Loaded {
  readonly skills: readonly Skill[];
  readonly promptTemplates: readonly PromptTemplate[];
}

/**
 * @category service
 */
export interface Interface {
  /**
   * This workspace's skills and prompt templates, scanning on first ask.
   *
   * Cached because a composer opens its `/` menu on every keystroke of a
   * command name, and re-walking two directory trees per keystroke would make
   * the menu the slowest thing in the application.
   */
  readonly load: (input: {
    readonly workspaceId: Workspace.WorkspaceId;
  }) => Effect.Effect<Loaded, Workspace.NotFoundError>;

  /**
   * Drops the cache for one workspace and scans again.
   *
   * The explicit half of the cache above: skills are files a person edits
   * while Honk is running, and the alternative to this command is telling
   * them to restart the application.
   */
  readonly reload: (input: {
    readonly workspaceId: Workspace.WorkspaceId;
  }) => Effect.Effect<Loaded, Workspace.NotFoundError>;
}

/**
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Resources") {}

/** First entry wins, so directory precedence decides a duplicated name. */
const dedupeByName = <T extends { readonly name: string }>(items: readonly T[]): readonly T[] => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.name) ? false : (seen.add(item.name), true)));
};

/**
 * Builds the resource scanner over `Workspace.Service` and a `Path.Path`.
 *
 * @category layers
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const workspaces = yield* Workspace.Service;
    const path = yield* Path.Path;
    const cache = yield* Ref.make<ReadonlyMap<Workspace.WorkspaceId, Loaded>>(new Map());

    const scan = Effect.fnUntraced(function* (workspaceId: Workspace.WorkspaceId) {
      // find() proves the id and gives the root; env() is the trust-created
      // environment every other built-in reads through.
      const info = yield* workspaces.find({ workspaceId });
      const env = yield* workspaces.env({ workspaceId });
      const absolute = (relative: string) => path.join(info.directory, relative);

      // Pi skips missing input paths, so candidate directories cost a stat
      // rather than an existence check here. Diagnostics are dropped on
      // purpose: a malformed skill file is the workspace author's problem to
      // see in their editor, and surfacing it as a composer error would put a
      // parser warning in front of someone trying to type a message.
      const skills = yield* Effect.promise(() =>
        loadSkills(env, skillDirectories.map(absolute)),
      ).pipe(Effect.map((result) => dedupeByName(result.skills)));
      const promptTemplates = yield* Effect.promise(() =>
        loadPromptTemplates(env, commandDirectories.map(absolute)),
      ).pipe(Effect.map((result) => dedupeByName(result.promptTemplates)));

      const loaded: Loaded = { skills, promptTemplates };
      yield* Ref.update(cache, (current) => new Map(current).set(workspaceId, loaded));
      return loaded;
    });

    const load = Effect.fn("Resources.load")(function* (input: {
      readonly workspaceId: Workspace.WorkspaceId;
    }) {
      const cached = (yield* Ref.get(cache)).get(input.workspaceId);
      return cached ?? (yield* scan(input.workspaceId));
    });

    const reload = Effect.fn("Resources.reload")(function* (input: {
      readonly workspaceId: Workspace.WorkspaceId;
    }) {
      return yield* scan(input.workspaceId);
    });

    return Service.of({ load, reload });
  }),
);

/**
 * {@link layer} with POSIX path rules, matching `Files.defaultLayer`.
 *
 * TODO(core-migration §6): a Node host should provide `NodePath.layer`, and
 * this must move with `Files` and `Workspace` when it does.
 *
 * @category layers
 */
export const defaultLayer = layer.pipe(Layer.provide(Path.layer));

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Resources from "./resources";
