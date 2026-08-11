// Home and /chat render this one start surface. The composer owns creation;
// the page gives it a stable frame, provider recovery, the web-only workspace
// fallback, and recent top-level threads.

import { basename } from "@honk/shared/paths";
import { Button, Icon, ListRow, Matrix, Separator, Spinner, Text } from "@honk/ui";
import { IconFolder1 } from "@honk/ui/icons";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { useDefaultProjectDirectory } from "../app-settings-store";
import { canPickFolder } from "../desktop-bridge";
import { DirectoryPicker } from "../directory-picker";
import { actions as settingsActions } from "../settings-store";
import { useHonkCore } from "./client";
import { ChatComposer } from "./composer";
import { agoLabel, inventoryRows } from "./inventory-model";
import { useInventory } from "./inventory-store";
import { useCatalogPhase } from "./model-catalog";
import { readRecent, rememberRecent, resolveStartDirectory } from "./selection";

const START_CONTENT_MAX_WIDTH = "720px";
// Fixed lane keeps the primary composer in the same place as it grows.
const COMPOSER_LANE_HEIGHT = "256px";
// The global thread finder owns deeper history.
const RECENT_THREAD_LIMIT = 64;
const RECENT_TIME_TICK_MS = 60_000;
const CLOCK_UNAVAILABLE = 0;

// One minute clock keeps relative labels current without reading time during
// render. It runs only while a start surface is mounted.
const clockListeners = new Set<() => void>();
let clockNowMs = CLOCK_UNAVAILABLE;
let clockTimer: number | null = null;

function getClockSnapshot(): number {
  const next = Date.now();
  if (next - clockNowMs >= RECENT_TIME_TICK_MS) clockNowMs = next;
  return clockNowMs;
}

function getClockServerSnapshot(): number {
  return CLOCK_UNAVAILABLE;
}

function subscribeClock(onStoreChange: () => void): () => void {
  clockListeners.add(onStoreChange);
  if (clockTimer === null) {
    clockTimer = window.setInterval(() => {
      clockNowMs = Date.now();
      for (const listener of clockListeners) listener();
    }, RECENT_TIME_TICK_MS);
  }
  return () => {
    clockListeners.delete(onStoreChange);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function useRecentThreadsNow(): number {
  return React.useSyncExternalStore(subscribeClock, getClockSnapshot, getClockServerSnapshot);
}

const styles = stylex.create({
  page: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    overflow: "hidden",
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  composerLane: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    flexShrink: 0,
    height: COMPOSER_LANE_HEIGHT,
    width: "100%",
    maxWidth: START_CONTENT_MAX_WIDTH,
    marginInline: "auto",
    paddingBlock: spaceVars["--honk-space-panel-pad"],
  },
  content: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: START_CONTENT_MAX_WIDTH,
    marginInline: "auto",
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingBottom: spaceVars["--honk-space-panel-pad"],
    scrollbarWidth: "thin",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
  },
  sectionHead: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
  },
  providerNotice: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-panel-pad"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
  },
  providerCopy: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  state: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  fullState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    minHeight: 0,
    padding: spaceVars["--honk-space-panel-pad"],
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
  },
  stale: {
    paddingBottom: spaceVars["--honk-space-gutter"],
  },
  rows: {
    display: "flex",
    flexDirection: "column",
  },
  working: {
    display: "inline-grid",
    placeItems: "center",
  },
});

function CoreStatus({
  status,
}: {
  readonly status: "connecting" | "unavailable";
}): React.ReactElement {
  return (
    <div data-start-surface="" {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.fullState)}>
        {status === "connecting" ? (
          <div role="status" {...stylex.props(styles.state)}>
            <Spinner size="sm" />
            Connecting to Honk Core…
          </div>
        ) : (
          <Text as="p" size="sm" tone="muted" role="alert">
            Honk can't start threads in this window. Restart Honk, then try again.
          </Text>
        )}
      </div>
    </div>
  );
}

function ProviderSetup(): React.ReactElement {
  return (
    <>
      <div role="status" {...stylex.props(styles.providerNotice)}>
        <div {...stylex.props(styles.providerCopy)}>
          <Text as="div" size="sm" weight="semibold">
            Connect a model provider
          </Text>
          <Text as="div" size="sm" tone="muted">
            Honk needs a provider before it can start a thread.
          </Text>
        </div>
        <Button
          size="sm"
          onClick={() => {
            settingsActions.open("providers");
          }}
        >
          Open provider settings
        </Button>
      </div>
      <Separator />
    </>
  );
}

