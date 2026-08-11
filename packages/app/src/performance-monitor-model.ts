type PerformanceSnapshot = {
  readonly cls: number | undefined;
  readonly delay: number | undefined;
  readonly fps: number | undefined;
  readonly frame: number | undefined;
  readonly heap: {
    readonly limit: number | undefined;
    readonly used: number | undefined;
  };
  readonly inp: number | undefined;
  readonly jank: number | undefined;
  readonly longTask: {
    readonly blocked: number | undefined;
    readonly count: number | undefined;
    readonly max: number | undefined;
  };
};

type NavigationSnapshot = {
  readonly duration: number | undefined;
  readonly pending: boolean;
};

type DiagnosticMetricKey =
  | "navigation"
  | "fps"
  | "frame"
  | "jank"
  | "long-task"
  | "delay"
  | "interaction"
  | "layout-shift"
  | "heap";

type DiagnosticMetric = {
  readonly detail: string;
  readonly isBad: boolean;
  readonly isDim: boolean;
  readonly key: DiagnosticMetricKey;
  readonly label: string;
  readonly value: string;
};

type DiagnosticGroup = {
  readonly key: "rendering" | "responsiveness" | "stability";
  readonly label: string;
  readonly metrics: readonly DiagnosticMetric[];
};

type PerformanceIssue = {
  readonly guidance: string;
  readonly key:
    | "navigation"
    | "rendering"
    | "main-thread"
    | "interaction"
    | "layout-shift"
    | "memory";
  readonly measurement: string;
  readonly severity: number;
  readonly title: string;
};

type PerformanceDiagnostics = {
  readonly groups: readonly DiagnosticGroup[];
  readonly hasMeasurements: boolean;
  readonly headline: string;
  readonly issues: readonly PerformanceIssue[];
  readonly quickMetrics: readonly {
    readonly key: "render" | "input" | "heap";
    readonly label: string;
    readonly value: string;
  }[];
  readonly statusLabel: string;
};

const PERFORMANCE_THRESHOLDS = {
  navigationMs: 400,
  fps: 50,
  frameMs: 50,
  jankFrames: 8,
  longTaskBlockedMs: 200,
  inputDelayMs: 100,
  interactionMs: 200,
  layoutShift: 0.1,
  heapRatio: 0.8,
};

type ThresholdBreach = {
  readonly severity: number;
  readonly value: number;
};

const UNAVAILABLE_VALUE = "—";

function formatInteger(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return `${Math.round(value)}`;
}

function formatMilliseconds(value: number | undefined): string | undefined {
  const integer = formatInteger(value);
  return integer === undefined ? undefined : `${integer}ms`;
}

function formatMebibytes(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  const mebibytes = value / 1_024 / 1_024;
  return `${mebibytes >= 1_024 ? mebibytes.toFixed(0) : mebibytes.toFixed(1)}MiB`;
}

function breachAbove(value: number | undefined, threshold: number): ThresholdBreach | undefined {
  if (value === undefined || Number.isNaN(value) || value <= threshold) return undefined;
  return { severity: (value - threshold) / threshold, value };
}

function breachBelow(value: number | undefined, threshold: number): ThresholdBreach | undefined {
  if (value === undefined || Number.isNaN(value) || value >= threshold) return undefined;
  return { severity: (threshold - value) / threshold, value };
}

function heapRatioOf(metrics: PerformanceSnapshot): number | undefined {
  if (
    metrics.heap.used === undefined ||
    metrics.heap.limit === undefined ||
    metrics.heap.limit === 0
  ) {
    return undefined;
  }
  return metrics.heap.used / metrics.heap.limit;
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return value === 1 ? singular : plural;
}

