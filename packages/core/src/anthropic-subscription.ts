/**
 * Claude subscription request shaping for the `anthropic` provider.
 *
 * Pi's `anthropic-messages` transport already switches request identity when
 * the resolved credential is a subscription OAuth token: Bearer auth, the
 * Claude Code beta headers, the required first system block, and canonical
 * tool names. Two shapes remain host-owned, and this module carries both:
 *
 * 1. **The billing header block.** OAuth requests without Claude Code's
 *    `x-anthropic-billing-header` system line are classified as third-party
 *    app usage and can fail with a misleading "out of extra usage" 400. The
 *    line embeds a pinned Claude Code version, the `sdk-cli` entrypoint, and
 *    two short hashes derived from the first user message.
 * 2. **Assistant turn splitting.** Pi's serializer can emit an assistant
 *    message whose text blocks follow a `tool_use` block, and the Messages
 *    API rejects that ordering on the subscription route. The shaper splits
 *    such a message into a text turn followed by a `tool_use` turn.
 *
 * {@link install} composes the shaper onto the provider's own transports where
 * the host builds its collection. Every call path in the core — turns,
 * compaction, subagent and fusion arms — goes through the one `Models`
 * collection, so wrapping at construction covers all of them by construction.
 * The gate is strict: only requests whose resolved credential is an
 * `sk-ant-oat` token are shaped. API-key requests and every other provider
 * pass through untouched.
 *
 * @see spec/honk-built-ins.md section 3.
 * @module
 */

import { createHash } from "node:crypto";

import type {
  Api,
  ApiStreamOptions,
  Context,
  Model,
  MutableModels,
  SimpleStreamOptions,
  StreamOptions,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Value } from "typebox/value";

/**
 * The Claude Code version embedded in the billing header.
 *
 * **A maintenance constant: it must track Claude Code releases.** There is no
 * upstream package to import it from; check the current version with
 * `claude --version`. If it drifts too far from what Anthropic's backend
 * expects, subscription requests may be rejected or misclassified.
 */
export const CLAUDE_CODE_VERSION = "2.1.206";

/** Salt in the billing header suffix hash. */
const BILLING_HEADER_SALT = "59cf53e54c78";

/** Character positions sampled from the first user message for the suffix hash. */
const BILLING_HEADER_POSITIONS: readonly number[] = [4, 7, 20];

/** Entrypoint identifier embedded in the billing header. */
const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";

/**
 * The literal that opens the billing block. Its presence in any system block
 * is what makes {@link prependBillingHeader} idempotent: a payload that
 * already carries the marker is left alone.
 */
const BILLING_HEADER_MARKER = "x-anthropic-billing-header:";

/**
 * Anthropic issues subscription OAuth access tokens with an `sk-ant-oat`
 * prefix — the same signal Pi's built-in transport keys its own OAuth
 * identity switch on, so gating on it keeps this module's shaping aligned
 * with Pi's detection. API keys (`sk-ant-api...`) and other providers' tokens
 * answer false.
 *
 * @category gate
 */
export const subscriptionTokenOf = (apiKey: string | undefined): string | undefined =>
  apiKey?.includes("sk-ant-oat") === true ? apiKey : undefined;

const AnthropicMessage = Type.Object({
  role: Type.String(),
  content: Type.Unknown(),
});
const AnthropicUserTextMessage = Type.Object({
  role: Type.Literal("user"),
  content: Type.String(),
});
const AnthropicUserBlockMessage = Type.Object({
  role: Type.Literal("user"),
  content: Type.Array(Type.Unknown()),
});
const AnthropicAssistantBlockMessage = Type.Object({
  role: Type.Literal("assistant"),
  content: Type.Array(Type.Unknown()),
});
const StringValue = Type.String();
const AnthropicTextBlock = Type.Object({ text: Type.String() });
const AnthropicTextContent = Type.Object({
  type: Type.Literal("text"),
  text: Type.String(),
});
const AnthropicToolUseBlock = Type.Object({ type: Type.Literal("tool_use") });
const AnthropicPayload = Type.Object({
  model: Type.String(),
  messages: Type.Array(Type.Unknown()),
  stream: Type.Boolean(),
  system: Type.Optional(Type.Unknown()),
});

/** The text of the first user message, the billing hash input. */
const firstUserText = (messages: readonly unknown[]): string => {
  for (const message of messages) {
    if (!Value.Check(AnthropicMessage, message) || message.role !== "user") continue;
    if (Value.Check(AnthropicUserTextMessage, message)) return message.content;
    if (!Value.Check(AnthropicUserBlockMessage, message)) return "";
    for (const block of message.content) {
      if (Value.Check(AnthropicTextContent, block)) {
        return block.text;
      }
    }
    return "";
  }
  return "";
};

/**
 * Builds the billing header line for one request, or undefined when the
 * request has no first user text to derive the hashes from.
 *
 * The shape is Claude Code's: a truncated sha256 of the first user message
 * (`cch`), and a version suffix hashed from a salt, three characters sampled
 * from that message, and the pinned version.
 *
 * @category shaping
 */
