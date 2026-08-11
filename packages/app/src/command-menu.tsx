import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Dialog,
  Field,
  Icon,
  IconButton,
  Kbd,
  ListRow,
  Matrix,
  StatusDot,
  Text,
} from "@honk/ui";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import {
  IconChevronLeftMedium,
  IconConsole,
  IconCrossMedium,
  IconEyeOpen,
  IconPlusSmall,
  IconSettingsGear2,
} from "@honk/ui/icons";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import {
  DEVELOPMENT_COMMANDS,
  rankCommandMenuItems,
  selectableItems,
  SHIPPING_COMMANDS,
  statusDotPulse,
  statusDotTone,
  type CommandMenuCommandId,
  type CommandMenuItem,
} from "./command-menu-model";
import {
  actions as menuActions,
  useCommandMenuSelector,
  type CommandMenuDoor,
} from "./command-menu-store";
import { draftKeyOf, writeDraft } from "./chat/composer-store";
import { useInventory } from "./chat/inventory-store";
import { canReplayDesktopSetup } from "./desktop-bridge";
import {
  getPerformanceMonitorVisibility,
  performanceMonitorActions,
  usePerformanceMonitorVisible,
} from "./performance-monitor";
import { ONBOARDING_PATH } from "./onboarding";
import {
  MENU_DIALOG_STYLE,
  MENU_DIALOG_TITLE_STYLE,
  MENU_FIELD_STYLE,
} from "./command-menu-layout";
import { actions as settingsActions } from "./settings-store";

const MENU_DROP_MAX_HEIGHT = "min(420px, 50dvh)";

