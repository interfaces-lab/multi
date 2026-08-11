import * as stylex from "@stylexjs/stylex";
import { Button, Icon, IconButton, Popover, Text, Tooltip } from "@honk/ui";
import { IconClipboard, IconCrossMedium, IconSummary } from "@honk/ui/icons";
import { borderVars, colorVars, controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import { useRouter, type AnyRouter } from "@tanstack/react-router";
import * as React from "react";

import {
  createNavigationStore,
  EMPTY_NAVIGATION_SNAPSHOT,
  type NavigationSource,
  type NavigationStore,
} from "./performance-navigation-store";
import {
  buildPerformanceDiagnostics,
  formatPerformanceSnapshot,
  type DiagnosticMetric,
  type NavigationSnapshot,
} from "./performance-monitor-model";
import {
  getPerformanceServerSnapshot,
  getPerformanceSnapshot,
  resetPerformanceMeasurements,
  subscribePerformance,
} from "./performance-monitor-store";
import { actions as toastActions } from "./toast-store";

// The desktop window can shrink to 400px; the summary sheds secondary metrics at this width.
const COMPACT_MONITOR_MEDIA = "@media (max-width: 620px)";
const DETAIL_COLUMNS = "1.25fr 1fr 0.8fr";
const METRIC_COLUMNS = "repeat(2, minmax(0, 1fr))";
const INSPECTOR_MAX_WIDTH = `calc(100vw - ${spaceVars["--honk-space-panel-pad"]} - ${spaceVars["--honk-space-panel-pad"]})`;

const styles = stylex.create({
  root: {
    width: "100%",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    backgroundColor: colorVars["--honk-color-layer-01"],
    borderTopStyle: "solid",
    borderTopWidth: borderVars["--honk-border-hairline"],
    borderTopColor: colorVars["--honk-color-border-muted"],
  },
  summaryBar: {
    width: "100%",
    minHeight: controlVars["--honk-control-h-lg"],
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    paddingInline: spaceVars["--honk-space-panel-pad"],
    gap: controlVars["--honk-control-gap"],
    userSelect: "none",
  },
  statusBlock: {
    flexShrink: 0,
    display: "flex",
    alignItems: "baseline",
    gap: controlVars["--honk-control-gap"],
  },
  headline: {
    minWidth: 0,
    flexGrow: 1,
    paddingInlineStart: spaceVars["--honk-space-gutter"],
  },
  quickMetrics: {
    flexShrink: 0,
    display: {
      default: "flex",
      [COMPACT_MONITOR_MEDIA]: "none",
    },
    alignItems: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  quickMetric: {
    display: "flex",
    alignItems: "baseline",
    gap: controlVars["--honk-control-gap"],
  },
  actions: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
  inspector: {
    width: "max-content",
    maxWidth: INSPECTOR_MAX_WIDTH,
  },
  diagnosis: {
    minWidth: 0,
    display: "flex",
    flexDirection: {
      default: "row",
      [COMPACT_MONITOR_MEDIA]: "column",
    },
    alignItems: {
      default: "center",
      [COMPACT_MONITOR_MEDIA]: "stretch",
    },
    gap: spaceVars["--honk-space-panel-pad"],
  },
  diagnosisCopy: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  diagnosisLine: {
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
  detailActions: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
  groups: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: {
      default: DETAIL_COLUMNS,
      [COMPACT_MONITOR_MEDIA]: "minmax(0, 1fr)",
    },
    marginTop: spaceVars["--honk-space-panel-pad"],
    borderTopStyle: "solid",
    borderTopWidth: borderVars["--honk-border-hairline"],
    borderTopColor: colorVars["--honk-color-border-muted"],
  },
  group: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    paddingBlockStart: spaceVars["--honk-space-panel-pad"],
    paddingInline: {
      default: spaceVars["--honk-space-panel-pad"],
      [COMPACT_MONITOR_MEDIA]: 0,
    },
    borderInlineEndStyle: {
      default: "solid",
      [COMPACT_MONITOR_MEDIA]: "none",
    },
    borderInlineEndWidth: borderVars["--honk-border-hairline"],
    borderInlineEndColor: colorVars["--honk-color-border-muted"],
    borderBottomStyle: {
      default: "none",
      [COMPACT_MONITOR_MEDIA]: "solid",
    },
    borderBottomWidth: borderVars["--honk-border-hairline"],
    borderBottomColor: colorVars["--honk-color-border-muted"],
    ":first-child": {
      paddingInlineStart: 0,
    },
    ":last-child": {
      paddingInlineEnd: 0,
      borderInlineEndStyle: "none",
      borderBottomStyle: "none",
    },
  },
  groupHeading: {
    marginBottom: spaceVars["--honk-space-gutter"],
  },
  metricGrid: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: METRIC_COLUMNS,
    columnGap: spaceVars["--honk-space-panel-pad"],
    rowGap: controlVars["--honk-control-gap"],
    margin: 0,
  },
  metric: {
    minWidth: 0,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: controlVars["--honk-control-gap"],
  },
  metricValue: {
    minWidth: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
  },
});

