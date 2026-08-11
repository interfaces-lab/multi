import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from "@tanstack/react-router";
import * as React from "react";
import { describe, expect, it } from "vitest";

import { ChatStartRoute, ChatThreadRoute } from "./route-pages";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let settle: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (settle === null) throw new Error("Deferred promise has no resolver.");
      settle(value);
    },
  };
}

describe("chat route modules", () => {
  it("exposes router-owned preloaders instead of hidden React.lazy boundaries", () => {
    expect(ChatStartRoute.preload).toBeTypeOf("function");
    expect(ChatThreadRoute.preload).toBeTypeOf("function");
  });

  it("keeps Home matched until the thread route module is ready", async () => {
    const threadModule = deferred<{ Thread: () => React.ReactElement }>();
    const rootRoute = createRootRoute({ component: Outlet });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => React.createElement("div", null, "Home"),
    });
    const threadRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/chat/$sessionId",
      component: lazyRouteComponent(() => threadModule.promise, "Thread"),
      pendingMs: Infinity,
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      isServer: false,
      origin: "http://localhost",
      routeTree: rootRoute.addChildren([homeRoute, threadRoute]),
    });
    await router.load();

    const navigation = router.navigate({
      to: "/chat/$sessionId",
      params: { sessionId: "ses_pending" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(router.state.isLoading).toBe(true);
    expect(router.state.matches.map((match) => match.routeId)).toEqual(["__root__", "/"]);

    threadModule.resolve({ Thread: () => React.createElement("div", null, "Thread") });
    await navigation;
    expect(router.state.matches.map((match) => match.routeId)).toEqual([
      "__root__",
      "/chat/$sessionId",
    ]);
  });
});
