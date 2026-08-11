import type { HonkConnection } from "./client";
import { Option, Schema } from "effect";

export const HONK_ACCESS_PROTOCOL_VERSION = 1;

export interface PairingInvitation {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: string;
}

export interface PairingGrant {
  readonly origin: string;
  readonly token: string;
}

export interface PairingPreview {
  readonly protocolVersion: 1;
  readonly environmentId: string;
  readonly expiresAt: string;
  readonly computerLabel: string;
}

export interface ProvisionalConnection {
  readonly connection: HonkConnection;
  readonly environmentId: string;
  readonly device: {
    readonly id: string;
    readonly label: string;
  };
  readonly expiresAt: string;
}

export interface ConfirmedConnection {
  readonly environmentId: string;
  readonly device: {
    readonly id: string;
    readonly label: string;
  };
}

export interface PairingExchangeInput {
  readonly requestId: string;
  readonly label: string;
  readonly replaceDeviceId?: string;
  readonly replacementBearer?: string;
}

export class HostAccessClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HostAccessClientError";
  }
}

export class HostAccessNetworkError extends Error {
  constructor(cause: unknown) {
    super(
      "Failed to reach this computer through Tailscale. Open Tailscale on both devices, make sure they are connected to the same Tailscale network, then try again.",
      { cause },
    );
    this.name = "HostAccessNetworkError";
  }
}

const DeviceResponse = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});
const PairingPreviewResponse = Schema.Struct({
  protocolVersion: Schema.Literal(HONK_ACCESS_PROTOCOL_VERSION),
  environmentId: Schema.String,
  expiresAt: Schema.String,
  computerLabel: Schema.String,
});
const PairingExchangeResponse = Schema.Struct({
  bearerToken: Schema.String,
  environmentId: Schema.String,
  expiresAt: Schema.String,
  device: DeviceResponse,
});
const PairingConfirmationResponse = Schema.Struct({
  environmentId: Schema.String,
  device: DeviceResponse,
});

const decodePairingPreview = Schema.decodeUnknownOption(PairingPreviewResponse);
const decodePairingExchange = Schema.decodeUnknownOption(PairingExchangeResponse);
const decodePairingConfirmation = Schema.decodeUnknownOption(PairingConfirmationResponse);

export const CORE_CONNECTION_SCHEMA = "honk.mobile.core-connection";

export interface StoredCoreConnection extends HonkConnection {
  readonly schema: "honk.mobile.core-connection";
  readonly environmentId: string;
  readonly computerLabel: string;
  readonly device: {
    readonly id: string;
    readonly label: string;
  };
}

const StoredCoreConnectionRecord = Schema.Struct({
  schema: Schema.Literal(CORE_CONNECTION_SCHEMA),
  url: Schema.NonEmptyString,
  bearerToken: Schema.NonEmptyString,
  environmentId: Schema.NonEmptyString,
  computerLabel: Schema.String,
  device: Schema.Struct({
    id: Schema.NonEmptyString,
    label: Schema.String,
  }),
});
const decodeJsonObject = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const decodeStoredCoreConnectionRecord = Schema.decodeUnknownOption(StoredCoreConnectionRecord);

const accessUrl = (origin: string, path: string): string =>
  new URL(path, `${origin.replace(/\/+$/, "")}/`).toString();

const requestJson = async (url: string, init: RequestInit): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause: unknown) {
    throw new HostAccessNetworkError(cause);
  }
  if (!response.ok) {
    throw new HostAccessClientError(
      response.status,
      `Honk device pairing failed (${response.status}).`,
    );
  }
  const value: unknown = await response.json();
  return value;
};

const headers = (bearerToken?: string): HeadersInit => ({
  "content-type": "application/json",
  ...(bearerToken === undefined ? {} : { authorization: `Bearer ${bearerToken}` }),
});

export function makePairingUrl(origin: string, token: string): string {
  const publicOrigin = new URL(origin);
  if (publicOrigin.protocol !== "https:" || publicOrigin.origin !== origin) {
    throw new Error("Pairing requires an HTTPS origin.");
  }
  const url = new URL("honk://connect");
  url.searchParams.set("origin", publicOrigin.origin);
  url.hash = new URLSearchParams({ pairing: token }).toString();
  return url.toString();
}

