import type { PerformanceSnapshot } from "./performance-monitor-model";

type ChromiumPerformance = Performance & {
  readonly memory?: {
    readonly usedJSHeapSize: number;
    readonly jsHeapSizeLimit: number;
  };
};

type EventTimingEntry = PerformanceEntry & {
  readonly interactionId?: number;
  readonly processingStart?: number;
};

type LayoutShiftEntry = PerformanceEntry & {
  readonly hadRecentInput?: boolean;
  readonly value?: number;
};

type PerformanceObserverOptions = PerformanceObserverInit & {
  readonly durationThreshold?: number;
};

const ROLLING_WINDOW_MS = 5_000;
const FRAME_SYNC_INTERVAL_MS = 250;
const METRIC_POLL_INTERVAL_MS = 1_000;
const EVENT_DURATION_THRESHOLD_MS = 16;
const JANK_FRAME_THRESHOLD_MS = 32;
const LONG_TASK_THRESHOLD_MS = 50;
const MAX_TRACKED_INTERACTIONS = 200;

const EMPTY_PERFORMANCE_SNAPSHOT: PerformanceSnapshot = {
  cls: undefined,
  delay: undefined,
  fps: undefined,
  frame: undefined,
  heap: { limit: undefined, used: undefined },
  inp: undefined,
  jank: undefined,
  longTask: { blocked: undefined, count: undefined, max: undefined },
};

let performanceSnapshot = EMPTY_PERFORMANCE_SNAPSHOT;
let stopPerformanceMonitor: (() => void) | null = null;
let resetPerformanceSampling: (() => void) | null = null;
const performanceListeners = new Set<() => void>();

function publishPerformance(patch: Partial<PerformanceSnapshot>): void {
  performanceSnapshot = { ...performanceSnapshot, ...patch };
  for (const listener of performanceListeners) listener();
}

function replacePerformance(next: PerformanceSnapshot): void {
  performanceSnapshot = next;
  for (const listener of performanceListeners) listener();
}

function getPerformanceSnapshot(): PerformanceSnapshot {
  return performanceSnapshot;
}

function getPerformanceServerSnapshot(): PerformanceSnapshot {
  return EMPTY_PERFORMANCE_SNAPSHOT;
}

function trimWindow(
  entries: Array<{ readonly at: number; readonly duration: number }>,
  at: number,
) {
  while (entries[0] !== undefined && at - entries[0].at > ROLLING_WINDOW_MS) {
    entries.shift();
  }
}