function RecentThreads(): React.ReactElement {
  const navigate = useNavigate();
  const inventory = useInventory();
  const rows = inventoryRows(inventory.sessions).slice(0, RECENT_THREAD_LIMIT);
  const now = useRecentThreadsNow();
  const isStale = inventory.status === "disconnected" || inventory.status === "failed";

  return (
    <section aria-labelledby="start-recent-threads" {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <Text
          id="start-recent-threads"
          as="div"
          role="heading"
          aria-level={2}
          size="sm"
          weight="semibold"
          tone="muted"
        >
          Recent threads
        </Text>
      </div>

      {inventory.status === "connecting" ? (
        <div role="status" {...stylex.props(styles.state)}>
          <Spinner size="sm" />
          Loading recent threads…
        </div>
      ) : rows.length === 0 ? (
        <div role={isStale ? "status" : undefined} {...stylex.props(styles.empty)}>
          <Text as="p" size="sm" tone="muted">
            {isStale ? "Recent threads aren't available." : "No threads yet"}
          </Text>
          <Text as="p" size="xs" tone="faint" align="center">
            {isStale ? "You can still start a thread above." : "Send a prompt above to start one."}
          </Text>
        </div>
      ) : (
        <>
          {isStale ? (
            <div role="status" {...stylex.props(styles.stale)}>
              <Text as="p" size="xs" tone="faint">
                Recent thread updates stopped. Existing threads may be out of date.
              </Text>
            </div>
          ) : null}
          <div {...stylex.props(styles.rows)}>
            {rows.map((row) => (
              <ListRow
                key={row.id}
                title={row.directory}
                onClick={() => {
                  void navigate({ to: "/chat/$sessionId", params: { sessionId: row.id } });
                }}
              >
                <ListRow.Slot>
                  <Icon icon={IconFolder1} size="sm" tone="faint" />
                </ListRow.Slot>
                <ListRow.Content>
                  <ListRow.Title>{row.title ?? basename(row.directory)}</ListRow.Title>
                  <ListRow.Description>{row.directory}</ListRow.Description>
                </ListRow.Content>
                <ListRow.Meta>
                  {row.working ? (
                    <span aria-label="Working" {...stylex.props(styles.working)}>
                      <Matrix grid={4} isActive />
                    </span>
                  ) : (
                    agoLabel(now, row.updatedAt)
                  )}
                </ListRow.Meta>
              </ListRow>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function WorkspaceFallback({
  recentDirectories,
  onSelect,
}: {
  readonly recentDirectories: readonly string[];
  readonly onSelect: (directory: string) => void;
}): React.ReactElement {
  return (
    <>
      <section aria-labelledby="start-workspace" {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHead)}>
          <Text
            id="start-workspace"
            as="div"
            role="heading"
            aria-level={2}
            size="sm"
            weight="semibold"
            tone="muted"
          >
            Choose a workspace
          </Text>
          <Text as="p" size="xs" tone="faint">
            This thread can read and change files in the selected folder. Honk asks before opening
            an untrusted folder.
          </Text>
        </div>
        <DirectoryPicker recentDirectories={recentDirectories} onSelect={onSelect} />
      </section>
      <Separator />
    </>
  );
}

export function ChatStartPage(): React.ReactElement {
  const core = useHonkCore();
  const defaultDirectory = useDefaultProjectDirectory();
  const [recentDirectories, setRecentDirectories] = React.useState<readonly string[]>(readRecent);
  const [directory, setDirectory] = React.useState<string | null>(() =>
    resolveStartDirectory(defaultDirectory, recentDirectories),
  );
  const catalog = useCatalogPhase();
  const noConfiguredProvider =
    catalog.status === "ready" &&
    !catalog.providers.some((provider) => provider.configured && provider.models.length > 0);

  if (core.status === "connecting") return <CoreStatus status="connecting" />;
  if (core.status === "unavailable") return <CoreStatus status="unavailable" />;

  const pickDirectory = (directory: string): void => {
    setRecentDirectories(rememberRecent(directory));
    setDirectory(directory);
  };

  return (
    <div data-start-surface="" {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.composerLane)}>
        <ChatComposer directory={directory} onDirectoryChange={setDirectory} />
      </div>

      <div data-start-surface-content="" {...stylex.props(styles.content)}>
        {noConfiguredProvider ? <ProviderSetup /> : null}
        {!canPickFolder() ? (
          <WorkspaceFallback recentDirectories={recentDirectories} onSelect={pickDirectory} />
        ) : null}
        <RecentThreads />
      </div>
    </div>
  );
}
