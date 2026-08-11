/**
 * Skills: the workspace's `SKILL.md` instructions, listed for a client and
 * armed on the harness.
 *
 * A skill is a named body of instructions the workspace author wrote. Pi's
 * harness holds them as resources and invokes one explicitly through
 * `harness.skill(name)`; Honk lists them so a composer's `/` menu can offer
 * them, and runs one through `sdk.session.runSkill`.
 *
 * The module splits along its two concerns:
 *
 * - `./contract` — the summary schema and the command catalog.
 * - `./service` — the projection over `Resources.Service`, which owns the scan.
 *
 * Skills load only after workspace trust, because the only way to reach a
 * workspace's files is the environment trust created (spec/core.md section 5).
 *
 * @example
 * ```ts
 * const skills = await sdk.skills.list({ workspaceId });
 * await sdk.session.runSkill({ sessionId, name: skills[0].name });
 * ```
 *
 * @see spec/honk-built-ins.md section 6.
 * @module
 */

export * from "./contract";
export * from "./service";

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Skills from ".";