function startPerformanceMonitor(): () => void {
  const observers: PerformanceObserver[] = [];
  const frames: Array<{ readonly at: number; readonly duration: number }> = [];
  const longTasks: Array<{ readonly at: number; readonly duration: number }> = [];
  const interactions = new Map<
    number | string,
    { readonly at: number; readonly delay: number; readonly duration: number }
  >();
  let hasLayoutShiftObserver = false;
  let hasLongTaskObserver = false;
  let intervalID: number | undefined;
  let animationFrameID = 0;
  let lastFrameAt = 0;
  let lastFrameSyncAt = 0;
  let layoutShiftBaselineAt = performance.now();

  const syncFrames = (at: number): void => {
    trimWindow(frames, at);
    const total = frames.reduce((sum, entry) => sum + entry.duration, 0);
    const frame = frames.reduce((max, entry) => Math.max(max, entry.duration), 0);
    publishPerformance({
      fps: total > 0 ? (frames.length * 1_000) / total : undefined,
      frame: frame > 0 ? frame : undefined,
      jank: frames.filter((entry) => entry.duration > JANK_FRAME_THRESHOLD_MS).length,
    });
  };

  const syncLongTasks = (at = performance.now()): void => {
    if (!hasLongTaskObserver) return;
    trimWindow(longTasks, at);
    publishPerformance({
      longTask: {
        blocked: longTasks.reduce(
          (sum, entry) => sum + Math.max(0, entry.duration - LONG_TASK_THRESHOLD_MS),
          0,
        ),
        count: longTasks.length,
        max: longTasks.reduce((max, entry) => Math.max(max, entry.duration), 0),
      },
    });
  };

  const syncInteractions = (at = performance.now()): void => {
    for (const [key, entry] of interactions) {
      if (at - entry.at > ROLLING_WINDOW_MS) interactions.delete(key);
    }
    let delay = 0;
    let inp = 0;
    for (const entry of interactions.values()) {
      delay = Math.max(delay, entry.delay);
      inp = Math.max(inp, entry.duration);
    }
    publishPerformance({
      delay: delay > 0 ? delay : undefined,
      inp: inp > 0 ? inp : undefined,
    });
  };

  const syncHeap = (): void => {
    const chromiumPerformance: ChromiumPerformance = performance;
    const memory = chromiumPerformance.memory;
    if (memory === undefined) return;
    publishPerformance({
      heap: { limit: memory.jsHeapSizeLimit, used: memory.usedJSHeapSize },
    });
  };

  const resetRollingMetrics = (): void => {
    frames.length = 0;
    longTasks.length = 0;
    interactions.clear();
    lastFrameAt = 0;
    lastFrameSyncAt = 0;
    publishPerformance({
      delay: undefined,
      fps: undefined,
      frame: undefined,
      inp: undefined,
      jank: undefined,
      ...(hasLongTaskObserver
        ? { longTask: { blocked: 0, count: 0, max: 0 } }
        : { longTask: EMPTY_PERFORMANCE_SNAPSHOT.longTask }),
    });
  };

  const resetAllMetrics = (): void => {
    frames.length = 0;
    longTasks.length = 0;
    interactions.clear();
    lastFrameAt = 0;
    lastFrameSyncAt = 0;
    layoutShiftBaselineAt = performance.now();
    replacePerformance({
      ...EMPTY_PERFORMANCE_SNAPSHOT,
      cls: hasLayoutShiftObserver ? 0 : undefined,
      longTask: hasLongTaskObserver
        ? { blocked: 0, count: 0, max: 0 }
        : EMPTY_PERFORMANCE_SNAPSHOT.longTask,
    });
    syncHeap();
  };

  const observe = (
    type: string,
    options: PerformanceObserverOptions,
    onEntries: (entries: PerformanceEntry[]) => void,
  ): boolean => {
    const Observer = globalThis.PerformanceObserver;
    if (Observer === undefined || !(Observer.supportedEntryTypes ?? []).includes(type)) {
      return false;
    }
    const observer = new Observer((list) => {
      onEntries(list.getEntries());
    });
    try {
      observer.observe(options);
      observers.push(observer);
      return true;
    } catch {
      observer.disconnect();
      return false;
    }
  };

  if (
    observe("layout-shift", { buffered: true, type: "layout-shift" }, (entries) => {
      const shift = entries.reduce((sum, entry) => {
        const layoutShift: LayoutShiftEntry = entry;
        const value = layoutShift.value;
        return layoutShift.hadRecentInput ||
          value === undefined ||
          entry.startTime < layoutShiftBaselineAt
          ? sum
          : sum + value;
      }, 0);
      if (shift > 0) publishPerformance({ cls: (performanceSnapshot.cls ?? 0) + shift });
    })
  ) {
    hasLayoutShiftObserver = true;
    publishPerformance({ cls: 0 });
  }

  if (
    observe("longtask", { buffered: true, type: "longtask" }, (entries) => {
      const at = performance.now();
      longTasks.push(
        ...entries.map((entry) => ({ at: entry.startTime, duration: entry.duration })),
      );
      syncLongTasks(at);
    })
  ) {
    hasLongTaskObserver = true;
    publishPerformance({ longTask: { blocked: 0, count: 0, max: 0 } });
  }

  observe(
    "event",
    { buffered: true, durationThreshold: EVENT_DURATION_THRESHOLD_MS, type: "event" },
    (entries) => {
      for (const rawEntry of entries) {
        const entry: EventTimingEntry = rawEntry;
        if (entry.duration < EVENT_DURATION_THRESHOLD_MS) continue;
        const key =
          entry.interactionId !== undefined && entry.interactionId > 0
            ? entry.interactionId
            : `${entry.name}:${Math.round(entry.startTime)}`;
        const previous = interactions.get(key);
        const delay = Math.max(0, (entry.processingStart ?? entry.startTime) - entry.startTime);
        interactions.set(key, {
          at: entry.startTime,
          delay: Math.max(previous?.delay ?? 0, delay),
          duration: Math.max(previous?.duration ?? 0, entry.duration),
        });
        if (interactions.size > MAX_TRACKED_INTERACTIONS) {
          const oldest = interactions.keys().next().value;
          if (oldest !== undefined) interactions.delete(oldest);
        }
      }
      syncInteractions();
    },
  );

  const frameLoop = (at: number): void => {
    if (document.visibilityState !== "visible") {
      animationFrameID = 0;
      return;
    }
    if (lastFrameAt === 0) {
      lastFrameAt = at;
      animationFrameID = requestAnimationFrame(frameLoop);
      return;
    }
    frames.push({ at, duration: at - lastFrameAt });
    lastFrameAt = at;
    if (at - lastFrameSyncAt >= FRAME_SYNC_INTERVAL_MS) {
      lastFrameSyncAt = at;
      syncFrames(at);
    }
    animationFrameID = requestAnimationFrame(frameLoop);
  };

  const stopSampling = (): void => {
    if (animationFrameID !== 0) cancelAnimationFrame(animationFrameID);
    animationFrameID = 0;
    if (intervalID === undefined) return;
    clearInterval(intervalID);
    intervalID = undefined;
  };

  const startSampling = (): void => {
    if (document.visibilityState !== "visible") return;
    if (intervalID === undefined) {
      intervalID = window.setInterval(() => {
        syncLongTasks();
        syncInteractions();
        syncHeap();
      }, METRIC_POLL_INTERVAL_MS);
    }
    if (animationFrameID === 0) animationFrameID = requestAnimationFrame(frameLoop);
  };

  const handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      stopSampling();
      return;
    }
    resetRollingMetrics();
    startSampling();
  };

  syncHeap();
  startSampling();
  resetPerformanceSampling = resetAllMetrics;
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    stopSampling();
    resetPerformanceSampling = null;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    for (const observer of observers) observer.disconnect();
  };
}

function subscribePerformance(listener: () => void): () => void {
  performanceListeners.add(listener);
  if (performanceListeners.size === 1 && globalThis.window !== undefined) {
    performanceSnapshot = EMPTY_PERFORMANCE_SNAPSHOT;
    stopPerformanceMonitor = startPerformanceMonitor();
  }
  return () => {
    performanceListeners.delete(listener);
    if (performanceListeners.size === 0) {
      stopPerformanceMonitor?.();
      stopPerformanceMonitor = null;
      performanceSnapshot = EMPTY_PERFORMANCE_SNAPSHOT;
    }
  };
}

function resetPerformanceMeasurements(): void {
  resetPerformanceSampling?.();
}

export {
  getPerformanceServerSnapshot,
  getPerformanceSnapshot,
  resetPerformanceMeasurements,
  subscribePerformance,
};
