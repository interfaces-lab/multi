/**
 * The skills service: `Resources` projected down to what a client lists.
 *
 * There is no scanning here. `Resources.Service` owns the walk so the list a
 * menu renders and the list `harness.skill()` can invoke come from one place.
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
export class Service extends Context.Service<Service, Interface>()("honk/Skills") {}

/**
 * Pi's `Skill` as a client sees it: the name and the description, nothing else.
 *
 * A blank description becomes `null` rather than `""`, so the two spellings of
 * "no description" cannot render as two different rows.
 */
const toSummary = (skill: { readonly name: string; readonly description: string }): Summary => ({
  name: skill.name,
  description: skill.description.trim().length === 0 ? null : skill.description,
});

/**
 * Builds the skills service over {@link Resources.Service}.
 *
 * @category layers
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resources = yield* Resources.Service;

    const list = Effect.fn("Skills.list")(function* (input: Rpc.Payload<typeof List>) {
      const loaded = yield* resources.load(input);
      return loaded.skills.map(toSummary);
    });

    const reload = Effect.fn("Skills.reload")(function* (input: Rpc.Payload<typeof Reload>) {
      const loaded = yield* resources.reload(input);
      return loaded.skills.map(toSummary);
    });

    return Service.of({ list, reload });
  }),
);

/**
 * Binds the skills RPCs to {@link Service}.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const skills = yield* Service;
    return {
      "skills.list": (payload) => skills.list(payload),
      "skills.reload": (payload) => skills.reload(payload),
    };
  }),
);
