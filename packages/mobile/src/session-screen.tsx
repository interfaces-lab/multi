import { Session } from "@honk/core/session";
import { Button, Text } from "@honk/ui";
import type { LegendListRef } from "@legendapp/list/react-native";
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from "@legendapp/list/keyboard";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCoreConnection } from "./core-connection";
import { SessionComposer } from "./session-composer";
import { readSessionDraft, writeSessionDraft } from "./session-draft-store";
import {
  clearedMessageOf,
  composerMessageOf,
  initialSessionState,
  mergeRecoveredDraft,
  reduceSession,
  transcriptRows,
  type ComposerMessage,
  type SessionState,
  type TranscriptRow,
} from "./session-model";
import { SessionTranscriptRow } from "./session-transcript-row";
import { useHonkTheme } from "./ui";

const ANCHOR_MAX_SIZE = 160;

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;

const folderName = (directory: string): string =>
  directory
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) ?? directory;

const sameImages = (
  left: readonly Session.PromptImage[],
  right: readonly Session.PromptImage[],
): boolean =>
  left.length === right.length &&
  left.every(
    (image, index) =>
      image.data === right[index]?.data && image.mimeType === right[index]?.mimeType,
  );

const sameMessage = (left: ComposerMessage, right: ComposerMessage): boolean =>
  left.text === right.text && sameImages(left.images, right.images);

const committedCount = (
  entries: readonly Session.SessionTreeEntry[],
  submitted: ComposerMessage,
): number =>
  entries.reduce((count, entry) => {
    if (entry.type !== "message" || entry.message.role !== "user") return count;
    return sameMessage(composerMessageOf(entry.message), submitted) ? count + 1 : count;
  }, 0);

const recoverDraft = (sessionId: string, recovered: ComposerMessage): void => {
  if (recovered.text.length === 0 && recovered.images.length === 0) return;
  writeSessionDraft(
    sessionId,
    mergeRecoveredDraft({ recovered, newer: readSessionDraft(sessionId) }),
  );
};

function StateMessage({
  action,
  detail,
  onAction,
  title,
}: {
  readonly action?: string;
  readonly detail: string;
  readonly onAction?: () => void;
  readonly title: string;
}): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <View
      style={[
        styles.center,
        {
          backgroundColor: theme.colors.bgBase,
          gap: theme.metrics.space.contentGap,
          padding: theme.metrics.space.screenGutter,
        },
      ]}
    >
      <Text size="lg" weight="semibold" align="center">
        {title}
      </Text>
      <Text tone="muted" align="center" selectable>
        {detail}
      </Text>
      <View style={[styles.stateActions, { gap: theme.metrics.space.contentGap }]}>
        {action === undefined || onAction === undefined ? null : (
          <Button variant="primary" onClick={onAction}>
            {action}
          </Button>
        )}
        <Button onClick={() => router.replace("/")}>Home</Button>
      </View>
    </View>
  );
}

function watchFailureMessage(cause: unknown): string {
  return errorMessage(cause, "This session lost its connection to Honk Core.");
}

