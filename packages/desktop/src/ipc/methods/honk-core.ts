import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as HonkCoreHost from "../../backend/honk-core-host";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

const HonkCoreConnection = Schema.Struct({
  url: Schema.String,
  bearerToken: Schema.String,
});

export const getHonkCoreConnection = makeIpcMethod({
  channel: IpcChannels.GET_HONK_CORE_CONNECTION_CHANNEL,
  payload: Schema.Void,
  result: HonkCoreConnection,
  handler: Effect.fn("desktop.ipc.honkCore.getConnection")(function* () {
    const host = yield* HonkCoreHost.HonkCoreHost;
    return host.connection;
  }),
});
