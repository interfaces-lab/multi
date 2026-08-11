// Core inventory subscriber for completion alerts.
// Install from start-app, never from a component effect.

import type { Session } from "@honk/core/session";
import type { DesktopThreadNotificationTarget } from "@honk/shared/desktop-api";
import { basename } from "@honk/shared/paths";

import {
  actions as appSettingsActions,
  getSnapshot as getAppSettingsSnapshot,
} from "./app-settings-store";
import type { AlertSoundSelection } from "./alert-sound-model";
import { getInventorySnapshot, retainInventory, subscribeInventory } from "./chat/inventory-store";
import { installAlertSoundPlayback, playAlertSound } from "./completion-sound";
import {
  showDesktopThreadNotification,
  subscribeDesktopThreadNotificationActivate,
} from "./desktop-bridge";
import { isWindowForeground, showSystemThreadNotification } from "./notification-permission";
import { router } from "./router";
import { actions as toastActions } from "./toast-store";

type ThreadSummary = Session.SessionSummary;

type TrackedThread = {
  readonly working: boolean;
};

const MAX_TRACKED = 200;

const previousByKey = new Map<string, TrackedThread>();
let installed = false;
let releaseInventory: (() => void) | null = null;
let unsubscribeWatch: (() => void) | null = null;
let unsubscribeNotificationActivate: (() => void) | null = null;
let uninstallAlertSoundPlayback: (() => void) | null = null;

function threadLabel(thread: ThreadSummary): string {
  const label = (thread.title ?? basename(thread.directory)).trim();
  return label.length > 0 ? label : "Untitled thread";
}

function threadWorking(thread: ThreadSummary): boolean {
  return thread.phase !== "idle";
}

// Plain fields only, so a desktop notification click can reopen the thread from
// the main process even after the raising renderer is gone.
function threadTarget(thread: ThreadSummary): DesktopThreadNotificationTarget {
  return {
    key: thread.id,
    title: threadLabel(thread),
    status: threadWorking(thread) ? "working" : "idle",
    repository: { state: "ready", label: basename(thread.directory) },
  };
}

function openThreadTarget(target: DesktopThreadNotificationTarget): void {
  void router.navigate({ to: "/chat/$sessionId", params: { sessionId: target.key } });
}

function openThread(thread: ThreadSummary): void {
  openThreadTarget(threadTarget(thread));
}

// Desktop sends the click through the main process, which survives a hidden or
// recreated window. Web keeps the in-page Web Notification click handler.
function notifyThread(input: { readonly body: string; readonly thread: ThreadSummary }): void {
  const target = threadTarget(input.thread);
  if (
    showDesktopThreadNotification({
      title: target.title,
      body: input.body,
      threadId: input.thread.id,
      target,
    })
  ) {
    return;
  }
  showSystemThreadNotification({
    title: target.title,
    body: input.body,
    threadId: input.thread.id,
    onClick: () => {
      openThreadTarget(target);
    },
  });
}

function activeThread(thread: ThreadSummary): boolean {
  return router.state.location.pathname === `/chat/${thread.id}`;
}

function capMemory(nextIds: ReadonlySet<string>): void {
  for (const key of [...previousByKey.keys()]) {
    if (!nextIds.has(key)) {
      previousByKey.delete(key);
    }
  }
  // Map preserves insertion order, so keys().next() drops the oldest.
  while (previousByKey.size > MAX_TRACKED) {
    const oldest = previousByKey.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    previousByKey.delete(oldest);
  }
}

function emitCompletion(summary: ThreadSummary): void {
  if (activeThread(summary)) {
    return;
  }

  toastActions.add({
    type: "info",
    title: threadLabel(summary),
    description: "Finished working.",
    action: {
      label: "Open",
      run: () => {
        openThread(summary);
      },
    },
  });

  const appSettings = getAppSettingsSnapshot();
  if (appSettings.alertSoundsEnabled) {
    playConfiguredAlertSound(appSettings.alertSoundSelection, appSettings.customAlertSoundFileName);
  }

  if (!isWindowForeground() && appSettings.notifyWhenThreadFinishes) {
    notifyThread({
      body: "Finished working.",
      thread: summary,
    });
  }
}

function playConfiguredAlertSound(
  selection: AlertSoundSelection,
  customFileName: string | null,
): void {
  void playAlertSound(selection, customFileName).then((result) => {
    const current = getAppSettingsSnapshot();
    if (
      result !== "built-in" ||
      selection !== "custom" ||
      current.alertSoundSelection !== selection ||
      current.customAlertSoundFileName !== customFileName
    ) {
      return;
    }
    appSettingsActions.clearCustomAlertSound();
  });
}

function onInventoryChange(): void {
  const inventory = getInventorySnapshot();
  if (inventory.status !== "ready") {
    return;
  }

  // Delegation-owned sessions stay out of top-level surfaces; they alert nobody.
  const threads = inventory.sessions.filter((session) => session.delegation === undefined);
  const nextIds = new Set(threads.map((thread) => thread.id));

  for (const summary of threads) {
    const previous = previousByKey.get(summary.id);
    if (previous === undefined) {
      // Seed on first sighting so a full inventory boot does not alert.
      previousByKey.set(summary.id, { working: threadWorking(summary) });
      continue;
    }

    if (previous.working && !threadWorking(summary)) {
      emitCompletion(summary);
    }

    previousByKey.set(summary.id, { working: threadWorking(summary) });
  }

  capMemory(nextIds);
}

/**
 * Subscribe to core's session inventory and emit completion signals.
 * Idempotent; call once from start-app.
 */
export function installThreadNotifications(): void {
  if (installed) {
    return;
  }
  installed = true;
  // Desktop notification clicks arrive from the main process; route them to the thread.
  unsubscribeNotificationActivate = subscribeDesktopThreadNotificationActivate(openThreadTarget);
  uninstallAlertSoundPlayback = installAlertSoundPlayback();
  // Hold the inventory watch open for the app lifetime: alerts must fire
  // while no surface shows the list.
  releaseInventory = retainInventory();
  // Seed from whatever the store already folded (may be connecting/empty).
  onInventoryChange();
  unsubscribeWatch = subscribeInventory(onInventoryChange);
}

/** Test and hot-reload only. */
export function uninstallThreadNotifications(): void {
  unsubscribeWatch?.();
  unsubscribeWatch = null;
  releaseInventory?.();
  releaseInventory = null;
  unsubscribeNotificationActivate?.();
  unsubscribeNotificationActivate = null;
  uninstallAlertSoundPlayback?.();
  uninstallAlertSoundPlayback = null;
  installed = false;
  previousByKey.clear();
}