function buildIssues(
  metrics: PerformanceSnapshot,
  navigation: NavigationSnapshot,
  heapRatio: number | undefined,
): readonly PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];

  const navigationBreach = breachAbove(navigation.duration, PERFORMANCE_THRESHOLDS.navigationMs);
  if (navigationBreach !== undefined) {
    issues.push({
      key: "navigation",
      title: "Chat navigation is slow",
      measurement: `${formatMilliseconds(navigationBreach.value)} last transition`,
      guidance:
        "Trace a chat transition and inspect route loading plus the first committed render.",
      severity: navigationBreach.severity,
    });
  }

  const renderingBreaches: Array<{
    readonly measurement: string;
    readonly severity: number;
  }> = [];
  const fpsBreach = breachBelow(metrics.fps, PERFORMANCE_THRESHOLDS.fps);
  if (fpsBreach !== undefined) {
    renderingBreaches.push({
      measurement: `${formatInteger(fpsBreach.value)} fps`,
      severity: fpsBreach.severity,
    });
  }
  const frameBreach = breachAbove(metrics.frame, PERFORMANCE_THRESHOLDS.frameMs);
  if (frameBreach !== undefined) {
    renderingBreaches.push({
      measurement: `${formatMilliseconds(frameBreach.value)} worst frame`,
      severity: frameBreach.severity,
    });
  }
  const jankBreach = breachAbove(metrics.jank, PERFORMANCE_THRESHOLDS.jankFrames);
  if (jankBreach !== undefined) {
    renderingBreaches.push({
      measurement: `${formatInteger(jankBreach.value)} janky frames`,
      severity: jankBreach.severity,
    });
  }
  if (renderingBreaches.length > 0) {
    issues.push({
      key: "rendering",
      title: "Rendering is dropping frames",
      measurement: renderingBreaches.map((breach) => breach.measurement).join(" · "),
      guidance:
        "Record a Performance trace while reproducing. Inspect scripting, layout, and paint on the longest frame.",
      severity: Math.max(...renderingBreaches.map((breach) => breach.severity)),
    });
  }

  const longTaskBreach = breachAbove(
    metrics.longTask.blocked,
    PERFORMANCE_THRESHOLDS.longTaskBlockedMs,
  );
  if (longTaskBreach !== undefined) {
    const count = metrics.longTask.count ?? 0;
    const longest = formatMilliseconds(metrics.longTask.max);
    issues.push({
      key: "main-thread",
      title: "The main thread is blocked",
      measurement: `${formatMilliseconds(longTaskBreach.value)} across ${count} ${pluralize(count, "task")}`,
      guidance:
        longest === undefined
          ? "Inspect long tasks in a Performance trace and split or defer work over 50ms."
          : `Inspect the ${longest} longest task and split or defer work over 50ms.`,
      severity: longTaskBreach.severity,
    });
  }

  const interactionBreaches: Array<{
    readonly measurement: string;
    readonly severity: number;
  }> = [];
  const interactionBreach = breachAbove(metrics.inp, PERFORMANCE_THRESHOLDS.interactionMs);
  if (interactionBreach !== undefined) {
    interactionBreaches.push({
      measurement: `${formatMilliseconds(interactionBreach.value)} interaction`,
      severity: interactionBreach.severity,
    });
  }
  const delayBreach = breachAbove(metrics.delay, PERFORMANCE_THRESHOLDS.inputDelayMs);
  if (delayBreach !== undefined) {
    interactionBreaches.push({
      measurement: `${formatMilliseconds(delayBreach.value)} input delay`,
      severity: delayBreach.severity,
    });
  }
  if (interactionBreaches.length > 0) {
    issues.push({
      key: "interaction",
      title: "Interaction is slow",
      measurement: interactionBreaches.map((breach) => breach.measurement).join(" · "),
      guidance:
        "Reproduce the action in a Performance trace and inspect handler work before the next paint.",
      severity: Math.max(...interactionBreaches.map((breach) => breach.severity)),
    });
  }

  const layoutShiftBreach = breachAbove(metrics.cls, PERFORMANCE_THRESHOLDS.layoutShift);
  if (layoutShiftBreach !== undefined) {
    issues.push({
      key: "layout-shift",
      title: "The layout is shifting",
      measurement: `${layoutShiftBreach.value.toFixed(2)} cumulative shift`,
      guidance: "Enable layout-shift regions and reserve space for content that arrives late.",
      severity: layoutShiftBreach.severity,
    });
  }

  const heapBreach = breachAbove(heapRatio, PERFORMANCE_THRESHOLDS.heapRatio);
  if (heapBreach !== undefined) {
    issues.push({
      key: "memory",
      title: "Heap pressure is high",
      measurement: `${Math.round(heapBreach.value * 100)}% of the JS heap limit`,
      guidance:
        "Capture a heap snapshot before and after the same action, then compare retained objects.",
      severity: heapBreach.severity,
    });
  }

  return issues.sort((a, b) => b.severity - a.severity);
}

