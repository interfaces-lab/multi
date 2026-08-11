// The queued-messages tray, on the released tray chrome (f3965987e
// composer/queue-tray.tsx). Read-only on purpose: the rows are Pi's own
// queue replayed through `queue_update` frames, Pi clears whole buckets
// only, and the recall affordance is Stop — aborting restores every queued
// word to the editor. No per-row edit, remove, or reorder.

import { Icon, IconButton, Text, Tray } from "@honk/ui";
import { IconChevronDownMedium } from "@honk/ui/icons";
import { controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { QueueSnapshot } from "./chat-model";
import type { ComposerMessage } from "./composer-store";
import { MessageImages } from "./message-images";

// The release's tray bound: enough for a handful of rows, scroll past that.
const QUEUE_TRAY_MAX_HEIGHT = 200;

const styles = stylex.create({
  trayHost: {
    width: "100%",
    minHeight: 0,
    display: "flex",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    width: "100%",
  },
  headerSpacer: { flexGrow: 1 },
  list: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px keeps adjacent rows' backgrounds from fusing, Cursor's fixed queue-list gap; no gap token owns a hairline
    gap: "1px",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  row: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // Cursor bleeds the state surface halfway into the tray's 12px content inset while
    // restoring that 6px on the row itself, so text stays aligned without a full-width slab.
    marginInline: `calc(0px - ${controlVars["--honk-control-gap"]})`,
    paddingInline: controlVars["--honk-control-gap"],
    width: `calc(100% + ${controlVars["--honk-control-gap"]} + ${controlVars["--honk-control-gap"]})`,
    minHeight: controlVars["--honk-control-h-md"],
    borderRadius: radiusVars["--honk-radius-control"],
  },
});

// Plain object: the @honk/ui `style` hatch merges inline CSS, not StyleX styles.
const ROW_LABEL_STYLE: React.CSSProperties = {
  display: "block",
  flexBasis: 0,
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
};

const QUEUE_BUCKETS: readonly (keyof QueueSnapshot)[] = ["steer", "followUp", "nextTurn"];

// Delivery order is the row order: steers land at the next loop boundary,
// follow-ups after the run, next-turn messages after that.
const queueRows = (
  queue: QueueSnapshot,
): readonly { readonly key: string; readonly message: ComposerMessage }[] =>
  QUEUE_BUCKETS.flatMap((bucket) =>
    queue[bucket].map((message, index) => ({ key: `${bucket}:${String(index)}`, message })),
  );

export function ComposerQueueTray({
  queue,
}: {
  readonly queue: QueueSnapshot;
}): React.ReactElement | null {
  const [collapsed, setCollapsed] = React.useState(false);
  const rows = queueRows(queue);
  if (rows.length === 0) return null;

  return (
    <div {...stylex.props(styles.trayHost)}>
      <Tray aria-label="Queued messages" maxHeight={QUEUE_TRAY_MAX_HEIGHT}>
        <Tray.Header rowsExpanded={!collapsed}>
          <div {...stylex.props(styles.header)}>
            <Text size="base" tone="muted" tabularNums>
              {rows.length} Queued
            </Text>
            <span {...stylex.props(styles.headerSpacer)} />
            <IconButton
              aria-label={collapsed ? "Expand queue" : "Collapse queue"}
              aria-expanded={!collapsed}
              variant="quiet"
              size="sm"
              onClick={() => {
                setCollapsed((current) => !current);
              }}
            >
              <Icon
                icon={IconChevronDownMedium}
                size="sm"
                style={collapsed ? { transform: "rotate(180deg)" } : undefined}
              />
            </IconButton>
          </div>
        </Tray.Header>
        {collapsed ? null : (
          <Tray.ScrollArea aria-label="Queued messages">
            <ul {...stylex.props(styles.list)}>
              {rows.map((row) => (
                <li key={row.key} {...stylex.props(styles.row)}>
                  <MessageImages images={row.message.images} />
                  {row.message.text.length === 0 ? null : (
                    <Text size="base" truncate style={ROW_LABEL_STYLE} title={row.message.text}>
                      {row.message.text}
                    </Text>
                  )}
                </li>
              ))}
            </ul>
          </Tray.ScrollArea>
        )}
      </Tray>
    </div>
  );
}
