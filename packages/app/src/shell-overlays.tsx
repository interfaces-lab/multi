import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, Field, Kbd, Text } from "@honk/ui";
import { useNavigate } from "@tanstack/react-router";
import {
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import {
  MENU_DIALOG_STYLE,
  MENU_DIALOG_TITLE_STYLE,
  MENU_FIELD_STYLE,
} from "./command-menu-layout";
import { actions as commandMenuActions, useCommandMenuSelector } from "./command-menu-store";
import { SettingsOverlay } from "./settings";
import { useSettingsSelector } from "./settings-store";
import { draftKeyOf, writeDraft } from "./chat/composer-store";

const DeferredCommandMenuOverlay = React.lazy(() =>
  import("./command-menu").then((module) => ({ default: module.CommandMenuOverlay })),
);

const COMMAND_SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth"];
const MENU_DROP_MAX_HEIGHT = "min(420px, 50dvh)";

const styles = stylex.create({
  commandPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  commandScope: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    whiteSpace: "nowrap",
  },
  commandHints: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  commandDrop: {
    display: "flex",
    flexDirection: "column",
    // Matches the command menu's one-pixel inter-row seam.
    // oxlint-disable-next-line honk/design-no-raw-values -- command result rows use a fixed one-pixel seam; no spacing token owns it
    gap: "1px",
    width: "100%",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-gutter"],
    backgroundColor: "transparent",
    maxHeight: MENU_DROP_MAX_HEIGHT,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  commandRow: {
    minHeight: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-pad-md"],
    paddingBlock: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-control"],
  },
  commandGlyph: {
    width: iconVars["--honk-icon-size-md"],
    height: iconVars["--honk-icon-size-md"],
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  commandLine: {
    width: "55%",
    height: fontVars["--honk-leading-title"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  commandMeta: {
    width: "15%",
    height: fontVars["--honk-leading-detail"],
    marginInlineStart: "auto",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
});

function CommandMenuOverlayHost(): React.ReactElement | null {
  const open = useCommandMenuSelector((snapshot) => snapshot.open);
  if (!open) return null;
  return (
    <React.Suspense fallback={<CommandMenuLoadingOverlay />}>
      <DeferredCommandMenuOverlay />
    </React.Suspense>
  );
}

function CommandMenuLoadingOverlay(): React.ReactElement {
  const door = useCommandMenuSelector((snapshot) => snapshot.door);
  const query = useCommandMenuSelector((snapshot) => snapshot.query);
  const navigate = useNavigate();
  const label = door === "threads" ? "Open thread" : "Command menu";
  // Same start behavior as the loaded menu's new-thread command: seed the /chat
  // composer's draft with the typed prompt, then navigate. The fallback must not
  // fork on chunk-load timing.
  const start = (): void => {
    const prompt = query.trim();
    if (prompt.length > 0) writeDraft(draftKeyOf(null), { text: prompt, images: [] });
    commandMenuActions.close();
    commandMenuActions.setQuery("");
    void navigate({ to: "/chat" });
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) commandMenuActions.close();
      }}
    >
      <Dialog.Popup style={MENU_DIALOG_STYLE}>
        <Dialog.Title style={MENU_DIALOG_TITLE_STYLE}>{label}</Dialog.Title>
        <div {...stylex.props(styles.commandPanel)}>
          <Field size="lg" style={MENU_FIELD_STYLE}>
            <span {...stylex.props(styles.commandScope)}>
              {door === "threads" ? "Threads" : "Anywhere"}
            </span>
            <Field.Input
              value={query}
              placeholder={door === "threads" ? "Search threads…" : "Search commands and threads…"}
              aria-label={door === "threads" ? "Search threads" : "Command menu"}
              onChange={(event) => {
                commandMenuActions.setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  start();
                }
              }}
            />
            <span {...stylex.props(styles.commandHints)}>
              <Kbd size="sm">Tab</Kbd>
              <Text as="span" size="xs" tone="faint">
                where
              </Text>
            </span>
            <Button size="sm" variant="neutral" onClick={start}>
              ⏎ Start
            </Button>
          </Field>
          <div
            role="status"
            aria-label={`Loading ${label.toLocaleLowerCase()}`}
            {...stylex.props(styles.commandDrop)}
          >
            {COMMAND_SKELETON_ROWS.map((row) => (
              <div key={row} aria-hidden="true" {...stylex.props(styles.commandRow)}>
                <div {...stylex.props(styles.commandGlyph)} />
                <div {...stylex.props(styles.commandLine)} />
                <div {...stylex.props(styles.commandMeta)} />
              </div>
            ))}
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function SettingsOverlayHost(): React.ReactElement | null {
  const open = useSettingsSelector((snapshot) => snapshot.open);
  if (!open) return null;
  return <SettingsOverlay />;
}

export { CommandMenuOverlayHost, SettingsOverlayHost };