function buildPerformanceDiagnostics(
  metrics: PerformanceSnapshot,
  navigation: NavigationSnapshot,
): PerformanceDiagnostics {
  const { cls, delay, fps, frame, inp, jank } = metrics;
  const blocked = metrics.longTask.blocked;
  const navigationDuration = navigation.duration;
  const heapRatio = heapRatioOf(metrics);
  const heapPercent = heapRatio === undefined ? undefined : `${Math.round(heapRatio * 100)}%`;
  const usedHeap = formatMebibytes(metrics.heap.used);
  const heapLimit = formatMebibytes(metrics.heap.limit);
  const longTaskCount = metrics.longTask.count;
  const longTaskValue =
    longTaskCount === undefined
      ? UNAVAILABLE_VALUE
      : `${formatMilliseconds(metrics.longTask.blocked) ?? "0ms"} · ${longTaskCount} ${pluralize(
          longTaskCount,
          "task",
        )}`;
  const navigationValue = navigation.pending
    ? "Measuring…"
    : (formatMilliseconds(navigation.duration) ?? UNAVAILABLE_VALUE);

  const groups: readonly DiagnosticGroup[] = [
    {
      key: "rendering",
      label: "Rendering",
      metrics: [
        {
          key: "fps",
          label: "Frame rate",
          detail: "Rolling 5s · investigate below 50 fps",
          value: fps === undefined ? UNAVAILABLE_VALUE : `${formatInteger(fps)} fps`,
          isBad: breachBelow(fps, PERFORMANCE_THRESHOLDS.fps) !== undefined,
          isDim: fps === undefined,
        },
        {
          key: "frame",
          label: "Worst frame",
          detail: "Rolling 5s · investigate above 50ms",
          value: formatMilliseconds(frame) ?? UNAVAILABLE_VALUE,
          isBad: breachAbove(frame, PERFORMANCE_THRESHOLDS.frameMs) !== undefined,
          isDim: frame === undefined,
        },
        {
          key: "jank",
          label: "Janky frames",
          detail: "Rolling 5s · investigate above 8",
          value: formatInteger(jank) ?? UNAVAILABLE_VALUE,
          isBad: breachAbove(jank, PERFORMANCE_THRESHOLDS.jankFrames) !== undefined,
          isDim: jank === undefined,
        },
        {
          key: "long-task",
          label: "Main thread",
          detail: "Blocked beyond 50ms, rolling 5s · investigate above 200ms",
          value: longTaskValue,
          isBad: breachAbove(blocked, PERFORMANCE_THRESHOLDS.longTaskBlockedMs) !== undefined,
          isDim: longTaskCount === undefined,
        },
      ],
    },
    {
      key: "responsiveness",
      label: "Responsiveness",
      metrics: [
        {
          key: "interaction",
          label: "Interaction",
          detail: "Rolling 5s · investigate above 200ms",
          value: formatMilliseconds(inp) ?? UNAVAILABLE_VALUE,
          isBad: breachAbove(inp, PERFORMANCE_THRESHOLDS.interactionMs) !== undefined,
          isDim: inp === undefined,
        },
        {
          key: "delay",
          label: "Input delay",
          detail: "Rolling 5s · investigate above 100ms",
          value: formatMilliseconds(delay) ?? UNAVAILABLE_VALUE,
          isBad: breachAbove(delay, PERFORMANCE_THRESHOLDS.inputDelayMs) !== undefined,
          isDim: delay === undefined,
        },
        {
          key: "navigation",
          label: "Chat navigation",
          detail: "Last transition · investigate above 400ms",
          value: navigationValue,
          isBad: breachAbove(navigationDuration, PERFORMANCE_THRESHOLDS.navigationMs) !== undefined,
          isDim: navigationDuration === undefined && !navigation.pending,
        },
      ],
    },
    {
      key: "stability",
      label: "Stability",
      metrics: [
        {
          key: "layout-shift",
          label: "Layout shift",
          detail: "Current baseline · investigate above 0.10",
          value: cls === undefined ? UNAVAILABLE_VALUE : cls.toFixed(2),
          isBad: breachAbove(cls, PERFORMANCE_THRESHOLDS.layoutShift) !== undefined,
          isDim: cls === undefined,
        },
        {
          key: "heap",
          label: "JS heap",
          detail: "Current usage · investigate above 80%",
          value:
            heapPercent === undefined
              ? UNAVAILABLE_VALUE
              : `${heapPercent} · ${usedHeap ?? UNAVAILABLE_VALUE} / ${heapLimit ?? UNAVAILABLE_VALUE}`,
          isBad: breachAbove(heapRatio, PERFORMANCE_THRESHOLDS.heapRatio) !== undefined,
          isDim: heapRatio === undefined,
        },
      ],
    },
  ];

  const hasMeasurements =
    navigation.pending ||
    navigation.duration !== undefined ||
    groups.some((group) => group.metrics.some((metric) => !metric.isDim));
  const issues = buildIssues(metrics, navigation, heapRatio);
  const statusLabel =
    issues.length > 0
      ? `${issues.length} ${pluralize(issues.length, "issue")}`
      : hasMeasurements
        ? "Within thresholds"
        : "Measuring…";
  const topIssue = issues[0];
  const headline =
    topIssue !== undefined
      ? `${topIssue.title} · ${topIssue.measurement}`
      : hasMeasurements
        ? "5s window · last chat navigation · current heap"
        : "Use Honk to collect a 5s sample";

  return {
    groups,
    hasMeasurements,
    headline,
    issues,
    quickMetrics: [
      {
        key: "render",
        label: "Render",
        value: fps === undefined ? UNAVAILABLE_VALUE : `${formatInteger(fps)} fps`,
      },
      {
        key: "input",
        label: "Input",
        value: formatMilliseconds(inp) ?? UNAVAILABLE_VALUE,
      },
      {
        key: "heap",
        label: "Heap",
        value: heapPercent ?? UNAVAILABLE_VALUE,
      },
    ],
    statusLabel,
  };
}

