/**
 * Sessions: the commands that drive a real Pi `AgentHarness`.
 *
 * Pi has a persisted `Session` and a live `AgentHarness`. The Pi session stores
 * entries, branches, model changes, thinking-level changes, and active-tool
 * changes; the harness is the in-memory object that operates on it. This module
 * keeps the two together while a session is open and exposes commands that call
 * the real harness.
 *
 * Honk does not define a second session schema, message model, or event union.
 * Values that cross this boundary are Pi's own, and the durable truth is always
 * the Pi session — never a Honk copy of it.
 *
 * The module splits along its three concerns:
 *
 * - `./contract` — schemas, Pi error passthrough, and the command catalog.
 * - `./attribution` — the pure gate deciding whose writes a turn's
 *   checkpoint diff contains.
 * - `./service` — the service implementation over the real harness.
 *
 * The read model has two channels, and the asymmetry is deliberate:
 *
 * - `Reload` is authoritative. It is an idempotent committed read that
 *   works whether the harness is idle or running and does not depend on which
 *   clients are attached.
 * - `Events` is advisory. Events are temporary notifications that let an
 *   attached interface update without reloading after every change. A missed
 *   event is repaired by the next reload, so nothing durable depends on them.
 *
 * @example
 * ```ts
 * // Start listening, then read: the `live` head frame makes the handoff
 * // deterministic, so no event can slip between subscribe and reload.
 * for await (const frame of sdk.session.events({ sessionId })) {
 *   if (frame.type === "live") {
 *     render((await sdk.session.reload({ sessionId })).entries);
 *   } else {
 *     applyEvent(frame.event);
 *   }
 * }
 * ```
 *
 * @see spec/core.md sections 4 and 9, and invariants 2 through 5.
 * @module
 */

export * from "./contract";
export * from "./delegation";
export * from "./fusion";
export * from "./git-actions";
export * from "./service";
export * from "./subagents";
export * from "./title";

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Session from ".";
