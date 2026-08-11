import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { markStartupMilestone } from "../../startup-probe";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const reportStartupMilestone = makeIpcMethod({
  channel: IpcChannels.REPORT_STARTUP_MILESTONE_CHANNEL,
  payload: Schema.Literals(["renderer-authenticated"]),
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (milestone) {
    yield* Effect.sync(() => markStartupMilestone(milestone));
  }),
});
