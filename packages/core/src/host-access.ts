import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Option, Schema } from "effect";

export interface AccessDeviceRecord {
  readonly id: string;
  readonly label: string;
  readonly bearerHash: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

const PAIRING_TTL_MS = 10 * 60 * 1000;
const PAIRING_RESULT_TTL_MS = 10 * 60 * 1000;
const ACCESS_STATE_FILE = "access.json";

export interface HostAccessState {
  readonly version: 1;
  readonly environmentId: string;
  readonly devices: readonly AccessDeviceRecord[];
}

export interface OpenHostAccess {
  readonly environmentId: string;
  readonly access: HostAccess;
}

export class HostAccessStateError extends Error {
  constructor() {
    super("Honk's device access state is invalid.");
    this.name = "HostAccessStateError";
  }
}

export const REMOTE_DISPLAY_NAME_MAX_LENGTH = 80;
export const PAIRING_REQUEST_ID_MAX_LENGTH = 128;
const PAIRING_REQUEST_ID_MIN_LENGTH = 8;

type PendingPairing = {
  readonly status: "pending";
  readonly id: string;
  readonly tokenHash: string;
  readonly expiresAt: number;
  readonly computerLabel: string;
};

type ProvisionalPairing = {
  readonly status: "provisional";
  readonly id: string;
  readonly tokenHash: string;
  readonly expiresAt: number;
  readonly computerLabel: string;
  readonly requestID: string;
  readonly bearerToken: string;
  readonly device: AccessDeviceRecord;
  readonly replaceDeviceID: string | null;
};

type PairingRecord =
  | PendingPairing
  | ProvisionalPairing
  | {
      readonly status: "completed";
      readonly id: string;
      readonly expiresAt: number;
      readonly requestID: string;
      readonly bearerHash: string;
      readonly device: Pick<IssuedDevice, "id" | "label">;
      readonly replacedDeviceID: string | null;
    }
  | {
      readonly status: "cancelled" | "expired";
      readonly id: string;
      readonly expiresAt: number;
    };

export interface IssuedPairing {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: string;
}

export interface PairingPreview {
  readonly expiresAt: string;
  readonly computerLabel: string;
}

export interface IssuedDevice {
  readonly id: string;
  readonly label: string;
  readonly bearerToken: string;
  readonly replacedDeviceID: string | null;
}

export interface ProvisionalDevice extends IssuedDevice {
  readonly requestID: string;
  readonly expiresAt: string;
}

export type PairingProvisionResult =
  | { readonly status: "provisional"; readonly device: ProvisionalDevice }
  | { readonly status: "in-progress" }
  | { readonly status: "invalid" };

export type PairingConfirmationResult =
  | { readonly status: "completed"; readonly device: IssuedDevice }
  | { readonly status: "invalid" };

export interface PairingCancellation {
  readonly cancelled: boolean;
  readonly revokedDeviceID: string | null;
}

export type PairingState =
  | { readonly status: "unknown" }
  | { readonly status: "pending"; readonly expiresAt: string }
  | { readonly status: "cancelled"; readonly expiresAt: string }
  | { readonly status: "expired"; readonly expiresAt: string }
  | {
      readonly status: "completed";
      readonly expiresAt: string;
      readonly device: Pick<IssuedDevice, "id" | "label">;
    };

export class RemoteDisplayNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteDisplayNameError";
  }
}

export class PairingRequestIDError extends Error {
  constructor() {
    super(
      `Request IDs must be ${PAIRING_REQUEST_ID_MIN_LENGTH}–${PAIRING_REQUEST_ID_MAX_LENGTH} letters, numbers, underscores, or hyphens.`,
    );
    this.name = "PairingRequestIDError";
  }
}

export function normalizePairingRequestID(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < PAIRING_REQUEST_ID_MIN_LENGTH ||
    normalized.length > PAIRING_REQUEST_ID_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(normalized)
  ) {
    throw new PairingRequestIDError();
  }
  return normalized;
}

export function normalizeRemoteDisplayName(value: string, fallback?: string): string {
  const normalized = value.trim() || fallback?.trim() || "";
  if (normalized.length === 0) {
    throw new RemoteDisplayNameError("Enter a name.");
  }
  if (normalized.length > REMOTE_DISPLAY_NAME_MAX_LENGTH) {
    throw new RemoteDisplayNameError(
      `Names can be at most ${REMOTE_DISPLAY_NAME_MAX_LENGTH} characters.`,
    );
  }
  return normalized;
}