export const buildBillingHeaderValue = (messages: readonly unknown[]): string | undefined => {
  const text = firstUserText(messages);
  if (text === "") return undefined;

  const cch = createHash("sha256").update(text).digest("hex").slice(0, 5);
  const sampled = BILLING_HEADER_POSITIONS.map((index) => text[index] ?? "0").join("");
  const suffix = createHash("sha256")
    .update(`${BILLING_HEADER_SALT}${sampled}${CLAUDE_CODE_VERSION}`)
    .digest("hex")
    .slice(0, 3);

  return [
    BILLING_HEADER_MARKER,
    `cc_version=${CLAUDE_CODE_VERSION}.${suffix};`,
    `cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT};`,
    `cch=${cch};`,
  ].join(" ");
};

/**
 * Normalizes a string or text-bearing system entry to a text block. Anything
 * else passes through unchanged: fabricating a replacement would drop content
 * the API might accept.
 */
const normalizeSystemBlock = (block: unknown): unknown => {
  if (Value.Check(StringValue, block)) return { type: "text", text: block };
  if (Value.Check(AnthropicTextBlock, block)) return { ...block, type: "text" };
  return block;
};

/**
 * Prepends the billing block to the system blocks. Idempotent: a system that
 * already carries {@link BILLING_HEADER_MARKER} is returned normalized but
 * without a second block, so shaping a payload twice equals shaping it once.
 *
 * @category shaping
 */
export const prependBillingHeader = (system: unknown, messages: readonly unknown[]): unknown => {
  const billingHeader = buildBillingHeaderValue(messages);
  if (billingHeader === undefined) return system;

  const blocks = Array.isArray(system)
    ? system.map(normalizeSystemBlock)
    : system == null
      ? []
      : [normalizeSystemBlock(system)];

  const alreadyCarried = blocks.some(
    (block) => Value.Check(AnthropicTextBlock, block) && block.text.includes(BILLING_HEADER_MARKER),
  );
  if (alreadyCarried) return blocks;

  return [{ type: "text", text: billingHeader }, ...blocks];
};

/**
 * Splits assistant messages that interleave text and `tool_use` blocks.
 *
 * The Messages API rejects assistant turns where non-`tool_use` blocks follow
 * a `tool_use` block on the subscription route. Such a message becomes two
 * consecutive assistant turns — text blocks, then `tool_use` blocks — which
 * is safe because the blocks are semantically independent within one turn.
 * Messages already in the accepted order pass through untouched.
 *
 * @category shaping
 */
export const splitAssistantTrailingText = (messages: readonly unknown[]): readonly unknown[] =>
  messages.flatMap((message): readonly unknown[] => {
    if (!Value.Check(AnthropicAssistantBlockMessage, message)) return [message];
    const text: unknown[] = [];
    const toolUse: unknown[] = [];
    let toolSeen = false;
    let trailingTextSeen = false;
    for (const block of message.content) {
      if (Value.Check(AnthropicToolUseBlock, block)) {
        toolSeen = true;
        toolUse.push(block);
      } else {
        if (toolSeen) trailingTextSeen = true;
        text.push(block);
      }
    }
    if (!trailingTextSeen) return [message];

    return [
      { ...message, content: text },
      { ...message, content: toolUse },
    ];
  });

/**
 * Applies both subscription shapes to one Messages API payload.
 *
 * The caller owns the gate: this function assumes the request already
 * resolved to a subscription token. Values that are not structurally a
 * Messages payload — another provider's body, a malformed value — are
 * returned untouched as a guard, never thrown on.
 *
 * @category shaping
 */
export const shapeSubscriptionPayload = (payload: unknown): unknown => {
  if (!Value.Check(AnthropicPayload, payload)) return payload;

  const messages = splitAssistantTrailingText(payload.messages);
  const system = prependBillingHeader(payload.system, messages);
  return { ...payload, messages, ...(system === undefined ? {} : { system }) };
};

/**
 * Composes the subscription shaper behind a caller-provided `onPayload`.
 *
 * Compose, not replace: an inspector the caller passed still runs first, and
 * the shaping applies last — closest to the wire.
 */
const composeOnPayload = (
  inner: StreamOptions["onPayload"],
): NonNullable<StreamOptions["onPayload"]> => {
  return async (payload, model) => {
    const upstream = inner === undefined ? payload : ((await inner(payload, model)) ?? payload);
    return shapeSubscriptionPayload(upstream);
  };
};

/**
 * The per-request seam: when the resolved credential is a subscription token,
 * the request options gain the composed shaper; otherwise they pass through
 * identically. `Models.applyAuth` resolves auth before delegating to the
 * provider, so `options.apiKey` here is the credential the request will
 * actually use.
 */
const shapedOptions = <O extends StreamOptions>(options: O | undefined): O | undefined => {
  if (options === undefined || subscriptionTokenOf(options.apiKey) === undefined) return options;
  return Object.assign({}, options, { onPayload: composeOnPayload(options.onPayload) });
};

/**
 * Re-registers the collection's `anthropic` provider with subscription
 * shaping on both of its transports.
 *
 * Both `stream` and `streamSimple` are wrapped because compaction and
 * background work go through `streamSimple`. A collection without an
 * `anthropic` provider — a faux test layer — is left untouched.
 *
 * @category wiring
 */
export const install = (collection: MutableModels): void => {
  const provider = collection.getProvider("anthropic");
  if (provider === undefined) return;
  collection.setProvider({
    ...provider,
    stream: <T extends Api>(model: Model<T>, context: Context, options?: ApiStreamOptions<T>) =>
      provider.stream(model, context, shapedOptions(options)),
    streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
      provider.streamSimple(model, context, shapedOptions(options)),
  });
};

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as AnthropicSubscription from "./anthropic-subscription";