const navigationStores = new WeakMap<AnyRouter, NavigationStore>();

function navigationStoreFor(router: AnyRouter): NavigationStore {
  const existing = navigationStores.get(router);
  if (existing !== undefined) return existing;
  const source: NavigationSource = {
    subscribeBeforeNavigate: (listener) => router.subscribe("onBeforeNavigate", listener),
    subscribeResolved: (listener) => router.subscribe("onResolved", listener),
  };
  const store = createNavigationStore(source);
  navigationStores.set(router, store);
  return store;
}

function useNavigationMonitor(): {
  readonly reset: () => void;
  readonly snapshot: NavigationSnapshot;
} {
  const router = useRouter();
  const store = navigationStoreFor(router);
  const snapshot = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_NAVIGATION_SNAPSHOT,
  );
  return { reset: store.reset, snapshot };
}

function MetricCell({ metric }: { readonly metric: DiagnosticMetric }): React.ReactElement {
  return (
    <div {...stylex.props(styles.metric)}>
      <dt>
        <Text as="div" size="xs" tone="faint" weight="semibold" truncate>
          {metric.label}
        </Text>
      </dt>
      <dd {...stylex.props(styles.metricValue)}>
        <Text
          as="div"
          size="sm"
          tone={metric.isBad ? "err" : metric.isDim ? "faint" : "primary"}
          weight="semibold"
          family="mono"
          tabularNums
          truncate
        >
          {metric.value}
        </Text>
        <Text as="div" size="xs" tone="faint" align="end">
          {metric.detail}
        </Text>
      </dd>
    </div>
  );
}

// Visible by default in DEV. Command menu can dismiss (unmount) or restore the footer bar.
let performanceMonitorVisible = true;
const visibilityListeners = new Set<() => void>();

function publishVisibility(visible: boolean): void {
  if (performanceMonitorVisible === visible) return;
  performanceMonitorVisible = visible;
  for (const listener of visibilityListeners) listener();
}

function subscribeVisibility(listener: () => void): () => void {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}

export function getPerformanceMonitorVisibility(): boolean {
  return performanceMonitorVisible;
}

export function usePerformanceMonitorVisible(): boolean {
  return React.useSyncExternalStore(
    subscribeVisibility,
    getPerformanceMonitorVisibility,
    () => true,
  );
}

export const performanceMonitorActions = {
  dismiss(): void {
    publishVisibility(false);
  },
  show(): void {
    publishVisibility(true);
  },
  toggle(): void {
    publishVisibility(!performanceMonitorVisible);
  },
};

function DevelopmentPerformanceMonitor(): React.ReactElement | null {
  const visible = usePerformanceMonitorVisible();
  if (!visible) return null;
  return <PerformanceMonitorBar />;
}