function availableCommands(monitorVisible: boolean): typeof SHIPPING_COMMANDS {
  if (!import.meta.env.DEV) return SHIPPING_COMMANDS;
  return Object.freeze([
    ...SHIPPING_COMMANDS,
    ...DEVELOPMENT_COMMANDS.filter(
      (command) => command.run !== "replay-onboarding" || canReplayDesktopSetup(),
    ).map((command) => {
      if (command.run !== "toggle-performance-monitor") return command;
      return {
        ...command,
        title: monitorVisible ? "Hide performance monitor" : "Show performance monitor",
      };
    }),
  ]);
}

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  panelInline: {
    gap: spaceVars["--honk-space-gutter"],
  },
  scope: {
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
  hints: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  drop: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px inter-row hairline gutter; smallest spacing token is 8px, no 1px spacing step exists
    gap: "1px",
    width: "100%",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-gutter"],
    backgroundColor: "transparent",
    maxHeight: MENU_DROP_MAX_HEIGHT,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  dropInline: {
    boxShadow: "none",
    backgroundColor: "transparent",
    padding: 0,
    maxHeight: "none",
    overflowY: "visible",
  },
  header: {
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-micro"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  verb: {
    color: colorVars["--honk-color-accent"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  preview: {
    color: colorVars["--honk-color-text-faint"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  empty: {
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
  footer: {
    flexShrink: 0,
    minHeight: controlVars["--honk-control-h-lg"],
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    borderTopWidth: borderVars["--honk-border-hairline"],
    borderTopStyle: "solid",
    borderTopColor: colorVars["--honk-color-border-muted"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  footerHint: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
});

type CommandMenuBodyProps = {
  readonly door: CommandMenuDoor;
  /** Home inline hides Commands at rest and ranks as always focused. */
  readonly variant: "overlay" | "inline";
  /** Overlay only. Dialog owns open; inline ranks as always open. */
  readonly isOpen?: boolean;
  /** Overlay waits for exit before opening Settings so focus traps do not overlap. */
  readonly onSettingsRequest?: () => void;
};

function CommandMenuBody({
  door,
  variant,
  isOpen = true,
  onSettingsRequest,
}: CommandMenuBodyProps): React.ReactElement {
  const query = useCommandMenuSelector((s) => s.query);
  const selectedIndex = useCommandMenuSelector((s) => s.selectedIndex);
  const submenuStack = useCommandMenuSelector((s) => s.submenuStack);
  const threads = useInventory().sessions;
  const monitorVisible = usePerformanceMonitorVisible();
  const navigate = useNavigate();

  const items = rankCommandMenuItems({
    query,
    door,
    threads,
    commands: availableCommands(monitorVisible),
    submenuStack,
    hideCommandsAtRest: variant === "inline",
  });
  const selectable = selectableItems(items);

  // Clamp when the list shrinks (store already resets on query change; this covers thread churn).
  const safeIndex = selectable.length === 0 ? 0 : Math.min(selectedIndex, selectable.length - 1);

  // Focus on mount via callback ref. No useEffect for focus.
  const inputRef = (node: HTMLInputElement | null): void => {
    if (node !== null && isOpen) {
      node.focus();
    }
  };

  const runCommand = (run: CommandMenuCommandId): void => {
    switch (run) {
      case "new-thread": {
        // A new chat is a Honk Core session; the /chat composer reads the
        // module draft store, so the typed query lands in it instead of
        // being dropped with the menu.
        const prompt = query.trim();
        if (prompt.length > 0) writeDraft(draftKeyOf(null), { text: prompt, images: [] });
        menuActions.close();
        menuActions.setQuery("");
        void navigate({ to: "/chat" });
        return;
      }
      case "open-settings":
        if (onSettingsRequest === undefined) {
          menuActions.close();
          settingsActions.open();
        } else {
          onSettingsRequest();
        }
        return;
      case "replay-onboarding":
        menuActions.close();
        menuActions.setQuery("");
        void navigate({ to: ONBOARDING_PATH, search: { replay: true } });
        return;
      case "toggle-performance-monitor":
        performanceMonitorActions.toggle();
        menuActions.close();
        menuActions.setQuery("");
        return;
      default: {
        const _exhaustive: never = run;
        return _exhaustive;
      }
    }
  };

  const activateItem = (item: Exclude<CommandMenuItem, { kind: "header" }>): void => {
    switch (item.kind) {
      case "start-new":
        runCommand("new-thread");
        return;
      case "thread":
        void navigate({ to: "/chat/$sessionId", params: { sessionId: item.sessionId } });
        menuActions.close();
        menuActions.setQuery("");
        return;
      case "command":
        runCommand(item.run);
        return;
      case "submenu":
        menuActions.pushSubmenu(item.frame);
        return;
      default: {
        const _exhaustive: never = item;
        return _exhaustive;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        menuActions.moveSelection(1, selectable.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        menuActions.moveSelection(-1, selectable.length);
        return;
      case "Enter": {
        event.preventDefault();
        const item = selectable[safeIndex];
        if (item !== undefined) {
          activateItem(item);
        } else if (variant === "inline" || door === "command") {
          // Empty list + Enter still starts a new chat.
          runCommand("new-thread");
        }
        return;
      }
      case "Escape":
        event.preventDefault();
        if (submenuStack.length > 0) {
          menuActions.popSubmenu();
          return;
        }
        if (variant === "overlay") {
          menuActions.close();
          return;
        }
        menuActions.setQuery("");
        return;
      case "Backspace":
        if (query.length === 0 && submenuStack.length > 0) {
          event.preventDefault();
          menuActions.popSubmenu();
        }
        return;
      default:
        return;
    }
  };

  const topFrame = submenuStack.length > 0 ? submenuStack[submenuStack.length - 1] : undefined;
  const placeholder =
    topFrame?.placeholder ??
    (door === "threads"
      ? "Search threads…"
      : variant === "inline"
        ? "Ask anything — build, fix, explore…"
        : "Search commands and threads…");

  const showDrop = variant === "overlay" || query.length > 0 || submenuStack.length > 0;

  return (
    <div {...stylex.props(styles.panel, variant === "inline" && styles.panelInline)}>
      <Field size="lg" style={variant === "overlay" ? MENU_FIELD_STYLE : undefined}>
        {submenuStack.length > 0 ? (
          <IconButton
            size="sm"
            variant="quiet"
            aria-label="Back"
            onClick={() => {
              menuActions.popSubmenu();
            }}
          >
            <Icon icon={IconChevronLeftMedium} size="sm" tone="muted" />
          </IconButton>
        ) : (
          <span {...stylex.props(styles.scope)}>{door === "threads" ? "Threads" : "Anywhere"}</span>
        )}
        <Field.Input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          aria-label={door === "threads" ? "Search threads" : "Command menu"}
          aria-autocomplete="list"
          aria-activedescendant={
            selectable[safeIndex] !== undefined
              ? `command-menu-item-${selectable[safeIndex].id}`
              : undefined
          }
          onChange={(event) => {
            menuActions.setQuery(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <span {...stylex.props(styles.hints)}>
          <Kbd size="sm">Tab</Kbd>
          <Text as="span" size="xs" tone="faint">
            where
          </Text>
        </span>
        <Button
          size="sm"
          variant="neutral"
          onClick={() => {
            const item = selectable[safeIndex];
            if (item !== undefined) {
              activateItem(item);
            } else {
              runCommand("new-thread");
            }
          }}
        >
          ⏎ Start
        </Button>
      </Field>

      {showDrop ? (
        <div
          {...stylex.props(styles.drop, variant === "inline" && styles.dropInline)}
          role="listbox"
          aria-label="Command menu results"
        >
          {items.length === 0 ? (
            <div {...stylex.props(styles.empty)}>
              <Text as="p" size="sm" tone="muted">
                {door === "threads" ? "No matching threads." : "No matching commands or threads."}
              </Text>
            </div>
          ) : (
            items.map((item) => {
              if (item.kind === "header") {
                return (
                  <div key={item.id} {...stylex.props(styles.header)}>
                    {item.label}
                  </div>
                );
              }

              const selectIndex = selectable.findIndex((s) => s.id === item.id);
              const isActive = selectIndex === safeIndex;

              return (
                <ListRow
                  key={item.id}
                  id={`command-menu-item-${item.id}`}
                  role="option"
                  aria-selected={isActive}
                  // Combobox: input is the only tab stop; rows highlight via the store.
                  tabIndex={-1}
                  isHighlighted={isActive}
                  onMouseEnter={() => {
                    if (selectIndex >= 0) {
                      menuActions.setSelectedIndex(selectIndex);
                    }
                  }}
                  onClick={() => {
                    activateItem(item);
                  }}
                >
                  <RowLeading item={item} />
                  <ListRow.Content>
                    <ListRow.Title>
                      <RowTitle item={item} />
                    </ListRow.Title>
                  </ListRow.Content>
                  <ListRow.Meta>
                    <RowMeta item={item} isActive={isActive} />
                  </ListRow.Meta>
                </ListRow>
              );
            })
          )}
        </div>
      ) : null}

      {variant === "overlay" ? (
        <div {...stylex.props(styles.footer)} aria-hidden>
          <span {...stylex.props(styles.footerHint)}>
            <Kbd size="sm">↑↓</Kbd>
            <Text as="span" size="xs" tone="faint">
              move
            </Text>
          </span>
          <span {...stylex.props(styles.footerHint)}>
            <Kbd size="sm">⏎</Kbd>
            <Text as="span" size="xs" tone="faint">
              open
            </Text>
          </span>
          <span {...stylex.props(styles.footerHint)}>
            <Kbd size="sm">Esc</Kbd>
            <Text as="span" size="xs" tone="faint">
              close
            </Text>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RowLeading({
  item,
}: {
  item: Exclude<CommandMenuItem, { kind: "header" }>;
}): React.ReactElement {
  switch (item.kind) {
    case "start-new":
      return (
        <ListRow.Slot>
          <Icon icon={IconPlusSmall} size="sm" tone="accent" />
        </ListRow.Slot>
      );
    case "thread":
      return (
        <ListRow.Slot>
          {item.status === "working" ? (
            <Matrix grid={4} isActive />
          ) : (
            <StatusDot tone={statusDotTone(item.status)} pulse={statusDotPulse(item.status)} />
          )}
        </ListRow.Slot>
      );
    case "command":
      return (
        <ListRow.Slot>
          <Icon icon={commandLeadingIcon(item.run)} size="sm" tone="faint" />
        </ListRow.Slot>
      );
    case "submenu":
      return (
        <ListRow.Slot>
          <Icon icon={IconChevronLeftMedium} size="sm" tone="faint" />
        </ListRow.Slot>
      );
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function commandLeadingIcon(run: CommandMenuCommandId) {
  switch (run) {
    case "open-settings":
      return IconSettingsGear2;
    case "replay-onboarding":
      return IconConsole;
    case "toggle-performance-monitor":
      return getPerformanceMonitorVisibility() ? IconCrossMedium : IconEyeOpen;
    case "new-thread":
      return IconPlusSmall;
    default: {
      const _exhaustive: never = run;
      return _exhaustive;
    }
  }
}

function RowTitle({
  item,
}: {
  item: Exclude<CommandMenuItem, { kind: "header" }>;
}): React.ReactElement {
  if (item.kind === "start-new") {
    return (
      <>
        <span {...stylex.props(styles.verb)}>{item.title}</span>
        {item.queryPreview.length > 0 ? (
          <span {...stylex.props(styles.preview)}> — &ldquo;{item.queryPreview}&rdquo;</span>
        ) : null}
      </>
    );
  }
  return <>{item.title}</>;
}

function RowMeta({
  item,
  isActive,
}: {
  item: Exclude<CommandMenuItem, { kind: "header" }>;
  isActive: boolean;
}): React.ReactNode {
  if (item.kind === "start-new" && isActive) {
    return <Kbd size="sm">⏎</Kbd>;
  }
  if (item.kind === "command" && item.shortcut !== undefined) {
    return <Kbd size="sm">{item.shortcut}</Kbd>;
  }
  return null;
}

function CommandMenuOverlay(): React.ReactElement {
  const open = useCommandMenuSelector((s) => s.open);
  const door = useCommandMenuSelector((s) => s.door);
  // Wait for this dialog to dismiss before opening Settings so focus traps do not overlap.
  const openSettingsAfterCloseRef = React.useRef(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          menuActions.close();
        }
      }}
      onOpenChangeComplete={(next) => {
        if (next) {
          openSettingsAfterCloseRef.current = false;
          return;
        }
        if (openSettingsAfterCloseRef.current) {
          openSettingsAfterCloseRef.current = false;
          settingsActions.open();
        }
      }}
    >
      <Dialog.Popup style={MENU_DIALOG_STYLE}>
        {/* Omnibox is the visible label. Title stays for a11y. */}
        <Dialog.Title style={MENU_DIALOG_TITLE_STYLE}>
          {door === "threads" ? "Open thread" : "Command menu"}
        </Dialog.Title>
        <CommandMenuBody
          door={door}
          variant="overlay"
          isOpen={open}
          onSettingsRequest={() => {
            openSettingsAfterCloseRef.current = true;
            menuActions.close();
          }}
        />
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function CommandMenuInline(): React.ReactElement {
  return <CommandMenuBody door="command" variant="inline" isOpen />;
}

export { CommandMenuInline, CommandMenuOverlay };
