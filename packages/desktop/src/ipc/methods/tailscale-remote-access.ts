import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DesktopRemoteDeviceSchema,
  DesktopRemotePairingInvitationSchema,
  DesktopRemotePairingStateSchema,
  DesktopTailscaleRemoteAccessStateSchema,
} from "@honk/shared/desktop-api";

import * as HonkCoreHost from "../../backend/honk-core-host";
import * as TailscaleRemoteAccess from "../../backend/tailscale-remote-access";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

const PairingId = Schema.Struct({ id: Schema.String });
const DeviceId = Schema.Struct({ id: Schema.String });

class RemotePairingUnavailableError extends Data.TaggedError("RemotePairingUnavailableError")<{
  readonly message: string;
}> {}

export const getTailscaleRemoteAccess = makeIpcMethod({
  channel: IpcChannels.GET_TAILSCALE_REMOTE_ACCESS_CHANNEL,
  payload: Schema.Void,
  result: DesktopTailscaleRemoteAccessStateSchema,
  handler: Effect.fn("desktop.ipc.tailscaleRemoteAccess.get")(function* () {
    return yield* (yield* TailscaleRemoteAccess.TailscaleRemoteAccess).snapshot;
  }),
});

export const enableTailscaleRemoteAccess = makeIpcMethod({
  channel: IpcChannels.ENABLE_TAILSCALE_REMOTE_ACCESS_CHANNEL,
  payload: Schema.Void,
  result: DesktopTailscaleRemoteAccessStateSchema,
  handler: Effect.fn("desktop.ipc.tailscaleRemoteAccess.enable")(function* () {
    return yield* (yield* TailscaleRemoteAccess.TailscaleRemoteAccess).enable;
  }),
});

export const disableTailscaleRemoteAccess = makeIpcMethod({
  channel: IpcChannels.DISABLE_TAILSCALE_REMOTE_ACCESS_CHANNEL,
  payload: Schema.Void,
  result: DesktopTailscaleRemoteAccessStateSchema,
  handler: Effect.fn("desktop.ipc.tailscaleRemoteAccess.disable")(function* () {
    return yield* (yield* TailscaleRemoteAccess.TailscaleRemoteAccess).disable;
  }),
});

export const issueRemotePairing = makeIpcMethod({
  channel: IpcChannels.ISSUE_REMOTE_PAIRING_CHANNEL,
  payload: Schema.Void,
  result: DesktopRemotePairingInvitationSchema,
  handler: Effect.fn("desktop.ipc.remotePairing.issue")(function* () {
    const access = yield* TailscaleRemoteAccess.TailscaleRemoteAccess;
    const snapshot = yield* access.refresh;
    if (snapshot.status !== "connected") {
      return yield* new RemotePairingUnavailableError({
        message:
          snapshot.status === "error"
            ? snapshot.message
            : "Tailscale remote access is not connected.",
      });
    }
    const host = yield* HonkCoreHost.HonkCoreHost;
    return host.issuePairing(snapshot.url);
  }),
});

export const getRemotePairingState = makeIpcMethod({
  channel: IpcChannels.GET_REMOTE_PAIRING_STATE_CHANNEL,
  payload: PairingId,
  result: DesktopRemotePairingStateSchema,
  handler: Effect.fn("desktop.ipc.remotePairing.getState")(function* ({ id }) {
    return (yield* HonkCoreHost.HonkCoreHost).pairingState(id);
  }),
});

export const cancelRemotePairing = makeIpcMethod({
  channel: IpcChannels.CANCEL_REMOTE_PAIRING_CHANNEL,
  payload: PairingId,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.remotePairing.cancel")(function* ({ id }) {
    const host = yield* HonkCoreHost.HonkCoreHost;
    return yield* Effect.promise(() => host.cancelPairing(id));
  }),
});

export const listRemoteDevices = makeIpcMethod({
  channel: IpcChannels.LIST_REMOTE_DEVICES_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopRemoteDeviceSchema),
  handler: Effect.fn("desktop.ipc.remoteDevices.list")(function* () {
    return (yield* HonkCoreHost.HonkCoreHost).devices().map(({ id, label, createdAt }) => ({
      id,
      label,
      createdAt,
    }));
  }),
});

export const revokeRemoteDevice = makeIpcMethod({
  channel: IpcChannels.REVOKE_REMOTE_DEVICE_CHANNEL,
  payload: DeviceId,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.remoteDevices.revoke")(function* ({ id }) {
    const host = yield* HonkCoreHost.HonkCoreHost;
    return yield* Effect.promise(() => host.revokeDevice(id));
  }),
});
