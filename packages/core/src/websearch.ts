/**
 * The `websearch` built-in tool: one keyless web search over hosted search
 * MCP endpoints.
 *
 * Each call is a single stateless JSON-RPC `tools/call` POST against Exa or
 * Parallel, and the model receives the provider's text verbatim. Selection is
 * a pure function of the environment ({@link selectProvider}); there is no
 * retry, no cross-provider fallback, no caching, and no MCP session
 * handshake. One shot per search: a 25-second timeout and a response body
 * bounded at 256 KiB with the stream cancelled at the cap.
 *
 * Failures throw, and Pi turns a thrown `execute` into a failed tool call —
 * message only — so a failed search never ends the turn or the session, and
 * the thrown messages are built from the provider name and HTTP status alone,
 * never from the request, so API keys cannot leak into model-visible text.
 *
 * @see spec/honk-built-ins.md section 10.
 * @module
 */

import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

import packageJson from "../package.json";
import type { Workspace } from "./workspace";

export const EXA_URL = "https://mcp.exa.ai/mcp";
export const PARALLEL_URL = "https://search.parallel.ai/mcp";
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const NO_RESULTS = "No search results found. Please try a different query.";
const TIMEOUT_MS = 25_000;

const websearchSchema = Type.Object({
  query: Type.String({ description: "The web search query." }),
  numResults: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 20,
      description: "Number of search results to return (default 8, maximum 20).",
    }),
  ),
  livecrawl: Type.Optional(
    Type.Union([Type.Literal("fallback"), Type.Literal("preferred")], {
      description:
        "Live crawl mode. 'fallback' uses live crawling only when the cache misses (default); 'preferred' prioritizes live crawling.",
    }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("deep")], {
      description:
        "Search type. 'auto' balances quality and speed (default), 'fast' favors quick results, 'deep' favors comprehensive results.",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 50_000,
      description: "Maximum characters of result context (default 10000, maximum 50000).",
    }),
  ),
});
export type WebsearchArgs = Static<typeof websearchSchema>;

/** The hosted endpoints a search can run against. */
export type Provider = "exa" | "parallel";

type Env = Record<string, string | undefined>;

/**
 * Which provider one search runs against, decided per call from the
 * environment: `HONK_WEBSEARCH_PROVIDER` overrides; otherwise a provider
 * with a user key beats a keyless one (Exa when both have keys); otherwise
 * Exa keyless.
 *
 * @category selection
 */
export const selectProvider = (env: Env): Provider => {
  const override = env["HONK_WEBSEARCH_PROVIDER"];
  if (override === "exa" || override === "parallel") return override;
  if (env["EXA_API_KEY"]) return "exa";
  if (env["PARALLEL_API_KEY"]) return "parallel";
  return "exa";
};

/**
 * A websearch failure whose message is safe for the model to see. The
 * classification in {@link postSearch} passes these through and rewrites
 * everything else, so a raw fetch error never reaches model-visible text.
 */
class WebsearchError extends Error {}

/** One search POST as a value: keys enter here and nowhere else. */
interface SearchRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  /** Whether a user key rode along, deciding what a 429 should advise. */
  readonly keyed: boolean;
}

/** The input fields with defaults applied. They are Exa's; Parallel takes only the query. */
interface ResolvedArgs {
  readonly query: string;
  readonly type: "auto" | "fast" | "deep";
  readonly numResults: number;
  readonly livecrawl: "fallback" | "preferred";
  readonly contextMaxCharacters: number;
}

interface WebsearchResult {
  readonly content: [{ readonly type: "text"; readonly text: string }];
  readonly details: { readonly provider: Provider };
}

const BASE_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

const jsonRpcCall = (tool: string, args: unknown): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });

const buildRequest = (provider: Provider, args: ResolvedArgs, env: Env): SearchRequest => {
  if (provider === "exa") {
    const url = new URL(EXA_URL);
    const key = env["EXA_API_KEY"];
    if (key) url.searchParams.set("exaApiKey", key);
    return {
      url: url.toString(),
      headers: BASE_HEADERS,
      body: jsonRpcCall("web_search_exa", args),
      keyed: Boolean(key),
    };
  }
  const key = env["PARALLEL_API_KEY"];
  return {
    url: PARALLEL_URL,
    headers: {
      ...BASE_HEADERS,
      // Identifies honk and nothing else: no session or model identifiers
      // ever reach the provider.
      "user-agent": `honk/${packageJson.version}`,
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: jsonRpcCall("web_search", { objective: args.query, search_queries: [args.query] }),
    keyed: Boolean(key),
  };
};

/**
 * What a response body said. Three outcomes on purpose: an empty result list
 * is a successful search that found nothing, while an unparseable body is a
 * failed call — collapsing them would report provider breakage as "no
 * results".
 */
type ParseOutcome =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "empty" }
  | { readonly kind: "unparseable" };

