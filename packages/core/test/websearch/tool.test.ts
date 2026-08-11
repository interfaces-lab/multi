// The websearch built-in offline: provider selection, request shaping, body
// parsing and bounding, the failure surface, and the key-leak and
// write-attribution invariants. Every fetch is faux; no network.

import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { createExecutionEnv } from "../../src/testing";
import { Tools } from "../../src/tools";
import { Websearch, type WebsearchArgs } from "../../src/websearch";

const rpcBody = (content: readonly unknown[]): string =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content } });

const okJson = (content: readonly unknown[]): Response =>
  new Response(rpcBody(content), { status: 200 });

const textItem = (text: string) => ({ type: "text", text });

interface SentRequest {
  readonly url: string;
  readonly init: RequestInit;
}

const SentPayload = Type.Object({
  params: Type.Object({
    name: Type.String(),
    arguments: Type.Record(Type.String(), Type.Unknown()),
  }),
});
const StringBody = Type.String();
const executionEnv = createExecutionEnv(process.cwd());

/** Runs one search against a faux fetch and returns what went over the wire. */
const search = async (input: {
  readonly env?: Record<string, string | undefined>;
  readonly respond?: (sent: SentRequest) => Response;
  readonly params?: Partial<WebsearchArgs>;
}) => {
  const sent: SentRequest[] = [];
  const fauxFetch: typeof fetch = async (target, init) => {
    const url =
      target instanceof URL ? target.href : target instanceof Request ? target.url : target;
    const request = { url, init: init ?? {} };
    sent.push(request);
    return (input.respond ?? (() => okJson([textItem("the answer")])))(request);
  };
  const tool = Websearch.makeWebsearchTool({ fetch: fauxFetch, env: input.env ?? {} });
  const result = await tool.execute(
    "call-1",
    { query: "honk core release", ...input.params },
    undefined,
    undefined,
    { env: executionEnv },
  );
  return { sent, result };
};

const bodyText = (request: SentRequest): string => {
  return Value.Parse(StringBody, request.init.body);
};

const sentPayload = (request: SentRequest) =>
  Value.Parse(SentPayload, JSON.parse(bodyText(request)));

describe("selectProvider", () => {
  it("override wins, a key beats keyless, both keys pick exa, default is exa", () => {
    expect(Websearch.selectProvider({})).toBe("exa");
    expect(Websearch.selectProvider({ PARALLEL_API_KEY: "pk" })).toBe("parallel");
    expect(Websearch.selectProvider({ EXA_API_KEY: "ek" })).toBe("exa");
    expect(Websearch.selectProvider({ EXA_API_KEY: "ek", PARALLEL_API_KEY: "pk" })).toBe("exa");
    expect(
      Websearch.selectProvider({ HONK_WEBSEARCH_PROVIDER: "parallel", EXA_API_KEY: "ek" }),
    ).toBe("parallel");
    expect(
      Websearch.selectProvider({ HONK_WEBSEARCH_PROVIDER: "exa", PARALLEL_API_KEY: "pk" }),
    ).toBe("exa");
    expect(
      Websearch.selectProvider({ HONK_WEBSEARCH_PROVIDER: "nonsense", PARALLEL_API_KEY: "pk" }),
    ).toBe("parallel");
  });
});

describe("request shaping", () => {
  it("exa carries every search field and the key rides the URL", async () => {
    const { sent } = await search({
      env: { EXA_API_KEY: "exa-secret-key" },
      params: { numResults: 3, livecrawl: "preferred", type: "deep", contextMaxCharacters: 2000 },
    });
    const [request] = sent;
    expect(request?.url).toBe("https://mcp.exa.ai/mcp?exaApiKey=exa-secret-key");
    expect(request?.init.headers).toMatchObject({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    expect(sentPayload(request!)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: "honk core release",
          type: "deep",
          numResults: 3,
          livecrawl: "preferred",
          contextMaxCharacters: 2000,
        },
      },
    });
  });

  it("omitted fields take the documented defaults and a keyless exa URL is bare", async () => {
    const { sent } = await search({});
    expect(sent[0]?.url).toBe("https://mcp.exa.ai/mcp");
    const params = sentPayload(sent[0]!).params;
    expect(params.arguments).toEqual({
      query: "honk core release",
      type: "auto",
      numResults: 8,
      livecrawl: "fallback",
      contextMaxCharacters: 10_000,
    });
  });

  it("parallel sends objective and search_queries only, with bearer auth and a honk user-agent", async () => {
    const { sent } = await search({
      env: { PARALLEL_API_KEY: "parallel-secret-key" },
      params: { numResults: 3, type: "deep" },
    });
    const [request] = sent;
    expect(request?.url).toBe("https://search.parallel.ai/mcp");
    expect(request?.init.headers).toMatchObject({
      authorization: "Bearer parallel-secret-key",
      "user-agent": "honk/0.0.0",
    });
    const params = sentPayload(request!).params;
    expect(params.name).toBe("web_search");
    expect(params.arguments).toEqual({
      objective: "honk core release",
      search_queries: ["honk core release"],
    });
    // No session or model identity crosses the wire, only the query.
    expect(bodyText(request!)).not.toMatch(/session|model/);
  });
});

