/**
 * The commands service: `Resources` projected down to what a client lists.
 *
 * There is no scanning here. `Resources.Service` owns the walk so the list a
 * menu renders and the list `harness.promptFromTemplate()` can invoke come
 * from one place.
 *
 * @module
 */

import { Context, Effect, Layer } from "effect";
import type { Rpc } from "effect/unstable/rpc";

import { Resources } from "../resources";
import type { Interface, List, Reload, Summary } from "./contract";
import { Rpcs } from "./contract";

/**
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Commands") {}

/**
 * Every placeholder Pi's `substituteArgs` fills in, as one test.
 *
 * Kept deliberately in lockstep with that function's four replacements —
 * `$1`, `${@:N}`, `${@:N:L}`, `$ARGUMENTS`, and `$@` — because the whole point
 * of `acceptsArguments` is to predict whether running the template without
 * arguments would leave holes in it. A pattern that drifted from Pi's would
 * make the composer submit a template full of literal `$1`s.
 */
const argumentPlaceholder = /\$\d+|\$\{@:\d+(?::\d+)?\}|\$ARGUMENTS|\$@/;

/** Pi's `PromptTemplate` as a client sees it. */
const toSummary = (template: {
  readonly name: string;
  readonly description?: string;
  readonly content: string;
}): Summary => ({
  name: template.name,
  description:
    template.description === undefined || template.description.trim().length === 0
      ? null
      : template.description,
  acceptsArguments: argumentPlaceholder.test(template.content),
});

/**
 * Builds the commands service over {@link Resources.Service}.
 *
 * @category layers
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resources = yield* Resources.Service;

    const list = Effect.fn("Commands.list")(function* (input: Rpc.Payload<typeof List>) {
      const loaded = yield* resources.load(input);
      return loaded.promptTemplates.map(toSummary);
    });

    const reload = Effect.fn("Commands.reload")(function* (input: Rpc.Payload<typeof Reload>) {
      const loaded = yield* resources.reload(input);
      return loaded.promptTemplates.map(toSummary);
    });

    return Service.of({ list, reload });
  }),
);

/**
 * Binds the commands RPCs to {@link Service}.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const commands = yield* Service;
    return {
      "commands.list": (payload) => commands.list(payload),
      "commands.reload": (payload) => commands.reload(payload),
    };
  }),
);
