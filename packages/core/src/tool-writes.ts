/**
 * Pure tool-write classification shared by hosts and clients.
 *
 * This module stays independent of Pi's tool constructors. Client bundles use
 * the classifier to present read-shaped work without importing the host's
 * agent runtime.
 *
 * @module
 */

import { Option, Schema } from "effect";

/** What one tool call says about the paths it wrote. */
export type ToolWrites =
  | { readonly kind: "none" }
  | { readonly kind: "declared"; readonly paths: readonly string[] }
  | { readonly kind: "opaque" };

/**
 * Classifies one tool call for the attribution gate.
 *
 * Unknown tools are opaque. A declaring tool with unreadable arguments
 * declares no paths, while the checkpoint diff still records its content.
 */
export const writesOf = (toolName: string, args: unknown): ToolWrites => {
  switch (toolName) {
    case "read":
    case "websearch":
      return { kind: "none" };
    case "write":
    case "edit":
      return { kind: "declared", paths: declaredPath(args) };
    default:
      return { kind: "opaque" };
  }
};

const decodeDeclaredPath = Schema.decodeUnknownOption(
  Schema.Struct({ path: Schema.NonEmptyString }),
);

const declaredPath = (args: unknown): readonly string[] =>
  Option.match(decodeDeclaredPath(args), {
    onNone: () => [],
    onSome: ({ path }) => [path],
  });

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Tools from "./tool-writes";
