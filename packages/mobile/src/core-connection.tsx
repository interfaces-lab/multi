import { createHonkClient, type HonkClient } from "@honk/core";
import {
  decodeStoredCoreConnection,
  encodeStoredCoreConnection,
  parsePairingUrl,
  revokeAccess,
  type StoredCoreConnection,
} from "@honk/core/access";
import { Session } from "@honk/core/session";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as React from "react";
import { AppState } from "react-native";

import { adoptCorePairing } from "./core-pairing";

const CONNECTION_STORAGE_KEY = "honk.mobile.core-connection";

type ConnectionStatus =
  | "restoring"
  | "disconnected"
  | "connecting"
  | "ready"
  | "error"
  | "disconnecting"
  | "forgetting";

interface CoreConnectionValue {
  readonly status: ConnectionStatus;
  readonly connection: StoredCoreConnection | null;
  readonly client: HonkClient | null;
  readonly sessions: readonly Session.SessionSummary[];
  readonly error: string | null;
  readonly pendingPairingUrl: string | null;
  readonly pair: (url: string) => Promise<void>;
  readonly claimPairingUrl: (url: string) => void;
  readonly retry: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly forget: () => Promise<void>;
}

const CoreConnectionContext = React.createContext<CoreConnectionValue | null>(null);

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : "Honk could not connect to your computer.";
}

const saveConnection = (connection: StoredCoreConnection): Promise<void> =>
  SecureStore.setItemAsync(CONNECTION_STORAGE_KEY, encodeStoredCoreConnection(connection));

const restoreConnection = (connection: StoredCoreConnection | null): Promise<void> =>
  connection === null
    ? SecureStore.deleteItemAsync(CONNECTION_STORAGE_KEY)
    : saveConnection(connection);

