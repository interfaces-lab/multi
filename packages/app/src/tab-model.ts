// Pure transitions for the titlebar tab strip. Tabs project core SessionIds;
// Home is `activeId === null`, rendered at slot 0 by the presentation and
// never stored here. Persistence is per-item tolerant: a malformed entry
// drops alone, never the whole window's tabs.

import { Option, Schema } from "effect";

import { Session } from "@honk/core/session";

export const TAB_SCHEMA = "honk.window-tabs";
export const TAB_VERSION = 1;
export const CLOSED_TAB_LIMIT = 25;

export interface ClosedTab {
  readonly id: Session.SessionId;
  readonly index: number;
}

export interface TabState {
  readonly schema: "honk.window-tabs";
  readonly version: 1;
  readonly tabs: readonly Session.SessionId[];
  /** `null` selects Home. */
  readonly activeId: Session.SessionId | null;
  /** Remembered workspace directory per open tab, so relaunch paints real titles. */
  readonly info: Readonly<Record<string, { readonly directory: string }>>;
  readonly closed: readonly ClosedTab[];
}

const freeze = (state: Omit<TabState, "schema" | "version">): TabState =>
  Object.freeze({
    schema: TAB_SCHEMA,
    version: TAB_VERSION,
    tabs: Object.freeze([...state.tabs]),
    activeId: state.activeId,
    info: Object.freeze({ ...state.info }),
    closed: Object.freeze([...state.closed]),
  });

export const createTabState = (): TabState =>
  freeze({ tabs: [], activeId: null, info: {}, closed: [] });

export const openTab = (
  state: TabState,
  id: Session.SessionId,
  options?: { readonly activate?: boolean },
): TabState => {
  const activate = options?.activate !== false;
  if (state.tabs.includes(id)) return activate ? selectTab(state, id) : state;
  return freeze({
    ...state,
    tabs: [...state.tabs, id],
    activeId: activate ? id : state.activeId,
  });
};

export const selectTab = (state: TabState, id: Session.SessionId): TabState => {
  if (!state.tabs.includes(id) || state.activeId === id) return state;
  return freeze({ ...state, activeId: id });
};

export const showHome = (state: TabState): TabState =>
  state.activeId === null ? state : freeze({ ...state, activeId: null });

export const reorderTabs = (state: TabState, ids: readonly Session.SessionId[]): TabState => {
  if (ids.length !== state.tabs.length) return state;
  const seen = new Set<Session.SessionId>();
  for (const id of ids) {
    if (!state.tabs.includes(id) || seen.has(id)) return state;
    seen.add(id);
  }
  if (ids.every((id, index) => id === state.tabs[index])) return state;
  return freeze({ ...state, tabs: ids });
};

const neighborAfterRemoval = (
  tabs: readonly Session.SessionId[],
  index: number,
  removed: ReadonlySet<Session.SessionId>,
): Session.SessionId | null => {
  for (let candidate = index + 1; candidate < tabs.length; candidate += 1) {
    const id = tabs[candidate];
    if (id !== undefined && !removed.has(id)) return id;
  }
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const id = tabs[candidate];
    if (id !== undefined && !removed.has(id)) return id;
  }
  return null;
};

const pruneInfo = (
  info: TabState["info"],
  tabs: readonly Session.SessionId[],
): TabState["info"] => {
  const retained = new Set<string>(tabs);
  if (Object.keys(info).every((key) => retained.has(key))) return info;
  const next: Record<string, { readonly directory: string }> = {};
  for (const [key, value] of Object.entries(info)) {
    if (retained.has(key)) next[key] = value;
  }
  return next;
};

