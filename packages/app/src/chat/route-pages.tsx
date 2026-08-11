// These are router-owned lazy components, not nested React.lazy boundaries.
// TanStack can therefore finish loading the destination before it commits the
// route, keeping the current page mounted instead of painting an empty sheet.

import { lazyRouteComponent } from "@tanstack/react-router";

export const ChatStartRoute = lazyRouteComponent(() => import("./start-page"), "ChatStartPage");

export const ChatThreadRoute = lazyRouteComponent(() => import("./thread-page"), "ChatThreadPage");
