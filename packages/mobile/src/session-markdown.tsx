import * as React from "react";
import { Linking } from "react-native";
import type { LinkPressEvent, MarkdownStyle } from "react-native-enriched-markdown";
import { StreamdownText } from "react-native-streamdown";

import { useHonkTheme } from "./ui";

const markdownFlags = { latexMath: false };

const openExternalLink = ({ url }: LinkPressEvent): void => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    void Linking.openURL(parsed.toString());
  } catch {
    // Malformed and non-web links stay inert instead of reaching native URL handlers.
  }
};

export const SessionMarkdown = React.memo(function SessionMarkdown({
  markdown,
  streaming = false,
}: {
  readonly markdown: string;
  readonly streaming?: boolean;
}): React.ReactElement {
  const theme = useHonkTheme();
  const markdownStyle = React.useMemo<MarkdownStyle>(() => {
    const body = {
      color: theme.colors.textPrimary,
      fontSize: theme.metrics.font.bodySize,
      lineHeight: theme.metrics.font.bodyLeading,
    };
    const blockSpacing = theme.metrics.space.contentGap;
    const monoFamily = process.env.EXPO_OS === "ios" ? "Menlo" : "monospace";

    return {
      paragraph: { ...body, marginBottom: blockSpacing },
      h1: {
        color: theme.colors.textPrimary,
        fontSize: theme.metrics.font.titleSize,
        fontWeight: theme.metrics.font.weightSemibold,
        lineHeight: theme.metrics.font.titleLeading,
        marginBottom: blockSpacing,
        marginTop: theme.metrics.space.rowGap,
      },
      h2: {
        ...body,
        fontWeight: theme.metrics.font.weightSemibold,
        marginBottom: blockSpacing,
        marginTop: theme.metrics.space.rowGap,
      },
      h3: {
        ...body,
        fontWeight: theme.metrics.font.weightMedium,
        marginBottom: theme.metrics.space.compactGap,
        marginTop: blockSpacing,
      },
      h4: body,
      h5: body,
      h6: body,
      blockquote: {
        ...body,
        backgroundColor: theme.colors.accentSubtle,
        borderColor: theme.colors.accent,
        borderWidth: theme.metrics.field.focusBorderWidth,
        gapWidth: blockSpacing,
        marginBottom: blockSpacing,
      },
      list: {
        ...body,
        bulletColor: theme.colors.textMuted,
        gapWidth: blockSpacing,
        marginBottom: blockSpacing,
        marginLeft: theme.metrics.space.panelPad,
        markerColor: theme.colors.textMuted,
        markerFontWeight: theme.metrics.font.weightMedium,
      },
      codeBlock: {
        backgroundColor: theme.colors.bgDeep,
        borderColor: theme.colors.borderStrong,
        borderRadius: theme.metrics.radius.control,
        borderWidth: theme.metrics.field.borderWidth,
        color: theme.colors.textPrimary,
        fontFamily: monoFamily,
        fontSize: theme.metrics.font.captionSize,
        lineHeight: theme.metrics.font.captionLeading,
        marginBottom: blockSpacing,
        padding: theme.metrics.space.panelPad,
      },
      link: { color: theme.colors.accent, underline: true },
      strong: { color: theme.colors.textPrimary },
      em: { color: theme.colors.textPrimary },
      code: {
        backgroundColor: theme.colors.bgDeep,
        borderColor: theme.colors.borderBase,
        color: theme.colors.textPrimary,
        fontFamily: monoFamily,
        fontSize: theme.metrics.font.captionSize,
      },
      thematicBreak: {
        color: theme.colors.borderStrong,
        height: theme.metrics.field.borderWidth,
        marginBottom: blockSpacing,
        marginTop: blockSpacing,
      },
      table: {
        ...body,
        borderColor: theme.colors.borderStrong,
        borderRadius: theme.metrics.radius.control,
        borderWidth: theme.metrics.field.borderWidth,
        cellPaddingHorizontal: theme.metrics.space.contentGap,
        cellPaddingVertical: theme.metrics.space.compactGap,
        headerBackgroundColor: theme.colors.layer02,
        headerTextColor: theme.colors.textPrimary,
        marginBottom: blockSpacing,
        rowEvenBackgroundColor: theme.colors.layer01,
        rowOddBackgroundColor: theme.colors.bgBase,
      },
      taskList: {
        borderColor: theme.colors.borderStrong,
        checkedColor: theme.colors.accent,
        checkedTextColor: theme.colors.textMuted,
        checkmarkColor: theme.colors.onAccent,
      },
    };
  }, [theme]);

  return (
    <StreamdownText
      flavor="github"
      markdown={markdown}
      markdownStyle={markdownStyle}
      md4cFlags={markdownFlags}
      onLinkPress={openExternalLink}
      selectable
      selectionColor={theme.colors.accentSubtle}
      streamingAnimation={streaming}
    />
  );
});