export const closeTab = (state: TabState, id: Session.SessionId): TabState => {
  const index = state.tabs.indexOf(id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((candidate) => candidate !== id);
  const fallback = neighborAfterRemoval(state.tabs, index, new Set([id]));
  return freeze({
    ...state,
    tabs,
    activeId: state.activeId === id ? fallback : state.activeId,
    info: pruneInfo(state.info, tabs),
    closed: [...state.closed, Object.freeze({ id, index })].slice(-CLOSED_TAB_LIMIT),
  });
};

export const reopenClosedTab = (state: TabState): TabState => {
  const closed = [...state.closed];
  const open = new Set(state.tabs);
  let entry: ClosedTab | undefined;
  while (closed.length > 0) {
    const candidate = closed.pop();
    if (candidate !== undefined && !open.has(candidate.id)) {
      entry = candidate;
      break;
    }
  }
  if (entry === undefined) {
    // Stale entries were consumed even when nothing reopened.
    return closed.length === state.closed.length ? state : freeze({ ...state, closed });
  }
  const tabs = [...state.tabs];
  tabs.splice(Math.min(Math.max(entry.index, 0), tabs.length), 0, entry.id);
  return freeze({ ...state, tabs, activeId: entry.id, closed });
};

/** The reconciliation primitive: drops matching tabs and closed entries. */
export const removeSessions = (state: TabState, ids: readonly Session.SessionId[]): TabState => {
  const removed = new Set(ids.filter((id) => state.tabs.includes(id)));
  const closed = state.closed.filter((entry) => !ids.includes(entry.id));
  if (removed.size === 0 && closed.length === state.closed.length) return state;
  const tabs = state.tabs.filter((id) => !removed.has(id));
  const activeId =
    state.activeId !== null && removed.has(state.activeId)
      ? neighborAfterRemoval(state.tabs, state.tabs.indexOf(state.activeId), removed)
      : state.activeId;
  return freeze({ ...state, tabs, activeId, info: pruneInfo(state.info, tabs), closed });
};

export const rememberDirectory = (
  state: TabState,
  id: Session.SessionId,
  directory: string,
): TabState => {
  if (!state.tabs.includes(id) || state.info[id]?.directory === directory) return state;
  return freeze({ ...state, info: { ...state.info, [id]: { directory } } });
};

export const serializeTabState = (state: TabState): string => JSON.stringify(state);

const PersistedEnvelope = Schema.Struct({
  schema: Schema.Literal(TAB_SCHEMA),
  version: Schema.Literal(TAB_VERSION),
  tabs: Schema.Array(Schema.Unknown),
  activeId: Schema.optional(Schema.Unknown),
  info: Schema.Record(Schema.String, Schema.Unknown),
  closed: Schema.Array(Schema.Unknown),
});
const decodeEnvelope = Schema.decodeUnknownOption(PersistedEnvelope);
const decodeInfo = Schema.decodeUnknownOption(Schema.Struct({ directory: Schema.String }));
const decodeClosed = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.String, index: Schema.Int }),
);
const decodeNonEmptyString = Schema.decodeUnknownOption(Schema.NonEmptyString);

const parseId = (value: unknown): Session.SessionId | null =>
  Option.match(decodeNonEmptyString(value), {
    onNone: () => null,
    onSome: (id) => Session.SessionId.make(id),
  });

export const hydrateTabState = (raw: string | null): TabState => {
  if (raw === null) return createTabState();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return createTabState();
  }
  const envelope = Option.getOrNull(decodeEnvelope(value));
  if (envelope === null) return createTabState();

  const tabs: Session.SessionId[] = [];
  for (const candidate of envelope.tabs) {
    const id = parseId(candidate);
    if (id !== null && !tabs.includes(id)) tabs.push(id);
  }
  const open = new Set<string>(tabs);
  const info: Record<string, { readonly directory: string }> = {};
  for (const [key, candidate] of Object.entries(envelope.info)) {
    if (!open.has(key)) continue;
    const parsed = Option.getOrNull(decodeInfo(candidate));
    if (parsed !== null && parsed.directory.length > 0) {
      info[key] = { directory: parsed.directory };
    }
  }
  const closed = envelope.closed
    .flatMap((candidate): ClosedTab[] => {
      const entry = Option.getOrNull(decodeClosed(candidate));
      if (entry === null) return [];
      const id = parseId(entry.id);
      return id === null ? [] : [Object.freeze({ id, index: Math.max(0, entry.index) })];
    })
    .slice(-CLOSED_TAB_LIMIT);
  const active = parseId(envelope.activeId);
  return freeze({
    tabs,
    activeId: active !== null && open.has(active) ? active : null,
    info,
    closed,
  });
};
