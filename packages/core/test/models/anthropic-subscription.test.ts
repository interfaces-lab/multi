// spec/honk-built-ins.md section 3: subscription OAuth requests carry Claude
// Code's billing header block and never send an assistant turn whose text
// follows a tool_use block; everything else — API keys, other providers,
// malformed values — passes through untouched. These tests pin the header's
// exact string shape and the strict sk-ant-oat gate, all without a network.

import type { Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { AnthropicSubscription } from "../../src/anthropic-subscription";

const {
  buildBillingHeaderValue,
  install,
  prependBillingHeader,
  shapeSubscriptionPayload,
  splitAssistantTrailingText,
  subscriptionTokenOf,
} = AnthropicSubscription;

const user = (text: string) => ({ role: "user", content: text });

describe("the billing header", () => {
  it("builds Claude Code's exact header line from the first user message", () => {
    expect(AnthropicSubscription.CLAUDE_CODE_VERSION).toBe("2.1.206");
    expect(buildBillingHeaderValue([user("Explain the auth flow in this repository.")])).toBe(
      "x-anthropic-billing-header: cc_version=2.1.206.94b; cc_entrypoint=sdk-cli; cch=a86c4;",
    );
  });

  it("pads sampled positions past the end of a short message with zeros", () => {
    expect(buildBillingHeaderValue([user("Hi")])).toBe(
      "x-anthropic-billing-header: cc_version=2.1.206.30b; cc_entrypoint=sdk-cli; cch=3639e;",
    );
  });

  it("reads the first text block of a block-content user message", () => {
    const messages = [
      { role: "assistant", content: "earlier turn" },
      { role: "user", content: [{ type: "image" }, { type: "text", text: "Hi" }] },
    ];
    expect(buildBillingHeaderValue(messages)).toContain("cch=3639e;");
  });

  it("builds nothing without a first user text", () => {
    expect(buildBillingHeaderValue([])).toBeUndefined();
    expect(
      buildBillingHeaderValue([{ role: "assistant", content: "no user turn" }]),
    ).toBeUndefined();
  });

  it("prepends exactly once: a system already carrying the marker is left alone", () => {
    const messages = [user("Hi")];
    const once = prependBillingHeader([{ type: "text", text: "harness prompt" }], messages);
    const twice = prependBillingHeader(once, messages);
    expect(twice).toEqual(once);
    expect(once).toHaveLength(2);
  });

  it("normalizes a string system into the block form under the billing block", () => {
    const shaped = prependBillingHeader("harness prompt", [user("Hi")]);
    expect(shaped).toEqual([
      { type: "text", text: expect.stringContaining("x-anthropic-billing-header:") },
      { type: "text", text: "harness prompt" },
    ]);
  });

  it("passes an unrecognized system block through unchanged", () => {
    const opaque = { type: "server_tool_use", id: "s1" };
    const shaped = prependBillingHeader(
      [opaque, { type: "text", text: "harness prompt" }],
      [user("Hi")],
    );
    expect(shaped).toEqual([
      { type: "text", text: expect.stringContaining("x-anthropic-billing-header:") },
      opaque,
      { type: "text", text: "harness prompt" },
    ]);
  });
});

describe("assistant turn splitting", () => {
  it("splits text trailing a tool_use into a text turn then a tool_use turn", () => {
    const toolUse = { type: "tool_use", id: "t1", name: "read", input: {} };
    const messages = [
      user("Hi"),
      {
        role: "assistant",
        content: [{ type: "text", text: "before" }, toolUse, { type: "text", text: "after" }],
      },
    ];
    expect(splitAssistantTrailingText(messages)).toEqual([
      user("Hi"),
      {
        role: "assistant",
        content: [
          { type: "text", text: "before" },
          { type: "text", text: "after" },
        ],
      },
      { role: "assistant", content: [toolUse] },
    ]);
  });

  it("leaves already-clean messages untouched", () => {
    const clean = [
      user("Hi"),
      {
        role: "assistant",
        content: [
          { type: "text", text: "thinking" },
          { type: "tool_use", id: "t1", name: "read", input: {} },
        ],
      },
      { role: "assistant", content: "plain string content" },
    ];
    expect(splitAssistantTrailingText(clean)).toEqual(clean);
  });
});

describe("the payload shaper", () => {
  const payload = {
    model: "claude-test",
    stream: true,
    system: [{ type: "text", text: "harness prompt" }],
    messages: [user("Hi")],
  };

  it("applies both shapes and is idempotent", () => {
    const once = shapeSubscriptionPayload(payload);
    expect(once).toMatchObject({
      model: "claude-test",
      system: [
        { type: "text", text: expect.stringContaining("x-anthropic-billing-header:") },
        { type: "text", text: "harness prompt" },
      ],
    });
    expect(shapeSubscriptionPayload(once)).toEqual(once);
  });

  it("returns values that are not a Messages payload untouched", () => {
    const foreign = { input: [], model: "gpt-test" };
    expect(shapeSubscriptionPayload(foreign)).toBe(foreign);
    expect(shapeSubscriptionPayload("not a payload")).toBe("not a payload");
    expect(shapeSubscriptionPayload(undefined)).toBeUndefined();
  });
});

describe("the subscription gate", () => {
  it("recognizes only sk-ant-oat access tokens", () => {
    expect(subscriptionTokenOf("sk-ant-oat01-abc")).toBe("sk-ant-oat01-abc");
    expect(subscriptionTokenOf("sk-ant-api03-abc")).toBeUndefined();
    expect(subscriptionTokenOf(undefined)).toBeUndefined();
  });
});

describe("installing on a collection", () => {
  const model: Model<"anthropic-messages"> = {
    id: "claude-test",
    name: "Claude Test",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };
  const context: Context = { messages: [] };
  const payload = { model: "claude-test", stream: true, messages: [user("Hi")] };

  const makeWrapped = () => {
    const captured: (SimpleStreamOptions | undefined)[] = [];
    const collection = createModels();
    collection.setProvider(
      createProvider({
        id: "anthropic",
        name: "Anthropic",
        auth: { apiKey: { name: "Anthropic API key", resolve: () => Promise.resolve(undefined) } },
        models: [model],
        api: {
          stream: (_model, _context, options) => {
            captured.push(options);
            return createAssistantMessageEventStream();
          },
          streamSimple: (_model, _context, options) => {
            captured.push(options);
            return createAssistantMessageEventStream();
          },
        },
      }),
    );
    install(collection);
    return { captured, provider: collection.getProvider("anthropic") };
  };

  it("shapes subscription requests on stream and streamSimple, composing the caller's onPayload", async () => {
    const { captured, provider } = makeWrapped();
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    const callerSaw: unknown[] = [];
    const caller = (seen: unknown) => {
      callerSaw.push(seen);
      return undefined;
    };
    provider.stream(model, context, { apiKey: "sk-ant-oat01-token", onPayload: caller });
    provider.streamSimple(model, context, { apiKey: "sk-ant-oat01-token", onPayload: caller });

    expect(captured).toHaveLength(2);
    for (const options of captured) {
      const shaped = await options?.onPayload?.(payload, model);
      expect(shaped).toMatchObject({
        system: [{ type: "text", text: expect.stringContaining("x-anthropic-billing-header:") }],
      });
    }
    expect(callerSaw).toEqual([payload, payload]);
  });

  it("passes API-key requests through with the caller's options untouched", () => {
    const { captured, provider } = makeWrapped();
    if (provider === undefined) return;

    const options = { apiKey: "sk-ant-api03-key" };
    provider.stream(model, context, options);
    provider.streamSimple(model, context, undefined);

    expect(captured[0]).toBe(options);
    expect(captured[1]).toBeUndefined();
  });

  it("leaves a collection without an anthropic provider untouched", () => {
    const collection = createModels();
    expect(() => install(collection)).not.toThrow();
    expect(collection.getProviders()).toHaveLength(0);
  });
});
