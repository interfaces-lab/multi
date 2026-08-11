import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";

import { RootErrorView, RootGate, RootNotFoundView } from "./boot";
import { ChatStartRoute, ChatThreadRoute } from "./chat/route-pages";
import { ONBOARDING_PATH, OnboardingPage } from "./onboarding";

const HomeRoute = lazyRouteComponent(() => import("./home"), "HomePage");

const rootRoute = createRootRoute({
  component: RootGate,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
});

// First run lands here directly (the desktop window opens honk://desktop/setup),
// and the command menu replays it by navigating.
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ONBOARDING_PATH,
  // `replay` marks a revisit from the command menu, which Escape may leave.
  // First run arrives without it and has no exit but finishing.
  validateSearch: (search: Record<string, unknown>) => ({
    replay: search.replay === true || search.replay === "1",
  }),
  component: OnboardingPage,
});

// The Honk Core chat view: thread on the left, workbench on the right. It
// renders inside the app shell like every other route — no bare page, no
// separate gate — so the chat is always exercised in the whole app. Workbench
// tool selection is component state, not a route segment.
const chatStartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatStartRoute,
});

const chatThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$sessionId",
  component: ChatThreadRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  chatStartRoute,
  chatThreadRoute,
]);

const router = createRouter({
  routeTree,
  defaultStructuralSharing: true,
  defaultErrorComponent: RootErrorView,
  defaultNotFoundComponent: RootNotFoundView,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { router };