export function CoreConnectionProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [status, setStatus] = React.useState<ConnectionStatus>("restoring");
  const [connection, setConnection] = React.useState<StoredCoreConnection | null>(null);
  const [client, setClient] = React.useState<HonkClient | null>(null);
  const [sessions, setSessions] = React.useState<readonly Session.SessionSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingPairingUrl, setPendingPairingUrl] = React.useState<string | null>(null);
  const currentClient = React.useRef<HonkClient | null>(null);
  const clientHealthy = React.useRef(false);
  const generation = React.useRef(0);
  const pairingGeneration = React.useRef(0);
  const connectionRef = React.useRef(connection);
  const statusRef = React.useRef(status);
  const receivedPairingKeys = React.useRef<readonly string[]>([]);
  const foregroundTask = React.useRef(false);
  connectionRef.current = connection;
  statusRef.current = status;

  const claimPairingUrl = React.useCallback((url: string): void => {
    setPendingPairingUrl((pending) => (pending === url ? null : pending));
  }, []);

  React.useEffect(() => {
    let active = true;
    const receive = (raw: string): void => {
      const url = raw.trim();
      if (url.length === 0) return;
      let key: string;
      try {
        const grant = parsePairingUrl(url);
        if (grant === null) return;
        key = `${grant.origin}\n${grant.token}`;
      } catch {
        return;
      }
      if (receivedPairingKeys.current.includes(key)) return;
      receivedPairingKeys.current = [...receivedPairingKeys.current.slice(-31), key];
      setPendingPairingUrl(url);
    };
    const subscription = Linking.addEventListener("url", ({ url }) => receive(url));
    void Linking.getInitialURL().then(
      (url) => {
        if (active && url !== null) receive(url);
      },
      () => undefined,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const closeCurrent = React.useCallback(async (): Promise<void> => {
    const opened = currentClient.current;
    currentClient.current = null;
    clientHealthy.current = false;
    setClient(null);
    if (opened !== null) await opened.close().catch(() => undefined);
  }, []);

  const attach = React.useCallback(
    async (record: StoredCoreConnection, requestGeneration: number): Promise<void> => {
      const opened = await createHonkClient(record);
      try {
        const listed = await opened.session.list({});
        if (requestGeneration !== generation.current) {
          await opened.close();
          return;
        }
        await closeCurrent();
        currentClient.current = opened;
        clientHealthy.current = true;
        setClient(opened);
        setConnection(record);
        setSessions(listed.sessions);
        setError(null);
        setStatus("ready");

        void (async () => {
          try {
            for await (const inventory of opened.session.watchInventory({})) {
              if (requestGeneration !== generation.current || currentClient.current !== opened) {
                return;
              }
              setSessions(inventory.sessions);
            }
            if (requestGeneration === generation.current && currentClient.current === opened) {
              clientHealthy.current = false;
              setStatus("error");
              setError("Honk stopped sending session updates. Try again.");
            }
          } catch (cause: unknown) {
            if (requestGeneration === generation.current && currentClient.current === opened) {
              clientHealthy.current = false;
              setStatus("error");
              setError(messageOf(cause));
            }
          }
        })();
      } catch (cause: unknown) {
        await opened.close().catch(() => undefined);
        throw cause;
      }
    },
    [closeCurrent],
  );

  const restore = React.useCallback(async (): Promise<void> => {
    const requestGeneration = ++generation.current;
    setStatus("restoring");
    setError(null);
    try {
      const raw = await SecureStore.getItemAsync(CONNECTION_STORAGE_KEY);
      if (requestGeneration !== generation.current) return;
      if (raw === null) {
        setConnection(null);
        setSessions([]);
        setStatus("disconnected");
        return;
      }
      const record = decodeStoredCoreConnection(raw);
      setConnection(record);
      await attach(record, requestGeneration);
    } catch (cause: unknown) {
      if (requestGeneration !== generation.current) return;
      setStatus("error");
      setError(messageOf(cause));
    }
  }, [attach]);

  React.useEffect(() => {
    void restore();
    return () => {
      generation.current += 1;
      pairingGeneration.current += 1;
      void currentClient.current?.close();
      currentClient.current = null;
      clientHealthy.current = false;
    };
  }, [restore]);

  const pair = React.useCallback(
    async (url: string): Promise<void> => {
      const requestPairingGeneration = ++pairingGeneration.current;
      let adoptedConnection: StoredCoreConnection | null = null;
      let requestGeneration: number | null = null;
      setStatus("connecting");
      setError(null);
      try {
        const adopted = await adoptCorePairing(
          {
            url,
            requestId: Crypto.randomUUID(),
            deviceLabel:
              process.env.EXPO_OS === "ios"
                ? "Honk on iOS"
                : process.env.EXPO_OS === "android"
                  ? "Honk on Android"
                  : "Honk mobile",
            current: connection,
          },
          { save: saveConnection, restore: restoreConnection },
        );
        if (requestPairingGeneration !== pairingGeneration.current) return;
        adoptedConnection = adopted.connection;
        setConnection(adopted.connection);
        requestGeneration = ++generation.current;
        await attach(adopted.connection, requestGeneration);
      } catch (cause: unknown) {
        if (
          requestPairingGeneration !== pairingGeneration.current ||
          (requestGeneration !== null && requestGeneration !== generation.current)
        ) {
          return;
        }
        if (adoptedConnection !== null) {
          setConnection(adoptedConnection);
          setStatus("error");
        } else if (currentClient.current !== null && clientHealthy.current && connection !== null) {
          setStatus("ready");
        } else {
          setStatus(connection === null ? "disconnected" : "error");
        }
        setError(messageOf(cause));
        throw cause;
      }
    },
    [attach, connection],
  );

  const retry = React.useCallback(async (): Promise<void> => {
    const record = connectionRef.current;
    if (record === null) {
      await restore();
      return;
    }
    const requestGeneration = ++generation.current;
    setStatus("connecting");
    setError(null);
    try {
      await attach(record, requestGeneration);
    } catch (cause: unknown) {
      if (requestGeneration === generation.current) {
        setConnection(record);
        setStatus("error");
        setError(messageOf(cause));
      }
      throw cause;
    }
  }, [attach, restore]);

  const refresh = React.useCallback(async (): Promise<void> => {
    const opened = currentClient.current;
    if (opened === null) throw new Error("Honk is not connected to this computer.");
    try {
      const listed = await opened.session.list({});
      if (currentClient.current === opened) {
        clientHealthy.current = true;
        setSessions(listed.sessions);
      }
    } catch (cause: unknown) {
      if (currentClient.current === opened) clientHealthy.current = false;
      throw cause;
    }
  }, []);

  React.useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returnedToForeground = previousState !== "active" && nextState === "active";
      previousState = nextState;
      if (!returnedToForeground || foregroundTask.current) return;
      const currentStatus = statusRef.current;
      if (currentStatus !== "ready" && currentStatus !== "error") return;
      foregroundTask.current = true;
      const task = currentStatus === "ready" ? refresh() : retry();
      void task
        .catch((cause: unknown) => {
          if (connectionRef.current !== null) {
            setStatus("error");
            setError(messageOf(cause));
          }
        })
        .finally(() => {
          foregroundTask.current = false;
        });
    });
    return () => subscription.remove();
  }, [refresh, retry]);

  const forget = React.useCallback(async (): Promise<void> => {
    generation.current += 1;
    pairingGeneration.current += 1;
    setStatus("forgetting");
    await closeCurrent();
    try {
      await SecureStore.deleteItemAsync(CONNECTION_STORAGE_KEY);
      setConnection(null);
      setSessions([]);
      setError(null);
      setStatus("disconnected");
    } catch (cause: unknown) {
      setStatus("error");
      setError(messageOf(cause));
      throw cause;
    }
  }, [closeCurrent]);

  const disconnect = React.useCallback(async (): Promise<void> => {
    const active = connection;
    if (active === null) return forget();
    generation.current += 1;
    pairingGeneration.current += 1;
    setStatus("disconnecting");
    await closeCurrent();
    try {
      await revokeAccess(active);
      await SecureStore.deleteItemAsync(CONNECTION_STORAGE_KEY);
      setConnection(null);
      setSessions([]);
      setError(null);
      setStatus("disconnected");
    } catch (cause: unknown) {
      setError(messageOf(cause));
      setStatus("error");
      throw cause;
    }
  }, [closeCurrent, connection, forget]);

  const value = React.useMemo<CoreConnectionValue>(
    () => ({
      status,
      connection,
      client,
      sessions,
      error,
      pendingPairingUrl,
      pair,
      claimPairingUrl,
      retry,
      refresh,
      disconnect,
      forget,
    }),
    [
      claimPairingUrl,
      client,
      connection,
      disconnect,
      error,
      forget,
      pair,
      pendingPairingUrl,
      refresh,
      retry,
      sessions,
      status,
    ],
  );
  return (
    <CoreConnectionContext.Provider value={value}>{props.children}</CoreConnectionContext.Provider>
  );
}

export function useCoreConnection(): CoreConnectionValue {
  const value = React.useContext(CoreConnectionContext);
  if (value === null)
    throw new Error("useCoreConnection must be used inside CoreConnectionProvider.");
  return value;
}