function formatPerformanceSnapshot(
  diagnostics: PerformanceDiagnostics,
  capturedAt = new Date(),
  pathname?: string,
): string {
  const lines = [
    "Honk performance snapshot",
    `Captured: ${capturedAt.toISOString()}`,
    ...(pathname === undefined ? [] : [`Route: ${pathname}`]),
    `Status: ${diagnostics.statusLabel}`,
    "Window: 5s rolling; layout shift uses the current baseline; navigation uses the last chat transition",
  ];

  for (const group of diagnostics.groups) {
    lines.push("", group.label);
    for (const metric of group.metrics) {
      lines.push(`${metric.label}: ${metric.value === UNAVAILABLE_VALUE ? "N/A" : metric.value}`);
    }
  }

  if (diagnostics.issues.length > 0) {
    lines.push("", "Issues");
    diagnostics.issues.forEach((issue, index) => {
      lines.push(
        `${index + 1}. ${issue.title}: ${issue.measurement}`,
        `   Next: ${issue.guidance}`,
      );
    });
  }

  return lines.join("\n");
}

export {
  PERFORMANCE_THRESHOLDS,
  UNAVAILABLE_VALUE,
  buildPerformanceDiagnostics,
  formatPerformanceSnapshot,
};
export type {
  DiagnosticGroup,
  DiagnosticMetric,
  NavigationSnapshot,
  PerformanceDiagnostics,
  PerformanceIssue,
  PerformanceSnapshot,
};
