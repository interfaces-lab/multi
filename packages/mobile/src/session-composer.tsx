import { Button, Text } from "@honk/ui";
import * as React from "react";
import { StyleSheet, TextInput, View } from "react-native";

import type { ComposerMessage, QueueSnapshot } from "./session-model";
import { EMPTY_SESSION_DRAFT, useSessionDraft } from "./session-draft-store";
import { useHonkTheme } from "./ui";

interface QueuedItem extends ComposerMessage {
  readonly id: string;
}

const queueBuckets: readonly (keyof QueueSnapshot)[] = ["steer", "followUp", "nextTurn"];

const queueItemsOf = (queue: QueueSnapshot): readonly QueuedItem[] =>
  queueBuckets.flatMap((bucket) =>
    queue[bucket].map((message, index) => ({ ...message, id: `${bucket}:${index}` })),
  );

const summaryOf = (message: ComposerMessage): string => {
  if (message.text.length > 0) return message.text.replace(/\s+/g, " ");
  const count = message.images.length;
  return `${count} queued ${count === 1 ? "image" : "images"}`;
};

interface SessionComposerProps {
  readonly bottomInset: number;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onSend: (message: ComposerMessage) => void;
  readonly onStop: () => void;
  readonly requestPending: boolean;
  readonly queue: QueueSnapshot;
  readonly running: boolean;
  readonly sessionId: string;
  readonly stopPending: boolean;
}

export const SessionComposer = React.memo(function SessionComposer({
  bottomInset,
  disabled,
  error,
  onSend,
  onStop,
  requestPending,
  queue,
  running,
  sessionId,
  stopPending,
}: SessionComposerProps): React.ReactElement {
  const theme = useHonkTheme();
  const [draft, setDraft] = useSessionDraft(sessionId);
  const queued = React.useMemo(() => queueItemsOf(queue), [queue]);
  const canSend = draft.text.length > 0 || draft.images.length > 0;
  const inactive = disabled || requestPending;
  const send = (): void => {
    if (!canSend || inactive) return;
    const submitted = { text: draft.text, images: [...draft.images] };
    setDraft(EMPTY_SESSION_DRAFT);
    onSend(submitted);
  };

  return (
    <View
      style={{
        paddingBottom: Math.max(theme.metrics.space.contentGap, bottomInset),
        paddingHorizontal: theme.metrics.space.screenGutter,
        paddingTop: theme.metrics.space.contentGap,
      }}
    >
      <View
        style={[
          styles.surface,
          {
            backgroundColor: theme.colors.layer01,
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.metrics.radius.panel,
            gap: theme.metrics.space.contentGap,
            padding: theme.metrics.space.contentGap,
          },
        ]}
      >
        {queued.length === 0 ? null : (
          <View
            accessibilityLabel={`${queued.length} queued`}
            style={{ gap: theme.metrics.space.compactGap }}
          >
            <Text size="xs" tone="muted" weight="semibold">
              QUEUED
            </Text>
            {queued.slice(0, 3).map((item) => (
              <Text key={item.id} size="sm" tone="muted" numberOfLines={1}>
                {summaryOf(item)}
              </Text>
            ))}
            {queued.length <= 3 ? null : (
              <Text size="xs" tone="faint">
                {queued.length - 3} more
              </Text>
            )}
          </View>
        )}

        {draft.images.length === 0 ? null : (
          <View style={[styles.imageDraft, { gap: theme.metrics.space.contentGap }]}>
            <Text size="sm" tone="muted">
              {draft.images.length} {draft.images.length === 1 ? "image" : "images"} attached
            </Text>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setDraft({ text: draft.text, images: [] })}
            >
              Remove
            </Button>
          </View>
        )}

        <View style={[styles.inputRow, { gap: theme.metrics.space.contentGap }]}>
          <TextInput
            accessibilityLabel="Message"
            allowFontScaling
            autoCapitalize="sentences"
            editable={!disabled}
            keyboardAppearance={theme.mode}
            multiline
            onChangeText={(text) => setDraft({ text, images: draft.images })}
            onSubmitEditing={send}
            placeholder={running ? "Add the next instruction" : "Ask Honk"}
            placeholderTextColor={theme.colors.textMuted}
            returnKeyType="send"
            selectionColor={theme.colors.accent}
            style={[
              styles.input,
              {
                color: theme.colors.textPrimary,
                fontSize: theme.metrics.font.bodySize,
                lineHeight: theme.metrics.font.bodyLeading,
                maxHeight: theme.metrics.font.bodyLeading * 6,
                minHeight: theme.metrics.interaction.touchTarget,
              },
            ]}
            submitBehavior="submit"
            value={draft.text}
          />
          {running ? (
            <Button
              accessibilityLabel="Stop current task"
              disabled={disabled}
              isPending={stopPending}
              onClick={onStop}
              size="sm"
              variant="destructive"
            >
              Stop
            </Button>
          ) : null}
          <Button
            disabled={!canSend || inactive}
            isPending={requestPending}
            onClick={send}
            size="sm"
            variant="primary"
          >
            {running ? "Queue" : "Send"}
          </Button>
        </View>
        {error === null ? null : (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            size="sm"
            tone="err"
            selectable
          >
            {error}
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  imageDraft: { alignItems: "center", flexDirection: "row" },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  inputRow: { alignItems: "flex-end", flexDirection: "row" },
  surface: { borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
});