const SearchTextContent = Type.Object({
  type: Type.Literal("text"),
  text: Type.String(),
});
const SearchResponse = Type.Object({
  result: Type.Object({ content: Type.Array(Type.Unknown()) }),
});

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The first non-empty text content item of one JSON-RPC result, or undefined when the value is not one. */
const contentTextOf = (
  value: unknown,
): Exclude<ParseOutcome, { kind: "unparseable" }> | undefined => {
  if (!Value.Check(SearchResponse, value)) return undefined;
  for (const item of value.result.content) {
    if (Value.Check(SearchTextContent, item) && item.text !== "") {
      return { kind: "text", text: item.text };
    }
  }
  return { kind: "empty" };
};

/** Parses a JSON body directly, or the first valid JSON-RPC `data:` frame of an SSE body. */
const parseBody = (body: string): ParseOutcome => {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    const direct = contentTextOf(tryJson(trimmed));
    if (direct !== undefined) return direct;
  }
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const framed = contentTextOf(tryJson(line.slice("data: ".length)));
    if (framed !== undefined) return framed;
  }
  return { kind: "unparseable" };
};

const oversizeError = (provider: Provider): WebsearchError =>
  new WebsearchError(
    `websearch: the ${provider} response exceeded ${MAX_RESPONSE_BYTES / 1024} KiB.`,
  );

/**
 * Collects the body while enforcing the byte cap: Content-Length rejects
 * early when the provider declares the overrun, and the streaming count
 * cancels the reader at the cap so an unbounded body is never buffered.
 */
const readBodyBounded = async (response: Response, provider: Provider): Promise<string> => {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) throw oversizeError(provider);
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw oversizeError(provider);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const postSearch = async (
  fetchImpl: typeof fetch,
  provider: Provider,
  request: SearchRequest,
  callerSignal: AbortSignal | undefined,
): Promise<string> => {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout]);
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal,
    });
    if (response.status === 429) {
      // Suggesting the key env var only helps when no key was sent; a keyed
      // request was rate limited despite it, so the only advice is patience.
      if (request.keyed) {
        throw new WebsearchError(
          `websearch: ${provider} rate limited this request (HTTP 429). Try again later.`,
        );
      }
      const keyVar = provider === "exa" ? "EXA_API_KEY" : "PARALLEL_API_KEY";
      throw new WebsearchError(
        `websearch: ${provider} rate limited this request (HTTP 429). Set ${keyVar} to raise the limit.`,
      );
    }
    if (!response.ok) {
      throw new WebsearchError(`websearch: ${provider} answered HTTP ${response.status}.`);
    }
    return await readBodyBounded(response, provider);
  } catch (error) {
    // Our own typed failures pass through; everything else is classified so
    // the model sees one honest line and never a raw fetch error, which can
    // embed the request URL (and with it the Exa key).
    if (error instanceof WebsearchError) throw error;
    // A caller abort is a cancellation, not a search failure: rethrown as-is
    // so Pi's own abort handling classifies it.
    if (callerSignal?.aborted === true) throw error;
    if (timeout.aborted) {
      throw new WebsearchError(
        `websearch: ${provider} did not answer within ${TIMEOUT_MS / 1000} seconds.`,
      );
    }
    throw new WebsearchError(`websearch: could not reach ${provider}.`, { cause: error });
  }
};

/**
 * Builds the websearch tool. Stateless: the environment is read at call time,
 * so a key exported after the session opened is picked up by the next search.
 * `fetch` and `env` are injectable so tests run offline and deterministic.
 *
 * @category construction
 */
export const makeWebsearchTool = (options?: {
  readonly fetch?: typeof fetch;
  readonly env?: Env;
}) => ({
  name: "websearch",
  label: "Websearch",
  description:
    "Search the web for current information beyond the knowledge cutoff. " +
    "Backed by Exa or Parallel hosted search; no API key required. " +
    `The current year is ${new Date().getFullYear()}. Use it when searching for recent information or current events.`,
  parameters: websearchSchema,
  execute: async (
    _toolCallId: string,
    params: WebsearchArgs,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _context: { readonly env: Workspace.ExecutionEnv },
  ): Promise<WebsearchResult> => {
    const env = options?.env ?? process.env;
    const provider = selectProvider(env);
    const request = buildRequest(
      provider,
      {
        query: params.query,
        type: params.type ?? "auto",
        numResults: params.numResults ?? 8,
        livecrawl: params.livecrawl ?? "fallback",
        contextMaxCharacters: params.contextMaxCharacters ?? 10_000,
      },
      env,
    );
    const body = await postSearch(options?.fetch ?? globalThis.fetch, provider, request, signal);
    const outcome = parseBody(body);
    if (outcome.kind === "unparseable") {
      throw new WebsearchError(`websearch: could not parse the ${provider} response.`);
    }
    return {
      content: [{ type: "text", text: outcome.kind === "text" ? outcome.text : NO_RESULTS }],
      details: { provider },
    };
  },
});
export type WebsearchTool = ReturnType<typeof makeWebsearchTool>;

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Websearch from "./websearch";
