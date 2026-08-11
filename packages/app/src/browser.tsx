import * as stylex from "@stylexjs/stylex";
import type { Session } from "@honk/core/session";
import { ThreadId } from "@honk/shared/base-schemas";
import type { DesktopBrowserViewState } from "@honk/shared/desktop-api";
import { Field, Icon, IconButton, Spinner, Text, Tooltip } from "@honk/ui";
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowRotateClockwise,
  IconBrowserTabs,
  IconPictureInPicture,
} from "@honk/ui/icons";
import { colorVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { applyBrowserViewState, browserResourceFor, browserResourceID } from "./browser-store";
import { browserLayout } from "./browser-layout.stylex";
import { normalizeBrowserNavigationInput } from "./browser-url";
import { readDesktopBrowserAvailability, type DesktopBrowserBridge } from "./desktop-bridge";
import { errorMessage } from "./error-message";
import { actions as toastActions } from "./toast-store";

const styles = stylex.create({
  notice: {
    flexShrink: 0,
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlock: spaceVars["--honk-space-gutter"],
    backgroundColor: colorVars["--honk-color-err-bg"],
  },
});

function DesktopBrowserSurface({
  sessionId,
  directory,
  resourceID = "default",
  browserBridge,
  isVisible = true,
}: {
  readonly sessionId: Session.SessionId;
  readonly directory: string;
  readonly resourceID?: string;
  readonly browserBridge: DesktopBrowserBridge;
  readonly isVisible?: boolean;
}): React.ReactElement {
  const browserId = browserResourceID(sessionId, resourceID);
  const resource = browserResourceFor(sessionId, resourceID);
  const snapshot = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  const [surfaceId] = React.useState(() => crypto.randomUUID());
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const readyRef = React.useRef(false);
  const navigationInFlightRef = React.useRef<number | null>(null);
  const driveNavigationRef = React.useRef<() => void>(() => undefined);
  const syncViewRef = React.useRef<() => void>(() => undefined);
  const { syncBrowserView, detachBrowserView, commandBrowserView } = browserBridge;
  const hasPage = snapshot.committedUrl.length > 0 || snapshot.isLoading;

  const applyState = (state: DesktopBrowserViewState): void => {
    if (state.browserId === browserId) applyBrowserViewState(state);
  };

  const driveNavigation = (): void => {
    if (!readyRef.current) return;
    const request = resource.getNavigationRequest();
    if (request === null || navigationInFlightRef.current === request.id) return;
    navigationInFlightRef.current = request.id;
    void commandBrowserView({ browserId, type: "navigate", url: request.url })
      .then((state) => {
        resource.acknowledgeNavigation(request.id);
        applyState(state);
      })
      .catch((cause: unknown) => {
        resource.patch({ isLoading: false, loadError: errorMessage(cause) });
      })
      .finally(() => {
        if (navigationInFlightRef.current === request.id) navigationInFlightRef.current = null;
      });
  };

  const syncView = (): void => {
    const host = hostRef.current;
    if (host === null) return;
    const bounds = host.getBoundingClientRect();
    void syncBrowserView({
      browserId,
      surfaceId,
      workspaceKey: directory,
      tabId: `browser:${browserId}`,
      threadId: ThreadId.make(sessionId),
      bounds: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      visible: isVisible && hasPage && bounds.width > 0 && bounds.height > 0,
      active: isVisible,
    })
      .then((state) => {
        if (hostRef.current !== host) return;
        readyRef.current = true;
        applyState(state);
        driveNavigationRef.current();
      })
      .catch((cause: unknown) => {
        if (hostRef.current !== host) return;
        readyRef.current = false;
        resource.patch({ isLoading: false, loadError: errorMessage(cause) });
      });
  };

  React.useLayoutEffect(() => {
    driveNavigationRef.current = driveNavigation;
    syncViewRef.current = syncView;
  });

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let frame = 0;
    const scheduleSync = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncViewRef.current();
      });
    };
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(host);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, true);
    scheduleSync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      readyRef.current = false;
      void detachBrowserView({ browserId, surfaceId }).catch(() => undefined);
    };
  }, [browserId, detachBrowserView, surfaceId]);

  React.useEffect(() => {
    syncViewRef.current();
  }, [directory, hasPage, isVisible]);

  React.useEffect(
    () => resource.subscribeNavigation(() => driveNavigationRef.current()),
    [resource],
  );

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const url = normalizeBrowserNavigationInput(resource.getSnapshot().inputValue);
    if (url !== null) resource.requestNavigation(url);
  };

  const runNavigationCommand = (type: "back" | "forward" | "reload"): void => {
    void commandBrowserView({ browserId, type })
      .then(applyState)
      .catch((cause: unknown) => {
        resource.patch({ isLoading: false, loadError: errorMessage(cause) });
      });
  };

  const startPictureInPicture = (): void => {
    void commandBrowserView({ browserId, type: "picture-in-picture" })
      .then(applyState)
      .catch((cause: unknown) => {
        toastActions.add({
          type: "error",
          title: "Picture in Picture failed",
          description: errorMessage(cause),
          threadKey: sessionId,
        });
      });
  };

  return (
    <div {...stylex.props(browserLayout.root)}>
      <form {...stylex.props(browserLayout.toolbar)} onSubmit={submit}>
        <Tooltip label="Back">
          <IconButton
            aria-label="Back"
            size="sm"
            disabled={!snapshot.canGoBack}
            onClick={() => runNavigationCommand("back")}
          >
            <Icon icon={IconArrowLeft} size="sm" />
          </IconButton>
        </Tooltip>
        <Tooltip label="Forward">
          <IconButton
            aria-label="Forward"
            size="sm"
            disabled={!snapshot.canGoForward}
            onClick={() => runNavigationCommand("forward")}
          >
            <Icon icon={IconArrowRight} size="sm" />
          </IconButton>
        </Tooltip>
        <Tooltip label="Reload">
          <IconButton
            aria-label="Reload"
            size="sm"
            disabled={snapshot.committedUrl.length === 0}
            onClick={() => runNavigationCommand("reload")}
          >
            <Icon icon={IconArrowRotateClockwise} size="sm" />
          </IconButton>
        </Tooltip>
        <div {...stylex.props(browserLayout.location)}>
          <Field size="md">
            <Field.Input
              aria-label="Browser location"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search or enter URL"
              value={snapshot.inputValue}
              onChange={(event) => resource.patch({ inputValue: event.currentTarget.value })}
            />
          </Field>
        </div>
        <Tooltip label="Picture in Picture">
          <IconButton
            type="button"
            aria-label="Picture in Picture"
            size="sm"
            disabled={!snapshot.canPictureInPicture}
            onClick={startPictureInPicture}
          >
            <Icon icon={IconPictureInPicture} size="sm" />
          </IconButton>
        </Tooltip>
        {snapshot.isLoading ? <Spinner label="Loading page" tone="muted" size="sm" /> : null}
      </form>
      {snapshot.loadError === null ? null : (
        <div {...stylex.props(styles.notice)}>
          <Text as="p" size="xs" tone="err">
            {snapshot.loadError}
          </Text>
        </div>
      )}
      <div ref={hostRef} aria-label="Browser page" {...stylex.props(browserLayout.host)}>
        {!hasPage ? (
          <div {...stylex.props(browserLayout.center)}>
            <Icon icon={IconBrowserTabs} size="xl" tone="faint" />
            <Text as="p" size="sm" tone="muted" weight="regular">
              Open a page
            </Text>
            <Text as="p" size="xs" tone="faint">
              Enter an address or search. Browser history stays with this chat.
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BrowserSurface({
  sessionId,
  directory,
  resourceID = "default",
  isVisible = true,
}: {
  readonly sessionId: Session.SessionId;
  readonly directory: string;
  readonly resourceID?: string;
  readonly isVisible?: boolean;
}): React.ReactElement {
  const availability = readDesktopBrowserAvailability();
  if (availability.status === "ready") {
    return (
      <DesktopBrowserSurface
        sessionId={sessionId}
        directory={directory}
        resourceID={resourceID}
        browserBridge={availability.bridge}
        isVisible={isVisible}
      />
    );
  }

  const requiresRestart = availability.status === "restart-required";
  return (
    <div {...stylex.props(browserLayout.root)}>
      <div {...stylex.props(browserLayout.host)}>
        <div {...stylex.props(browserLayout.center)}>
          <Icon icon={IconBrowserTabs} size="xl" tone="faint" />
          <Text as="p" size="sm" tone="muted" weight="regular">
            {requiresRestart
              ? "Restart Honk to finish the browser upgrade"
              : "Browser works only in the desktop app"}
          </Text>
          <Text as="p" size="xs" tone="faint">
            {requiresRestart
              ? "The running desktop preload predates the native browser bridge."
              : "The web app cannot embed pages or give the agent browser control."}
          </Text>
        </div>
      </div>
    </div>
  );
}

export { BrowserSurface };
