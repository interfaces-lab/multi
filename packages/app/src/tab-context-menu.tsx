// Right-click chrome for the tab strip, loaded lazily from the shell.
// "New thread" opens the start page for every tab: core has no draft concept,
// so a workspace-preselected new thread is not reproducible yet.

import { ContextMenu, Icon, type TabDescriptor } from "@honk/ui";
import { IconClipboard, IconCrossSmall, IconPlusSmall } from "@honk/ui/icons";
import * as React from "react";

import { errorMessage } from "./error-message";
import { actions as tabActions } from "./tab-store";
import { actions as toastActions } from "./toast-store";

function copyWorkspacePath(path: string): void {
  void navigator.clipboard.writeText(path).then(
    () => {
      toastActions.add({ type: "success", title: "Copied workspace path" });
    },
    (error: unknown) => {
      toastActions.add({
        type: "error",
        title: "Could not copy workspace path",
        description: errorMessage(error),
      });
    },
  );
}

export function TabContextMenu(props: {
  readonly tab: TabDescriptor;
  readonly children: React.ReactElement;
}): React.ReactElement {
  const path = props.tab.kind === "home" ? undefined : props.tab.path;
  const canClose = props.tab.kind !== "home";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={props.children} />
      <ContextMenu.Popup>
        <ContextMenu.Item
          onClick={() => {
            tabActions.openNew();
          }}
        >
          <ContextMenu.ItemIcon>
            <Icon icon={IconPlusSmall} size="sm" tone="muted" />
          </ContextMenu.ItemIcon>
          New thread
        </ContextMenu.Item>
        {path === undefined ? null : (
          <ContextMenu.Item
            onClick={() => {
              copyWorkspacePath(path);
            }}
          >
            <ContextMenu.ItemIcon>
              <Icon icon={IconClipboard} size="sm" tone="muted" />
            </ContextMenu.ItemIcon>
            Copy workspace path
          </ContextMenu.Item>
        )}
        {canClose ? (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item
              onClick={() => {
                tabActions.close(props.tab.key);
              }}
            >
              <ContextMenu.ItemIcon>
                <Icon icon={IconCrossSmall} size="sm" tone="muted" />
              </ContextMenu.ItemIcon>
              Close tab
            </ContextMenu.Item>
            {path === undefined ? null : (
              <ContextMenu.Item
                onClick={() => {
                  tabActions.closeWorkspaceTabs(props.tab.key);
                }}
              >
                <ContextMenu.ItemIcon>
                  <Icon icon={IconCrossSmall} size="sm" tone="muted" />
                </ContextMenu.ItemIcon>
                Close workspace tabs
              </ContextMenu.Item>
            )}
          </>
        ) : null}
      </ContextMenu.Popup>
    </ContextMenu.Root>
  );
}