describe("response parsing", () => {
  it("a JSON body hands the model the provider text verbatim", async () => {
    const { result } = await search({
      respond: () => okJson([textItem("verbatim provider text")]),
    });
    expect(result.content).toEqual([{ type: "text", text: "verbatim provider text" }]);
    expect(result.details).toEqual({ provider: "exa" });
  });

  it("an SSE body parses the first valid JSON-RPC data frame", async () => {
    const body = `event: message\ndata: not json\ndata: ${rpcBody([textItem("from the frame")])}\n\n`;
    const { result } = await search({ respond: () => new Response(body, { status: 200 }) });
    expect(result.content).toEqual([{ type: "text", text: "from the frame" }]);
  });

  it("an empty or text-free result is the no-results line, as a success", async () => {
    const empty = await search({ respond: () => okJson([]) });
    expect(empty.result.content).toEqual([{ type: "text", text: Websearch.NO_RESULTS }]);
    const textFree = await search({ respond: () => okJson([{ type: "image", text: "" }]) });
    expect(textFree.result.content).toEqual([{ type: "text", text: Websearch.NO_RESULTS }]);
  });

  it("an unparseable body fails the call", async () => {
    await expect(
      search({ respond: () => new Response("<html>service page</html>", { status: 200 }) }),
    ).rejects.toThrow("websearch: could not parse the exa response.");
  });
});

describe("the body cap", () => {
  it("a declared oversize Content-Length rejects before reading", async () => {
    const respond = () =>
      new Response(null, { status: 200, headers: { "content-length": String(300 * 1024) } });
    await expect(search({ respond })).rejects.toThrow("exceeded 256 KiB");
  });

  it("a streamed body over 256 KiB fails and the reader is cancelled at the cap", async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(search({ respond: () => new Response(endless, { status: 200 }) })).rejects.toThrow(
      "exceeded 256 KiB",
    );
    expect(cancelled).toBe(true);
  });
});

describe("the failure surface", () => {
  it("a keyless 429 names the key that raises the limit", async () => {
    const respond = () => new Response("", { status: 429 });
    await expect(search({ respond })).rejects.toThrow(
      "websearch: exa rate limited this request (HTTP 429). Set EXA_API_KEY to raise the limit.",
    );
    await expect(search({ env: { HONK_WEBSEARCH_PROVIDER: "parallel" }, respond })).rejects.toThrow(
      /rate limited.*PARALLEL_API_KEY/,
    );
  });

  it("a keyed 429 advises retrying, not setting the key already sent", async () => {
    const respond = () => new Response("", { status: 429 });
    await expect(search({ env: { EXA_API_KEY: "ek" }, respond })).rejects.toThrow(
      "websearch: exa rate limited this request (HTTP 429). Try again later.",
    );
    await expect(search({ env: { PARALLEL_API_KEY: "pk" }, respond })).rejects.toThrow(
      "websearch: parallel rate limited this request (HTTP 429). Try again later.",
    );
  });

  it("any other non-2xx fails with the status", async () => {
    await expect(search({ respond: () => new Response("", { status: 503 }) })).rejects.toThrow(
      "websearch: exa answered HTTP 503.",
    );
  });

  it("a fetch-level failure is one honest line, not a raw error", async () => {
    const respond = () => {
      throw new TypeError("fetch failed: https://mcp.exa.ai/mcp?exaApiKey=exa-secret-key");
    };
    await expect(search({ env: { EXA_API_KEY: "exa-secret-key" }, respond })).rejects.toThrow(
      "websearch: could not reach exa.",
    );
  });
});

describe("keys never leak", () => {
  it("neither output nor failure text ever carries a key", async () => {
    const success = await search({ env: { EXA_API_KEY: "exa-secret-key" } });
    expect(JSON.stringify(success.result)).not.toContain("exa-secret-key");

    const failures = [
      search({
        env: { EXA_API_KEY: "exa-secret-key" },
        respond: () => new Response("", { status: 500 }),
      }),
      search({
        env: { PARALLEL_API_KEY: "parallel-secret-key" },
        respond: () => new Response("", { status: 429 }),
      }),
    ];
    for (const failure of failures) {
      const message = await failure.then(
        () => "unexpected success",
        (error: Error) => error.message,
      );
      expect(message).toMatch(/HTTP (500|429)/);
      expect(message).not.toContain("secret-key");
    }
  });
});

describe("write attribution", () => {
  // The read-only harness keeps websearch by construction: createWorkspaceHarness
  // appends it outside the writesOf filter, and exercising that construction
  // needs a full Pi session fixture, so the classifier is pinned here instead.
  it("writesOf answers none, the classification read-only shapes rely on", () => {
    expect(Tools.writesOf("websearch", { query: "anything" })).toEqual({ kind: "none" });
  });
});