const hashSecret = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const equalHash = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const StoredAccessDevice = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  bearerHash: Schema.String,
  createdAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
});
const StoredHostAccessState = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: Schema.String,
  devices: Schema.Array(StoredAccessDevice),
});
const decodeStoredHostAccessState = Schema.decodeUnknownOption(StoredHostAccessState);

const decodeHostAccessState = (value: unknown): HostAccessState => {
  const decoded = decodeStoredHostAccessState(value);
  if (Option.isNone(decoded)) throw new HostAccessStateError();
  return decoded.value;
};

const missingFile = (cause: unknown): boolean =>
  cause instanceof Error && Reflect.get(cause, "code") === "ENOENT";

const writeHostAccessState = async (
  dataDirectory: string,
  state: HostAccessState,
): Promise<void> => {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await chmod(dataDirectory, 0o700);
  const destination = join(dataDirectory, ACCESS_STATE_FILE);
  const temporary = `${destination}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
};

export async function openHostAccess(dataDirectory: string): Promise<OpenHostAccess> {
  const statePath = join(dataDirectory, ACCESS_STATE_FILE);
  let state: HostAccessState;
  try {
    const stored: unknown = JSON.parse(await readFile(statePath, "utf8"));
    state = decodeHostAccessState(stored);
  } catch (cause: unknown) {
    if (!missingFile(cause)) throw cause;
    state = {
      version: 1,
      environmentId: randomBytes(16).toString("hex"),
      devices: [],
    };
    await writeHostAccessState(dataDirectory, state);
  }

  const persist = async (devices: readonly AccessDeviceRecord[]): Promise<void> => {
    await writeHostAccessState(dataDirectory, { ...state, devices });
    state = { ...state, devices: [...devices] };
  };
  return {
    environmentId: state.environmentId,
    access: new HostAccess(state.devices, persist),
  };
}

export class HostAccess {
  readonly #pairingIDsByToken = new Map<string, string>();
  readonly #pairingIDsByProvisionalBearer = new Map<string, string>();
  readonly #pairingIDsByCompletedBearer = new Map<string, string>();
  readonly #pairings = new Map<string, PairingRecord>();
  readonly #revocationListeners = new Map<string, Set<() => void>>();
  #devices: AccessDeviceRecord[];
  readonly #persist: (devices: readonly AccessDeviceRecord[]) => Promise<void>;
  #pendingMutation: Promise<void> = Promise.resolve();

  constructor(
    devices: readonly AccessDeviceRecord[],
    persist: (devices: readonly AccessDeviceRecord[]) => Promise<void>,
  ) {
    this.#devices = [...devices];
    this.#persist = persist;
  }

  list(): readonly AccessDeviceRecord[] {
    return this.#devices.map((device) => ({ ...device }));
  }

  issuePairing(computerLabel = "Computer"): IssuedPairing {
    const now = Date.now();
    this.#removeStalePairings(now);
    const id = randomBytes(12).toString("hex");
    const token = randomBytes(24).toString("base64url");
    const tokenHash = hashSecret(token);
    const expiresAt = now + PAIRING_TTL_MS;
    this.#pairingIDsByToken.set(tokenHash, id);
    this.#pairings.set(id, {
      status: "pending",
      id,
      tokenHash,
      expiresAt,
      computerLabel: normalizeRemoteDisplayName(computerLabel, "Computer"),
    });
    return { id, token, expiresAt: new Date(expiresAt).toISOString() };
  }

  preview(token: string): PairingPreview | null {
    this.#removeStalePairings(Date.now());
    const id = this.#pairingIDsByToken.get(hashSecret(token));
    const pairing = id === undefined ? undefined : this.#pairings.get(id);
    if (pairing?.status === "pending") {
      return {
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        computerLabel: pairing.computerLabel,
      };
    }
    if (pairing?.status === "provisional") {
      return {
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        computerLabel: pairing.computerLabel,
      };
    }
    return null;
  }

  pairingState(id: string): PairingState {
    this.#removeStalePairings(Date.now());
    const pairing = this.#pairings.get(id);
    if (pairing === undefined) return { status: "unknown" };
    if (pairing.status === "pending" || pairing.status === "provisional") {
      return { status: "pending", expiresAt: new Date(pairing.expiresAt).toISOString() };
    }
    if (pairing.status === "completed") {
      if (
        !this.#devices.some(
          (device) => device.id === pairing.device.id && device.revokedAt === null,
        )
      ) {
        return { status: "cancelled", expiresAt: new Date(pairing.expiresAt).toISOString() };
      }
      return {
        status: pairing.status,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        device: pairing.device,
      };
    }
    return { status: pairing.status, expiresAt: new Date(pairing.expiresAt).toISOString() };
  }

  cancelPairing(id: string): Promise<PairingCancellation> {
    return this.#mutate(async () => {
      const now = Date.now();
      this.#removeStalePairings(now);
      const pairing = this.#pairings.get(id);
      if (pairing?.status === "completed") {
        return { cancelled: false, revokedDeviceID: null };
      }
      return this.#cancelPairing(pairing, now);
    });
  }

  cancelPairingCandidate(bearerToken: string): Promise<PairingCancellation> {
    return this.#mutate(async () => {
      const now = Date.now();
      this.#removeStalePairings(now);
      const bearerHash = hashSecret(bearerToken);
      const id =
        this.#pairingIDsByProvisionalBearer.get(bearerHash) ??
        this.#pairingIDsByCompletedBearer.get(bearerHash);
      if (id !== undefined) return this.#cancelPairing(this.#pairings.get(id), now);
      const device = this.#devices.find(
        (candidate) => candidate.revokedAt === null && equalHash(candidate.bearerHash, bearerHash),
      );
      if (device === undefined || !(await this.#revokeDevice(device.id, now))) {
        return { cancelled: false, revokedDeviceID: null };
      }
      return { cancelled: true, revokedDeviceID: device.id };
    });
  }

  provision(
    token: string,
    requestID: string,
    requestedLabel?: string,
    replaceDeviceID?: string,
    provisionalBearer?: string,
  ): Promise<PairingProvisionResult> {
    return this.#mutate(async () => {
      const now = Date.now();
      this.#removeStalePairings(now);
      const normalizedRequestID = normalizePairingRequestID(requestID);
      const tokenHash = hashSecret(token);
      const id = this.#pairingIDsByToken.get(tokenHash);
      if (id === undefined) return { status: "invalid" };
      const pairing = this.#pairings.get(id);
      if (pairing?.status === "provisional") {
        if (
          pairing.requestID !== normalizedRequestID &&
          (provisionalBearer === undefined ||
            !equalHash(pairing.device.bearerHash, hashSecret(provisionalBearer)))
        ) {
          return { status: "in-progress" };
        }
        return { status: "provisional", device: this.#publicProvisional(pairing) };
      }
      if (pairing?.status !== "pending") return { status: "invalid" };
      const replacedDevice =
        replaceDeviceID === undefined
          ? null
          : (this.#devices.find(
              (candidate) => candidate.id === replaceDeviceID && candidate.revokedAt === null,
            ) ?? null);
      if (replaceDeviceID !== undefined && replacedDevice === null) {
        return { status: "invalid" };
      }

      const label = normalizeRemoteDisplayName(requestedLabel ?? "New device", "New device");
      const bearerToken = randomBytes(32).toString("base64url");
      const createdAt = new Date(now).toISOString();
      const device: AccessDeviceRecord = {
        id: randomBytes(12).toString("hex"),
        label,
        bearerHash: hashSecret(bearerToken),
        createdAt,
        revokedAt: null,
      };
      const provisional: ProvisionalPairing = {
        status: "provisional",
        id,
        tokenHash,
        expiresAt: pairing.expiresAt,
        computerLabel: pairing.computerLabel,
        requestID: normalizedRequestID,
        bearerToken,
        device,
        replaceDeviceID: replacedDevice?.id ?? null,
      };
      this.#pairingIDsByProvisionalBearer.set(device.bearerHash, id);
      this.#pairings.set(id, provisional);
      return { status: "provisional", device: this.#publicProvisional(provisional) };
    });
  }

  confirm(bearerToken: string): Promise<PairingConfirmationResult> {
    return this.#mutate(async () => {
      const now = Date.now();
      this.#removeStalePairings(now);
      const bearerHash = hashSecret(bearerToken);
      const provisionalID = this.#pairingIDsByProvisionalBearer.get(bearerHash);
      const provisional =
        provisionalID === undefined ? undefined : this.#pairings.get(provisionalID);
      if (provisional?.status === "provisional") {
        if (
          provisional.replaceDeviceID !== null &&
          !this.#devices.some(
            (device) => device.id === provisional.replaceDeviceID && device.revokedAt === null,
          )
        ) {
          this.#cancelProvisionalReplacements(provisional.replaceDeviceID);
          return { status: "invalid" };
        }
        const nextDevices = [
          ...this.#devices.map((device) =>
            device.id === provisional.replaceDeviceID && device.revokedAt === null
              ? { ...device, revokedAt: new Date(now).toISOString() }
              : device,
          ),
          provisional.device,
        ];
        await this.#persist(nextDevices);
        this.#devices = nextDevices;
        this.#pairingIDsByToken.delete(provisional.tokenHash);
        this.#pairingIDsByProvisionalBearer.delete(bearerHash);
        this.#pairingIDsByCompletedBearer.set(bearerHash, provisional.id);
        this.#pairings.set(provisional.id, {
          status: "completed",
          id: provisional.id,
          expiresAt: provisional.expiresAt,
          requestID: provisional.requestID,
          bearerHash,
          device: { id: provisional.device.id, label: provisional.device.label },
          replacedDeviceID: provisional.replaceDeviceID,
        });
        if (provisional.replaceDeviceID !== null) {
          this.#notifyRevoked(provisional.replaceDeviceID);
          this.#cancelProvisionalReplacements(provisional.replaceDeviceID);
        }
        return {
          status: "completed",
          device: {
            id: provisional.device.id,
            label: provisional.device.label,
            bearerToken,
            replacedDeviceID: provisional.replaceDeviceID,
          },
        };
      }

      const completedID = this.#pairingIDsByCompletedBearer.get(bearerHash);
      const completed = completedID === undefined ? undefined : this.#pairings.get(completedID);
      const activeDevice = this.#devices.find(
        (device) => device.revokedAt === null && equalHash(device.bearerHash, bearerHash),
      );
      if (
        completed?.status !== "completed" ||
        activeDevice === undefined ||
        activeDevice.id !== completed.device.id
      ) {
        return { status: "invalid" };
      }
      return {
        status: "completed",
        device: {
          id: completed.device.id,
          label: completed.device.label,
          bearerToken,
          replacedDeviceID: completed.replacedDeviceID,
        },
      };
    });
  }

  cancelProvisional(bearerToken: string): Promise<boolean> {
    return this.#mutate(async () => {
      this.#removeStalePairings(Date.now());
      const bearerHash = hashSecret(bearerToken);
      const id = this.#pairingIDsByProvisionalBearer.get(bearerHash);
      const pairing = id === undefined ? undefined : this.#pairings.get(id);
      if (pairing?.status !== "provisional") return false;
      this.#pairingIDsByToken.delete(pairing.tokenHash);
      this.#pairingIDsByProvisionalBearer.delete(bearerHash);
      this.#pairings.set(pairing.id, {
        status: "cancelled",
        id: pairing.id,
        expiresAt: pairing.expiresAt,
      });
      return true;
    });
  }

  authenticate(bearerToken: string): AccessDeviceRecord | null {
    const candidate = hashSecret(bearerToken);
    return (
      this.#devices.find(
        (device) => device.revokedAt === null && equalHash(device.bearerHash, candidate),
      ) ?? null
    );
  }

  onRevoke(deviceId: string, listener: () => void): () => void {
    const listeners = this.#revocationListeners.get(deviceId) ?? new Set<() => void>();
    listeners.add(listener);
    this.#revocationListeners.set(deviceId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#revocationListeners.delete(deviceId);
    };
  }

  revoke(id: string): Promise<boolean> {
    return this.#mutate(() => this.#revokeDevice(id, Date.now()));
  }

  rename(id: string, label: string): Promise<boolean> {
    return this.#mutate(async () => {
      const device = this.#devices.find((candidate) => candidate.id === id);
      if (device === undefined || device.revokedAt !== null) return false;
      const normalized = normalizeRemoteDisplayName(label);
      if (device.label === normalized) return true;
      const nextDevices = this.#devices.map((candidate) =>
        candidate.id === id ? { ...candidate, label: normalized } : candidate,
      );
      await this.#persist(nextDevices);
      this.#devices = nextDevices;
      return true;
    });
  }

  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingMutation.then(operation, operation);
    this.#pendingMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #cancelPairing(
    pairing: PairingRecord | undefined,
    now: number,
  ): Promise<PairingCancellation> {
    if (pairing?.status === "pending" || pairing?.status === "provisional") {
      this.#pairingIDsByToken.delete(pairing.tokenHash);
      if (pairing.status === "provisional") {
        this.#pairingIDsByProvisionalBearer.delete(pairing.device.bearerHash);
      }
      this.#pairings.set(pairing.id, {
        status: "cancelled",
        id: pairing.id,
        expiresAt: pairing.expiresAt,
      });
      return { cancelled: true, revokedDeviceID: null };
    }
    if (pairing?.status !== "completed") {
      return { cancelled: false, revokedDeviceID: null };
    }
    await this.#revokeDevice(pairing.device.id, now);
    this.#pairingIDsByCompletedBearer.delete(pairing.bearerHash);
    this.#pairings.set(pairing.id, {
      status: "cancelled",
      id: pairing.id,
      expiresAt: pairing.expiresAt,
    });
    return { cancelled: true, revokedDeviceID: pairing.device.id };
  }

  async #revokeDevice(id: string, now: number): Promise<boolean> {
    const device = this.#devices.find((candidate) => candidate.id === id);
    if (device === undefined || device.revokedAt !== null) return false;
    const nextDevices = this.#devices.map((candidate) =>
      candidate.id === id ? { ...candidate, revokedAt: new Date(now).toISOString() } : candidate,
    );
    await this.#persist(nextDevices);
    this.#devices = nextDevices;
    this.#notifyRevoked(id);
    this.#cancelProvisionalReplacements(id);
    return true;
  }

  #removeStalePairings(now: number): void {
    for (const [id, pairing] of this.#pairings) {
      if (
        (pairing.status === "pending" || pairing.status === "provisional") &&
        pairing.expiresAt <= now
      ) {
        this.#pairingIDsByToken.delete(pairing.tokenHash);
        if (pairing.status === "provisional") {
          this.#pairingIDsByProvisionalBearer.delete(pairing.device.bearerHash);
        }
        this.#pairings.set(id, { status: "expired", id, expiresAt: pairing.expiresAt });
        continue;
      }
      if (
        pairing.status !== "pending" &&
        pairing.status !== "provisional" &&
        pairing.expiresAt + PAIRING_RESULT_TTL_MS <= now
      ) {
        if (pairing.status === "completed") {
          this.#pairingIDsByCompletedBearer.delete(pairing.bearerHash);
        }
        this.#pairings.delete(id);
      }
    }
  }

  #cancelProvisionalReplacements(deviceID: string): void {
    for (const [id, pairing] of this.#pairings) {
      if (pairing.status !== "provisional" || pairing.replaceDeviceID !== deviceID) continue;
      this.#pairingIDsByToken.delete(pairing.tokenHash);
      this.#pairingIDsByProvisionalBearer.delete(pairing.device.bearerHash);
      this.#pairings.set(id, { status: "cancelled", id, expiresAt: pairing.expiresAt });
    }
  }

  #notifyRevoked(deviceId: string): void {
    const listeners = this.#revocationListeners.get(deviceId);
    if (listeners === undefined) return;
    this.#revocationListeners.delete(deviceId);
    for (const listener of listeners) listener();
  }

  #publicProvisional(pairing: ProvisionalPairing): ProvisionalDevice {
    return {
      id: pairing.device.id,
      label: pairing.device.label,
      bearerToken: pairing.bearerToken,
      replacedDeviceID: pairing.replaceDeviceID,
      requestID: pairing.requestID,
      expiresAt: new Date(pairing.expiresAt).toISOString(),
    };
  }
}
