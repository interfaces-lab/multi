import * as Electron from "electron";

const PROBE_FLAG = "HONK_DEV_STARTUP_PROBE";
const PROBE_STARTED_AT = "HONK_DEV_STARTUP_PROBE_STARTED_AT";
const PROBE_TIMEOUT_MS = 120_000;
const PROBE_PREFIX = "[honk-startup-probe]";

type StartupMilestone =
  | "backend-ready"
  | "browser-window-created"
  | "renderer-ready-to-show"
  | "renderer-authenticated";

const enabled = process.env[PROBE_FLAG] === "1";
const parsedStartedAt = Number(process.env[PROBE_STARTED_AT]);
const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
const milestones = new Map<StartupMilestone, number>();
let finishScheduled = false;

function relativeNow(): number {
  return Math.max(0, Date.now() - startedAt);
}

function finishIfComplete(): void {
  if (
    finishScheduled ||
    !milestones.has("backend-ready") ||
    !milestones.has("browser-window-created") ||
    !milestones.has("renderer-ready-to-show") ||
    !milestones.has("renderer-authenticated")
  ) {
    return;
  }

  finishScheduled = true;
  const result = {
    status: "complete",
    startedAt,
    milestones: Object.fromEntries(milestones),
  };
  console.log(`${PROBE_PREFIX} ${JSON.stringify(result)}`);
  setTimeout(() => Electron.app.quit(), 25);
}

export function markStartupMilestone(milestone: StartupMilestone): void {
  if (!enabled || milestones.has(milestone)) {
    return;
  }
  milestones.set(milestone, relativeNow());
  finishIfComplete();
}

if (enabled) {
  const timeout = setTimeout(() => {
    console.error(
      `${PROBE_PREFIX} ${JSON.stringify({
        status: "timeout",
        startedAt,
        milestones: Object.fromEntries(milestones),
      })}`,
    );
    Electron.app.quit();
  }, PROBE_TIMEOUT_MS);
  timeout.unref();
}