export function SessionScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const remote = useCoreConnection();
  const sessionIdText = params.sessionId ?? "";
  const sessionId = Session.SessionId.make(sessionIdText);
  const client = remote.client;
  const summary = remote.sessions.find((candidate) => candidate.id === sessionId) ?? null;
  const title = summary?.title ?? (summary === null ? "Session" : folderName(summary.directory));
  const [model, setModel] = React.useState<SessionState>(initialSessionState);
  const modelRef = React.useRef(model);
  modelRef.current = model;
  const [watchAttempt, setWatchAttempt] = React.useState(0);
  const [requestPending, setRequestPending] = React.useState(false);
  const requestPendingRef = React.useRef(false);
  const requestToken = React.useRef(0);
  const [stopPending, setStopPending] = React.useState(false);
  const stopPendingRef = React.useRef(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [anchorIndex, setAnchorIndex] = React.useState<number | undefined>();
  const [following, setFollowing] = React.useState(true);
  const [latestVisible, setLatestVisible] = React.useState(false);
  const [composerHeight, setComposerHeight] = React.useState(120);
  const listRef = React.useRef<LegendListRef>(null);
  const composerRef = React.useRef<View>(null);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerRef,
    composerHeight,
  );

  React.useEffect(() => {
    if (client === null || sessionIdText.length === 0) return;
    let active = true;
    let frameId: number | null = null;
    let pendingEvent: Session.AgentHarnessEvent | null = null;
    const iterable = client.session.watch({ sessionId });
    const iterator = iterable[Symbol.asyncIterator]();

    setModel((current) => reduceSession(current, { type: "attached", sessionId }));
    setRequestError(null);

    const cancelPending = (): void => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      pendingEvent = null;
    };
    const takePending = (): Session.AgentHarnessEvent | null => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      const event = pendingEvent;
      pendingEvent = null;
      return event;
    };
    const flushPending = (): void => {
      frameId = null;
      const event = pendingEvent;
      pendingEvent = null;
      if (!active || event === null) return;
      setModel((current) => reduceSession(current, { type: "event", event }));
    };
    const schedule = (event: Session.AgentHarnessEvent): void => {
      pendingEvent = event;
      if (frameId === null) frameId = requestAnimationFrame(flushPending);
    };

    void (async () => {
      try {
        while (active) {
          const next = await iterator.next();
          if (!active) return;
          if (next.done) {
            cancelPending();
            setModel((current) => reduceSession(current, { type: "stream_ended" }));
            return;
          }
          const frame = next.value;
          if (frame.type === "state") {
            cancelPending();
            setModel((current) =>
              reduceSession(current, {
                type: "state",
                entries: frame.entries,
                phase: frame.phase,
                turns: frame.turns,
              }),
            );
          } else if (
            frame.event.type === "message_update" &&
            frame.event.message.role === "assistant"
          ) {
            schedule(frame.event);
          } else {
            const pending = takePending();
            setModel((current) => {
              const withPending =
                pending === null
                  ? current
                  : reduceSession(current, { type: "event", event: pending });
              return reduceSession(withPending, { type: "event", event: frame.event });
            });
          }
        }
      } catch (cause: unknown) {
        if (active) {
          cancelPending();
          setModel((current) =>
            reduceSession(current, { type: "failed", message: watchFailureMessage(cause) }),
          );
        }
      }
    })();

    return () => {
      active = false;
      cancelPending();
      void iterator.return?.().catch(() => undefined);
    };
  }, [client, sessionId, sessionIdText, watchAttempt]);

  const phase = model.health.type === "live" ? model.health.phase : null;
  React.useEffect(() => {
    if (phase === null || phase === "idle" || !requestPendingRef.current) return;
    requestToken.current += 1;
    requestPendingRef.current = false;
    setRequestPending(false);
  }, [phase]);

  const rows = React.useMemo(() => transcriptRows(model), [model]);
  React.useEffect(() => {
    if (anchorIndex === undefined || anchorIndex >= rows.length) return;
    const frameId = requestAnimationFrame(() => {
      void scrollMessageToEnd({ animated: true, closeKeyboard: false });
    });
    return () => cancelAnimationFrame(frameId);
  }, [anchorIndex, rows.length, scrollMessageToEnd]);

  const send = React.useCallback(
    (submitted: ComposerMessage): void => {
      const current = modelRef.current;
      if (client === null || current.health.type !== "live" || requestPendingRef.current) {
        recoverDraft(sessionIdText, submitted);
        return;
      }
      const running = current.health.phase !== "idle";
      const beforeCount = committedCount(current.entries, submitted);
      if (!running) setAnchorIndex(transcriptRows(current).length);
      setFollowing(true);
      setRequestError(null);
      requestPendingRef.current = true;
      setRequestPending(true);
      const token = ++requestToken.current;
      const request = running
        ? client.session.followUp({ sessionId, text: submitted.text, images: submitted.images })
        : client.session.prompt({ sessionId, text: submitted.text, images: submitted.images });

      void request.then(
        () => {
          if (requestToken.current === token) {
            requestPendingRef.current = false;
            setRequestPending(false);
          }
        },
        async (cause: unknown) => {
          let committed = false;
          let confirmed = true;
          if (!running) {
            try {
              const reloaded = await client.session.reload({ sessionId });
              committed = committedCount(reloaded.entries, submitted) > beforeCount;
            } catch {
              confirmed = false;
            }
          }
          if (!committed) recoverDraft(sessionIdText, submitted);
          if (!committed) setAnchorIndex(undefined);
          setRequestError(
            confirmed
              ? errorMessage(
                  cause,
                  running ? "The follow-up was not queued." : "The message was not sent.",
                )
              : "Honk could not confirm whether the message was sent. Your draft was restored; check the session before sending it again.",
          );
          if (requestToken.current === token) {
            requestPendingRef.current = false;
            setRequestPending(false);
          }
        },
      );
    },
    [client, sessionId, sessionIdText],
  );

  const stop = React.useCallback((): void => {
    if (client === null || stopPendingRef.current || modelRef.current.health.type !== "live")
      return;
    stopPendingRef.current = true;
    setStopPending(true);
    setRequestError(null);
    void client.session.abort({ sessionId }).then(
      (cleared) => {
        recoverDraft(sessionIdText, clearedMessageOf(cleared));
        stopPendingRef.current = false;
        setStopPending(false);
      },
      (cause: unknown) => {
        setRequestError(errorMessage(cause, "The task could not be stopped."));
        stopPendingRef.current = false;
        setStopPending(false);
      },
    );
  }, [client, sessionId, sessionIdText]);

  const onEndVisible = React.useCallback((visible: boolean): void => {
    setLatestVisible(!visible);
    if (visible) setFollowing(true);
  }, []);
  const renderItem = React.useCallback(
    ({ item }: { readonly item: TranscriptRow }): React.ReactElement => (
      <View style={{ paddingBottom: theme.metrics.space.rowGap }}>
        <SessionTranscriptRow row={item} />
      </View>
    ),
    [theme.metrics.space.rowGap],
  );

  if (sessionIdText.length === 0) {
    return <StateMessage detail="This session link is incomplete." title="Session unavailable" />;
  }

  if (client === null) {
    if (remote.status === "restoring" || remote.status === "connecting") {
      return (
        <View style={[styles.center, { backgroundColor: theme.colors.bgBase }]}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text tone="muted">Opening session…</Text>
        </View>
      );
    }
    return (
      <StateMessage
        action={remote.status === "disconnected" ? "Connect" : "Try again"}
        detail={remote.error ?? "Connect to Honk Core to open this session."}
        onAction={() => {
          if (remote.status === "disconnected") router.replace("/connect");
          else void remote.retry();
        }}
        title="Computer unavailable"
      />
    );
  }

  if (
    model.sessionId !== sessionId ||
    (model.health.type === "connecting" && model.entries.length === 0)
  ) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.bgBase }]}>
        <Stack.Title>{title}</Stack.Title>
        <ActivityIndicator color={theme.colors.accent} />
        <Text tone="muted">Opening session…</Text>
      </View>
    );
  }

  if (
    (model.health.type === "failed" || model.health.type === "disconnected") &&
    model.entries.length === 0
  ) {
    return (
      <>
        <Stack.Title>{title}</Stack.Title>
        <StateMessage
          action="Try again"
          detail={
            model.health.type === "failed" ? model.health.message : "The session connection ended."
          }
          onAction={() => setWatchAttempt((attempt) => attempt + 1)}
          title="Session unavailable"
        />
      </>
    );
  }

  const running = phase !== null && phase !== "idle";
  const composerDisabled = model.health.type !== "live";
  const connectionError =
    model.health.type === "failed"
      ? model.health.message
      : model.health.type === "disconnected"
        ? "The session connection ended."
        : model.health.type === "connecting"
          ? "Reconnecting to this session…"
          : null;
  const activeAnchor =
    anchorIndex !== undefined && anchorIndex < rows.length ? anchorIndex : undefined;

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.bgBase }]}>
      <Stack.Title>{title}</Stack.Title>
      <KeyboardAwareLegendList
        alignItemsAtEnd
        applyWorkaroundForContentInsetHitTestBug
        {...(activeAnchor === undefined
          ? {}
          : {
              anchoredEndSpace: {
                anchorIndex: activeAnchor,
                anchorMaxSize: ANCHOR_MAX_SIZE,
                anchorOffset: theme.metrics.space.screenGutter,
                onSizeChanged: (size: number) => {
                  if (size === 0) setAnchorIndex(undefined);
                },
              },
            })}
        contentContainerStyle={{
          paddingHorizontal: theme.metrics.space.screenGutter,
          paddingTop: theme.metrics.space.screenGutter,
        }}
        contentInsetAdjustmentBehavior="automatic"
        contentInsetEndAdjustment={contentInsetEndAdjustment}
        data={rows}
        dataKey={sessionIdText}
        estimatedItemSize={144}
        estimatedListSize={{ height: viewport.height, width: viewport.width }}
        freeze={freeze}
        initialScrollAtEnd
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="whenAtEnd"
        keyboardOffset={insets.bottom}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={[styles.empty, { gap: theme.metrics.space.contentGap }]}>
            <Text weight="semibold">Ready when you are</Text>
            <Text tone="muted" align="center">
              Send the first instruction to start this session.
            </Text>
          </View>
        }
        ListHeaderComponent={
          connectionError === null ? null : (
            <View
              accessibilityRole="alert"
              style={[
                styles.connectionBanner,
                {
                  backgroundColor: theme.colors.warnBg,
                  borderColor: theme.colors.warnBorder,
                  borderRadius: theme.metrics.radius.control,
                  gap: theme.metrics.space.contentGap,
                  marginBottom: theme.metrics.space.rowGap,
                  padding: theme.metrics.space.panelPad,
                },
              ]}
            >
              <Text size="sm" tone="warn" style={styles.bannerText} selectable>
                {connectionError}
              </Text>
              {model.health.type === "connecting" ? (
                <ActivityIndicator color={theme.colors.accent} size="small" />
              ) : (
                <Button size="sm" onClick={() => setWatchAttempt((attempt) => attempt + 1)}>
                  Try again
                </Button>
              )}
            </View>
          )
        }
        {...(following
          ? {
              maintainScrollAtEnd: {
                animated: false,
                on: { dataChange: true, itemLayout: true },
              },
            }
          : {})}
        maintainScrollAtEndThreshold={1}
        {...(Platform.OS === "android"
          ? { maintainVisibleContentPosition: { data: true, size: true } }
          : {})}
        onEndVisible={onEndVisible}
        onScrollBeginDrag={() => setFollowing(false)}
        recycleItems
        ref={listRef}
        renderItem={renderItem}
        style={styles.page}
      />

      {latestVisible ? (
        <KeyboardStickyView
          offset={{ opened: insets.bottom }}
          pointerEvents="box-none"
          style={[
            styles.latest,
            {
              bottom: composerHeight + theme.metrics.space.contentGap,
              right: theme.metrics.space.screenGutter,
            },
          ]}
        >
          <Button
            size="sm"
            onClick={() => {
              setFollowing(true);
              void scrollMessageToEnd({ animated: true, closeKeyboard: false });
            }}
          >
            Latest
          </Button>
        </KeyboardStickyView>
      ) : null}

      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <View
          ref={composerRef}
          onLayout={(event) => {
            onComposerLayout(event);
            setComposerHeight(Math.ceil(event.nativeEvent.layout.height));
          }}
        >
          <SessionComposer
            bottomInset={insets.bottom}
            disabled={composerDisabled}
            error={requestError ?? connectionError}
            onSend={send}
            onStop={stop}
            queue={model.queue}
            requestPending={requestPending}
            running={running}
            sessionId={sessionIdText}
            stopPending={stopPending}
          />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerText: { flex: 1 },
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  connectionBanner: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  empty: { alignItems: "center", justifyContent: "center", minHeight: 320 },
  latest: { alignItems: "flex-end", position: "absolute" },
  page: { flex: 1 },
  stateActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
});