export function parsePairingUrl(value: string): PairingGrant | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "honk:" || url.hostname !== "connect") return null;
    const origin = url.searchParams.get("origin");
    const token = new URLSearchParams(url.hash.slice(1)).get("pairing");
    if (origin === null || token === null || token.length === 0) return null;
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin) return null;
    return { origin, token };
  } catch {
    return null;
  }
}

export async function previewPairing(grant: PairingGrant): Promise<PairingPreview> {
  const value = await requestJson(accessUrl(grant.origin, "/access/v1/pairing/preview"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ token: grant.token }),
  });
  return Option.match(decodePairingPreview(value), {
    onNone: () => {
      throw new HostAccessClientError(502, "Honk returned an invalid pairing preview.");
    },
    onSome: (preview) => preview,
  });
}

export async function exchangePairing(
  grant: PairingGrant,
  input: PairingExchangeInput,
): Promise<ProvisionalConnection> {
  const value = await requestJson(accessUrl(grant.origin, "/access/v1/pairing/exchange"), {
    method: "POST",
    headers: headers(input.replacementBearer),
    body: JSON.stringify({
      token: grant.token,
      requestId: input.requestId,
      label: input.label,
      ...(input.replaceDeviceId === undefined ? {} : { replaceDeviceId: input.replaceDeviceId }),
    }),
  });
  const exchange = Option.match(decodePairingExchange(value), {
    onNone: () => {
      throw new HostAccessClientError(502, "Honk returned an invalid provisional connection.");
    },
    onSome: (decoded) => decoded,
  });
  return {
    connection: { url: grant.origin, bearerToken: exchange.bearerToken },
    environmentId: exchange.environmentId,
    device: exchange.device,
    expiresAt: exchange.expiresAt,
  };
}

export async function confirmPairing(
  provisional: ProvisionalConnection,
): Promise<ConfirmedConnection> {
  const value = await requestJson(
    accessUrl(provisional.connection.url, "/access/v1/pairing/confirm"),
    {
      method: "POST",
      headers: headers(provisional.connection.bearerToken),
      body: "{}",
    },
  );
  return Option.match(decodePairingConfirmation(value), {
    onNone: () => {
      throw new HostAccessClientError(502, "Honk returned an invalid confirmed connection.");
    },
    onSome: (confirmation) => confirmation,
  });
}

export async function cancelPairing(provisional: ProvisionalConnection): Promise<void> {
  await revokeAccess(provisional.connection);
}

export async function revokeAccess(connection: HonkConnection): Promise<void> {
  await requestJson(accessUrl(connection.url, "/access/v1/pairing/cancel"), {
    method: "POST",
    headers: headers(connection.bearerToken),
    body: "{}",
  });
}

export function decodeStoredCoreConnection(raw: string): StoredCoreConnection {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The saved Honk connection is invalid.");
  }
  Option.match(decodeJsonObject(value), {
    onNone: () => {
      throw new Error("The saved Honk connection is invalid.");
    },
    onSome: () => undefined,
  });
  const record = Option.match(decodeStoredCoreConnectionRecord(value), {
    onNone: () => {
      throw new Error("The saved Honk connection uses an unsupported format.");
    },
    onSome: (decoded) => decoded,
  });
  let origin: string;
  try {
    origin = new URL(record.url).origin;
  } catch {
    origin = "";
  }
  const computerLabel = record.computerLabel.trim();
  const deviceLabel = record.device.label.trim();
  if (
    origin !== record.url ||
    !record.url.startsWith("https://") ||
    computerLabel.length === 0 ||
    deviceLabel.length === 0
  ) {
    throw new Error("The saved Honk connection uses an unsupported format.");
  }
  return {
    ...record,
    computerLabel,
    device: { ...record.device, label: deviceLabel },
  };
}

export function encodeStoredCoreConnection(connection: StoredCoreConnection): string {
  return JSON.stringify(connection);
}
