// Toast pipeline. Timers and visibility tracking live here, never in a component effect.
// Toasts with threadKey render only for the active chat route. Attention alerts omit
// threadKey so backgrounded threads still surface.

import { useSyncExternalStore } from "react";

export type ToastType = "error" | "info" | "loading" | "success" | "warning";

export type ToastAction = {
  readonly label: string;
  readonly run: () => void;
};

export type ToastItem = {
  readonly id: string;
  readonly type: ToastType;
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
  /** When set, error toasts show a Copy-error control for this text. */
  readonly copyableError?: string;
  /**
   * Thread-local feedback only. Viewport shows the toast only while this key is
   * the active route. Attention / cross-thread alerts omit this field so they
   * always render (parity: fix the backgrounded-attention filter bug).
   */
  readonly threadKey?: string;
  /** Visible-time budget (ms). Countdown pauses while the document is blurred/hidden. */
  readonly dismissAfterVisibleMs?: number;
};

export type ToastSnapshot = {
  readonly toasts: readonly ToastItem[];
};

export type AddToastInput = {
  readonly type: ToastType;
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
  readonly copyableError?: string;
  readonly threadKey?: string;
  readonly dismissAfterVisibleMs?: number;
};

const DEFAULT_DISMISS_MS = 5000;
const ATTENTION_DISMISS_MS = 8000;

const DEFAULT_SNAPSHOT: ToastSnapshot = Object.freeze({
  toasts: Object.freeze([]),
});

const listeners = new Set<() => void>();

let snapshot: ToastSnapshot = DEFAULT_SNAPSHOT;

/** Remaining visible-time budget per toast id (paused when document is not focused+visible). */
const remainingMsById = new Map<string, number>();
const startedAtById = new Map<string, number>();
const timeoutById = new Map<string, ReturnType<typeof setTimeout>>();

let visibilityInstalled = false;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function publish(toasts: readonly ToastItem[]): void {
  snapshot = Object.freeze({ toasts: Object.freeze([...toasts]) });
  notify();
}

function isDocumentVisibleAndFocused(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

function clearTimer(id: string): void {
  const timeoutId = timeoutById.get(id);
  if (timeoutId === undefined) {
    return;
  }
  clearTimeout(timeoutId);
  timeoutById.delete(id);
}

function pauseToast(id: string): void {
  const startedAt = startedAtById.get(id);
  if (startedAt === undefined) {
    return;
  }
  const remaining = remainingMsById.get(id) ?? 0;
  const nextRemaining = Math.max(0, remaining - (Date.now() - startedAt));
  remainingMsById.set(id, nextRemaining);
  startedAtById.delete(id);
  clearTimer(id);
}

function closeToast(id: string): void {
  clearTimer(id);
  remainingMsById.delete(id);
  startedAtById.delete(id);
  if (!snapshot.toasts.some((toast) => toast.id === id)) {
    return;
  }
  publish(snapshot.toasts.filter((toast) => toast.id !== id));
}

function startToast(id: string): void {
  if (startedAtById.has(id)) {
    return;
  }
  const remaining = remainingMsById.get(id);
  if (remaining === undefined) {
    return;
  }
  if (remaining <= 0) {
    closeToast(id);
    return;
  }
  startedAtById.set(id, Date.now());
  clearTimer(id);
  timeoutById.set(
    id,
    setTimeout(() => {
      remainingMsById.set(id, 0);
      startedAtById.delete(id);
      closeToast(id);
    }, remaining),
  );
}

function syncAllTimers(): void {
  const shouldRun = isDocumentVisibleAndFocused();
  for (const id of remainingMsById.keys()) {
    if (shouldRun) {
      startToast(id);
    } else {
      pauseToast(id);
    }
  }
}

function installVisibilityTracking(): void {
  if (visibilityInstalled || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  visibilityInstalled = true;
  document.addEventListener("visibilitychange", syncAllTimers);
  window.addEventListener("focus", syncAllTimers);
  window.addEventListener("blur", syncAllTimers);
}

/**
 * Thread-scoped toasts render only when their thread IS the active route
 * (thread-local feedback). Unscoped toasts (attention alerts) always render.
 * Call at display time so the viewport re-evaluates when the active route changes.
 */
export function shouldRenderToast(toast: ToastItem, activeSessionId: string | null): boolean {
  if (toast.threadKey === undefined) {
    return true;
  }
  return toast.threadKey === activeSessionId;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ToastSnapshot {
  return snapshot;
}

export function getServerSnapshot(): ToastSnapshot {
  return DEFAULT_SNAPSHOT;
}

export function useToasts(): ToastSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const actions = {
  add(input: AddToastInput): string {
    installVisibilityTracking();

    const id = crypto.randomUUID();
    const dismissAfterVisibleMs =
      input.dismissAfterVisibleMs ?? (input.type === "loading" ? undefined : DEFAULT_DISMISS_MS);

    const toast: ToastItem = Object.freeze({
      id,
      type: input.type,
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.copyableError !== undefined ? { copyableError: input.copyableError } : {}),
      ...(input.threadKey !== undefined ? { threadKey: input.threadKey } : {}),
      ...(dismissAfterVisibleMs !== undefined ? { dismissAfterVisibleMs } : {}),
    });

    publish([...snapshot.toasts, toast]);

    if (dismissAfterVisibleMs !== undefined && dismissAfterVisibleMs > 0) {
      remainingMsById.set(id, dismissAfterVisibleMs);
      if (isDocumentVisibleAndFocused()) {
        startToast(id);
      }
    }

    return id;
  },

  /** Attention alerts: 8s visible budget, never thread-scoped. */
  addAttention(
    input: Omit<AddToastInput, "threadKey" | "type" | "dismissAfterVisibleMs"> & {
      readonly type?: ToastType;
    },
  ): string {
    return actions.add({
      ...input,
      type: input.type ?? "warning",
      dismissAfterVisibleMs: ATTENTION_DISMISS_MS,
    });
  },

  dismiss(id: string): void {
    closeToast(id);
  },

  invokeAction(id: string): void {
    const toast = snapshot.toasts.find((item) => item.id === id);
    if (toast?.action === undefined) {
      return;
    }
    toast.action.run();
    closeToast(id);
  },
} as const;

export { ATTENTION_DISMISS_MS, DEFAULT_DISMISS_MS };
