// Shared inline states for settings panels. Data loading belongs to each
// core-backed panel; these components only standardize presentation.

import * as stylex from "@stylexjs/stylex";
import { Button, Text } from "@honk/ui";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

const styles = stylex.create({
  note: {
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBlock: spaceVars["--honk-space-gutter"],
  },
  failure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBlock: spaceVars["--honk-space-gutter"],
  },
});

export function SettingsNote(props: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div {...stylex.props(styles.note)}>
      <Text as="p" size="sm" tone="muted">
        {props.children}
      </Text>
    </div>
  );
}

export function SettingsStatus(props: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div role="status" aria-live="polite" {...stylex.props(styles.note)}>
      <Text as="p" size="sm" tone="muted">
        {props.children}
      </Text>
    </div>
  );
}

export function SettingsAlert(props: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div {...stylex.props(styles.note)}>
      <Text as="p" role="alert" size="sm" tone="err">
        {props.children}
      </Text>
    </div>
  );
}

export function SettingsFailure(props: {
  readonly message: string;
  readonly onRetry: () => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.failure)}>
      <Text as="p" role="alert" size="sm" tone="err">
        {props.message}
      </Text>
      <Button size="sm" variant="neutral" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}
