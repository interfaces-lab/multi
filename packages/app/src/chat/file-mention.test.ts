import { describe, expect, it } from "vitest";

import type { Files } from "@honk/core";

import { createMentionSearch, type MentionResults } from "./file-mention";

const entry = (path: string, kind: Files.Entry["kind"] = "file"): Files.Entry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  kind,
  size: 1,
  modifiedAt: 1,
});

describe("mention search", () => {
  type Deferred = {
    readonly promise: Promise<MentionResults>;
    readonly resolve: (results: MentionResults) => void;
    readonly reject: (error: unknown) => void;
  };
  const deferred = (): Deferred => {
    let resolve!: Deferred["resolve"];
    let reject!: Deferred["reject"];
    const promise = new Promise<MentionResults>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const harness = () => {
    const published: (MentionResults | null)[] = [];
    const listCalls: Deferred[] = [];
    const findCalls: { readonly query: string; readonly response: Deferred }[] = [];
    const pending: { run: () => void; cancelled: boolean }[] = [];
    const search = createMentionSearch(
      {
        list: () => {
          const response = deferred();
          listCalls.push(response);
          return response.promise.then((results) => results.entries);
        },
        find: (query) => {
          const response = deferred();
          findCalls.push({ query, response });
          return response.promise;
        },
      },
      (results) => published.push(results),
      (run, _delayMs) => {
        const timer = { run, cancelled: false };
        pending.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    );
    const flushTimers = () => {
      for (const timer of pending.splice(0)) {
        if (!timer.cancelled) timer.run();
      }
    };
    return { search, published, listCalls, findCalls, flushTimers };
  };

  const results = (paths: readonly string[], truncated = false): MentionResults => ({
    entries: paths.map((path) => entry(path)),
    truncated,
  });

  it("a bare @ lists the root immediately, no debounce", async () => {
    const h = harness();
    h.search.search("");
    expect(h.listCalls).toHaveLength(1);
    h.listCalls[0]!.resolve(results(["README.md"]));
    // The listing resolves through the io adapter's own then-chain.
    await new Promise((settle) => setTimeout(settle, 0));
    expect(h.published).toEqual([{ entries: [entry("README.md")], truncated: false }]);
  });

  it("typed queries debounce: keystrokes collapse into the last find", () => {
    const h = harness();
    h.search.search("c");
    h.search.search("co");
    h.search.search("com");
    expect(h.findCalls).toHaveLength(0);
    h.flushTimers();
    expect(h.findCalls.map((call) => call.query)).toEqual(["com"]);
  });

  it("a stale answer never lands after a newer search", async () => {
    const h = harness();
    h.search.search("old");
    h.flushTimers();
    h.search.search("new");
    h.flushTimers();
    // The old find resolves late, after "new" already claimed the sequence.
    h.findCalls[0]!.response.resolve(results(["old.ts"]));
    await Promise.resolve();
    h.findCalls[1]!.response.resolve(results(["new.ts"], true));
    await Promise.resolve();
    expect(h.published).toEqual([{ entries: [entry("new.ts")], truncated: true }]);
  });

  it("stop discards whatever is still in flight", async () => {
    const h = harness();
    h.search.search("");
    h.search.stop();
    h.listCalls[0]!.resolve(results(["late.ts"]));
    await new Promise((settle) => setTimeout(settle, 0));
    expect(h.published).toEqual([]);
  });

  it("a failed lookup publishes null so the menu closes instead of staling", async () => {
    const h = harness();
    h.search.search("boom");
    h.flushTimers();
    h.findCalls[0]!.response.reject(new Error("path failure"));
    await Promise.resolve();
    expect(h.published).toEqual([null]);
  });
});
