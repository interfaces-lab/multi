import { createHonkClient } from "@honk/core";
import {
  cancelPairing,
  confirmPairing,
  exchangePairing,
  parsePairingUrl,
  previewPairing,
  CORE_CONNECTION_SCHEMA,
  type ConfirmedConnection,
  type PairingGrant,
  type PairingPreview,
  type ProvisionalConnection,
  type StoredCoreConnection,
} from "@honk/core/access";

export interface CorePairingStorage {
  readonly save: (connection: StoredCoreConnection) => Promise<void>;
  readonly restore: (connection: StoredCoreConnection | null) => Promise<void>;
}

export interface CorePairingOperations {
  readonly preview: (grant: PairingGrant) => Promise<PairingPreview>;
  readonly exchange: (
    grant: PairingGrant,
    input: {
      readonly requestId: string;
      readonly label: string;
      readonly replaceDeviceId?: string;
      readonly replacementBearer?: string;
    },
  ) => Promise<ProvisionalConnection>;
  readonly confirm: (connection: ProvisionalConnection) => Promise<ConfirmedConnection>;
  readonly cancel: (connection: ProvisionalConnection) => Promise<void>;
  readonly probe: (connection: StoredCoreConnection) => Promise<void>;
}

const liveOperations: CorePairingOperations = {
  preview: previewPairing,
  exchange: exchangePairing,
  confirm: confirmPairing,
  cancel: cancelPairing,
  probe: async (connection) => {
    const client = await createHonkClient(connection);
    try {
      await client.session.list({});
    } finally {
      await client.close();
    }
  },
};

function sameIdentity(
  expected: { readonly environmentId: string; readonly device?: { readonly id: string } },
  actual: { readonly environmentId: string; readonly device?: { readonly id: string } },
): boolean {
  return (
    expected.environmentId === actual.environmentId &&
    (expected.device === undefined ||
      actual.device === undefined ||
      expected.device.id === actual.device.id)
  );
}

export async function adoptCorePairing(
  input: {
    readonly url: string;
    readonly requestId: string;
    readonly deviceLabel: string;
    readonly current: StoredCoreConnection | null;
  },
  storage: CorePairingStorage,
  operations: CorePairingOperations = liveOperations,
): Promise<{ readonly computerLabel: string; readonly connection: StoredCoreConnection }> {
  const grant = parsePairingUrl(input.url);
  if (grant === null) throw new Error("Scan a Honk pairing code from your computer.");

  const preview = await operations.preview(grant);
  if (input.current !== null && input.current.environmentId !== preview.environmentId) {
    throw new Error("Disconnect the current computer before connecting another one.");
  }

  const provisional = await operations.exchange(grant, {
    requestId: input.requestId,
    label: input.deviceLabel,
    ...(input.current === null
      ? {}
      : {
          replaceDeviceId: input.current.device.id,
          replacementBearer: input.current.bearerToken,
        }),
  });
  if (!sameIdentity(preview, provisional)) {
    await operations.cancel(provisional).catch(() => undefined);
    throw new Error("The computer identity changed during pairing.");
  }

  const connection: StoredCoreConnection = {
    schema: CORE_CONNECTION_SCHEMA,
    ...provisional.connection,
    environmentId: provisional.environmentId,
    computerLabel: preview.computerLabel,
    device: provisional.device,
  };

  try {
    await storage.save(connection);
  } catch (cause: unknown) {
    await operations.cancel(provisional).catch(() => undefined);
    throw new Error("Honk could not save the new connection.", { cause });
  }

  let confirmed: ConfirmedConnection | null = null;
  try {
    confirmed = await operations.confirm(provisional);
  } catch (cause: unknown) {
    // A response can disappear after the host committed. The bearer itself is
    // the authoritative repair check before rolling storage back.
    try {
      await operations.probe(connection);
    } catch {
      await storage.restore(input.current);
      await operations.cancel(provisional).catch(() => undefined);
      throw cause;
    }
  }
  if (confirmed !== null && !sameIdentity(connection, confirmed)) {
    await storage.restore(input.current);
    await operations.cancel(provisional).catch(() => undefined);
    throw new Error("The computer identity changed while confirming pairing.");
  }

  return { computerLabel: connection.computerLabel, connection };
}
