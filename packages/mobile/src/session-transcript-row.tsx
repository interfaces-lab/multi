import { Text } from "@honk/ui";
import * as React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import type { TranscriptRow } from "./session-model";
import { SessionMarkdown } from "./session-markdown";
import { useHonkTheme } from "./ui";

const imageLabel = (count: number): string => `${count} ${count === 1 ? "image" : "images"}`;

function Row({ row }: { readonly row: TranscriptRow }): React.ReactElement {
  const theme = useHonkTheme();

  if (row.kind === "user") {
    return (
      <View
        style={[
          styles.user,
          {
            backgroundColor: theme.colors.messageBubbleBg,
            borderRadius: theme.metrics.radius.bubble,
            gap: theme.metrics.space.compactGap,
            padding: theme.metrics.space.panelPad,
          },
        ]}
      >
        {row.text.length === 0 ? null : <Text selectable>{row.text}</Text>}
        {row.imageCount === 0 ? null : (
          <Text size="sm" tone="muted">
            {imageLabel(row.imageCount)}
          </Text>
        )}
      </View>
    );
  }

  if (row.kind === "working") {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={[styles.status, { gap: theme.metrics.space.contentGap }]}
      >
        <ActivityIndicator color={theme.colors.accent} size="small" />
        <Text size="sm" tone="muted">
          Working…
        </Text>
      </View>
    );
  }

  const live = row.source === "live";
  const outcome = row.source === "committed" ? row.outcome : null;
  return (
    <View
      accessibilityLiveRegion={live ? "polite" : "none"}
      style={{ gap: theme.metrics.space.contentGap }}
    >
      {row.text.length === 0 ? null : <SessionMarkdown markdown={row.text} streaming={live} />}
      {outcome?.type === "stopped" ? (
        <Text size="sm" tone="muted">
          Stopped
        </Text>
      ) : outcome?.type === "failed" ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.failure,
            {
              backgroundColor: theme.colors.errBg,
              borderColor: theme.colors.errBorder,
              borderRadius: theme.metrics.radius.control,
              gap: theme.metrics.space.compactGap,
              padding: theme.metrics.space.panelPad,
            },
          ]}
        >
          <Text size="sm" tone="err" weight="semibold">
            Failed
          </Text>
          <Text size="sm" tone="err" selectable>
            {outcome.message}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const sameOutcome = (
  left: Extract<TranscriptRow, { readonly kind: "assistant" }>,
  right: Extract<TranscriptRow, { readonly kind: "assistant" }>,
): boolean => {
  if (left.source !== right.source) return false;
  if (left.source === "live" || right.source === "live") return true;
  if (left.outcome.type !== right.outcome.type) return false;
  return (
    left.outcome.type !== "failed" ||
    right.outcome.type !== "failed" ||
    left.outcome.message === right.outcome.message
  );
};

const sameRow = (left: TranscriptRow, right: TranscriptRow): boolean => {
  if (left.kind !== right.kind || left.id !== right.id) return false;
  if (left.kind === "working" || right.kind === "working") {
    return left.kind === "working" && right.kind === "working" && left.phase === right.phase;
  }
  if (left.kind === "user" || right.kind === "user") {
    return (
      left.kind === "user" &&
      right.kind === "user" &&
      left.text === right.text &&
      left.imageCount === right.imageCount
    );
  }
  return left.text === right.text && sameOutcome(left, right);
};

export const SessionTranscriptRow = React.memo(Row, (previous, next) =>
  sameRow(previous.row, next.row),
);

const styles = StyleSheet.create({
  failure: { borderWidth: StyleSheet.hairlineWidth },
  status: { alignItems: "center", flexDirection: "row" },
  user: { alignSelf: "flex-end", maxWidth: "88%" },
});