function PerformanceMonitorBar(): React.ReactElement {
  const metrics = React.useSyncExternalStore(
    subscribePerformance,
    getPerformanceSnapshot,
    getPerformanceServerSnapshot,
  );
  const navigationMonitor = useNavigationMonitor();
  const diagnostics = buildPerformanceDiagnostics(metrics, navigationMonitor.snapshot);
  const topIssue = diagnostics.issues[0];
  const relatedIssues = diagnostics.issues.slice(1);
  const statusTone =
    diagnostics.issues.length > 0 ? "err" : diagnostics.hasMeasurements ? "primary" : "muted";
  const diagnosisGuidance =
    topIssue?.guidance ??
    (diagnostics.hasMeasurements
      ? "Use the app normally. Measurements update against the current baseline."
      : "Navigate between chats and exercise the interaction you want to measure.");
  const clipboard = globalThis.navigator?.clipboard;

  const resetMeasurements = (): void => {
    resetPerformanceMeasurements();
    navigationMonitor.reset();
  };

  const copySnapshot = (): void => {
    if (clipboard === undefined) return;
    const report = formatPerformanceSnapshot(
      diagnostics,
      new Date(),
      globalThis.window?.location.pathname,
    );
    void clipboard.writeText(report).then(
      () => {
        toastActions.add({ type: "success", title: "Copied performance snapshot" });
      },
      () => {
        toastActions.add({ type: "error", title: "Couldn't copy performance snapshot" });
      },
    );
  };

  return (
    <aside aria-label="Development performance diagnostics" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.summaryBar)}>
        <div {...stylex.props(styles.statusBlock)}>
          <Text size="sm" weight="semibold">
            Performance
          </Text>
          <Text size="sm" tone={statusTone} weight="semibold">
            {diagnostics.statusLabel}
          </Text>
        </div>

        <div {...stylex.props(styles.headline)}>
          <Text as="div" size="sm" tone="muted" truncate>
            {diagnostics.headline}
          </Text>
        </div>

        <div aria-label="Current key measurements" {...stylex.props(styles.quickMetrics)}>
          {diagnostics.quickMetrics.map((metric) => (
            <div key={metric.key} {...stylex.props(styles.quickMetric)}>
              <Text size="xs" tone="faint" weight="semibold">
                {metric.label}
              </Text>
              <Text size="sm" family="mono" weight="semibold" tabularNums>
                {metric.value}
              </Text>
            </div>
          ))}
        </div>

        <div {...stylex.props(styles.actions)}>
          <Popover.Root>
            <Popover.Trigger
              render={
                <Button size="sm" variant="quiet" iconStart={<Icon icon={IconSummary} size="sm" />}>
                  Inspect
                </Button>
              }
            />

            <Popover.Popup side="top" align="end" style={styles.inspector}>
              <div {...stylex.props(styles.diagnosis)}>
                <div {...stylex.props(styles.diagnosisCopy)}>
                  <div {...stylex.props(styles.diagnosisLine)}>
                    <Popover.Title>Performance inspector</Popover.Title>
                    <Text size="sm" tone={statusTone} weight="semibold">
                      {diagnostics.statusLabel}
                    </Text>
                  </div>

                  <Text size="sm" tone={topIssue === undefined ? "muted" : "err"} weight="semibold">
                    {diagnostics.headline}
                  </Text>
                  <Popover.Description>{diagnosisGuidance}</Popover.Description>

                  {relatedIssues.length > 0 ? (
                    <Text size="xs" tone="muted">
                      Also over threshold: {relatedIssues.map((issue) => issue.title).join(" · ")}
                    </Text>
                  ) : null}
                </div>

                <div {...stylex.props(styles.detailActions)}>
                  <Button size="sm" variant="quiet" onClick={resetMeasurements}>
                    Reset measurements
                  </Button>
                  {clipboard === undefined ? null : (
                    <Button
                      size="sm"
                      variant="neutral"
                      iconStart={<Icon icon={IconClipboard} size="sm" />}
                      onClick={copySnapshot}
                    >
                      Copy snapshot
                    </Button>
                  )}
                </div>
              </div>

              <div {...stylex.props(styles.groups)}>
                {diagnostics.groups.map((group) => (
                  <section
                    key={group.key}
                    aria-labelledby={`performance-group-${group.key}`}
                    {...stylex.props(styles.group)}
                  >
                    <Text
                      as="p"
                      id={`performance-group-${group.key}`}
                      size="xs"
                      tone="faint"
                      weight="semibold"
                      style={styles.groupHeading}
                    >
                      {group.label}
                    </Text>
                    <dl {...stylex.props(styles.metricGrid)}>
                      {group.metrics.map((metric) => (
                        <MetricCell key={metric.key} metric={metric} />
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </Popover.Popup>
          </Popover.Root>

          <Tooltip label="Hide performance monitor">
            <IconButton
              size="sm"
              variant="quiet"
              aria-label="Hide performance monitor"
              onClick={() => {
                performanceMonitorActions.dismiss();
              }}
            >
              <Icon icon={IconCrossMedium} size="sm" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}

export { DevelopmentPerformanceMonitor };
