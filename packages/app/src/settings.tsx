import * as stylex from "@stylexjs/stylex";
import { Dialog, Icon, IconButton, ListRow, Separator, Text, type Glyph } from "@honk/ui";
import {
  IconBrush,
  IconCrossMedium,
  IconModelcontextprotocol,
  IconPeopleIdCard2,
  IconSettingsGear2,
} from "@honk/ui/icons";
import { borderVars, colorVars, controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { SettingsAppearance } from "./settings-appearance";
import { SettingsGeneral } from "./settings-general";
import { SETTINGS_DIALOG_STYLE, SETTINGS_DIALOG_TITLE_STYLE } from "./settings-layout";
import { SettingsMcp } from "./settings-mcp";
import { SettingsProviders } from "./settings-providers";
import {
  actions as settingsActions,
  useSettingsSelector,
  type SettingsSectionId,
} from "./settings-store";

// Groups are separated by a hairline rule, never by a text label — Cursor's rail has no group
// headings, and the icons plus adjacency already carry the grouping.
type SettingsSection = {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly icon: Glyph;
};

type SettingsGroup = {
  readonly id: string;
  readonly sections: readonly SettingsSection[];
};

const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "preferences",
    sections: [
      { id: "general", label: "General", icon: IconSettingsGear2 },
      { id: "appearance", label: "Appearance", icon: IconBrush },
    ],
  },
  {
    id: "accounts",
    sections: [{ id: "providers", label: "Accounts", icon: IconPeopleIdCard2 }],
  },
  {
    id: "tools",
    sections: [{ id: "tools", label: "MCP servers", icon: IconModelcontextprotocol }],
  },
];

function sectionLabelFor(id: SettingsSectionId): string {
  const sections = SETTINGS_GROUPS.flatMap((group) => group.sections);
  return sections.find((item) => item.id === id)?.label ?? "Settings";
}

const PANELS = {
  general: SettingsGeneral,
  providers: SettingsProviders,
  tools: SettingsMcp,
  appearance: SettingsAppearance,
} satisfies Record<SettingsSectionId, React.ComponentType>;

const SETTINGS_WIDE_MEDIA = "@media (min-width: 720px)";
const SETTINGS_NAV_COMPACT_MAX_HEIGHT = "152px";
const SETTINGS_CLOSE_CLEARANCE = `calc(${spaceVars["--honk-space-panel-pad"]} + ${controlVars["--honk-control-h-md"]} + ${spaceVars["--honk-space-gutter"]})`;
// `.cursor-settings-tab-content{gap:28px}` (`--cursor-spacing-7`): section-to-section rhythm.
const SETTINGS_SECTION_GAP = "28px";
// `.glass-settings-tab{max-width:42.5rem}` — the 680px content column Cursor's React tab shell and
// embedded settings panel both use.
const SETTINGS_CONTENT_MAX_WIDTH = "680px";
// `.cursor-settings-sidebar-cells{gap:1px}`.
const SETTINGS_NAV_ITEM_GAP = "1px";
const styles = stylex.create({
  root: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: {
      default: "column",
      [SETTINGS_WIDE_MEDIA]: "row",
    },
    overflow: "hidden",
  },
  nav: {
    width: {
      default: "100%",
      [SETTINGS_WIDE_MEDIA]: "200px",
    },
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    minHeight: 0,
    maxHeight: {
      default: SETTINGS_NAV_COMPACT_MAX_HEIGHT,
      [SETTINGS_WIDE_MEDIA]: "none",
    },
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  navList: {
    display: "flex",
    flexDirection: {
      default: "row",
      [SETTINGS_WIDE_MEDIA]: "column",
    },
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px nav-row separation is a fixed hairline gap; smallest spacing token is the 8px gutter
    gap: SETTINGS_NAV_ITEM_GAP,
    minHeight: 0,
    flexGrow: {
      default: 0,
      [SETTINGS_WIDE_MEDIA]: 1,
    },
    overflowX: {
      default: "auto",
      [SETTINGS_WIDE_MEDIA]: "visible",
    },
  },
  navGroup: {
    display: {
      default: "contents",
      [SETTINGS_WIDE_MEDIA]: "flex",
    },
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px nav-row separation is a fixed hairline gap; smallest spacing token is the 8px gutter
    gap: SETTINGS_NAV_ITEM_GAP,
  },
  // `<div class="w-full my-2"><hr class=cursor-settings-sidebar-divider>` — full-rail hairline with
  // an 8px block margin, replacing the group headings. The compact rail scrolls horizontally, where
  // a horizontal rule would only add noise.
  navDivider: {
    display: {
      default: "none",
      [SETTINGS_WIDE_MEDIA]: "block",
    },
    width: "100%",
    marginBlock: spaceVars["--honk-space-gutter"],
  },
  close: {
    position: "absolute",
    top: spaceVars["--honk-space-panel-pad"],
    right: spaceVars["--honk-space-panel-pad"],
    zIndex: 1,
  },
  panel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    borderTopWidth: {
      default: borderVars["--honk-border-hairline"],
      [SETTINGS_WIDE_MEDIA]: 0,
    },
    borderTopStyle: "solid",
    borderTopColor: colorVars["--honk-color-border-muted"],
    borderLeftWidth: {
      default: 0,
      [SETTINGS_WIDE_MEDIA]: borderVars["--honk-border-hairline"],
    },
    borderLeftStyle: "solid",
    borderLeftColor: colorVars["--honk-color-border-muted"],
  },
  // The page header stays put while sections switch below it, so the title and close control
  // never jump between panels — Cursor's tab header (`.glass-settings-tab__header`) plays the
  // same anchoring role above the scrolling tab content.
  pageHeader: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // The scroll region below owns the trailing pad instead. A control's ring and shadow paint
    // outside its border box, so the region's first row needs padding above it or the scroll edge
    // cuts them.
    paddingBlockStart: spaceVars["--honk-space-panel-pad"],
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    // In the wide arm the absolute close control overlays the header's end; compact places the
    // close over the nav strip instead, so the header needs no clearance there.
    paddingInlineEnd: {
      default: spaceVars["--honk-space-panel-pad"],
      [SETTINGS_WIDE_MEDIA]: SETTINGS_CLOSE_CLEARANCE,
    },
  },
  panelScroll: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    paddingInlineEnd: {
      default: spaceVars["--honk-space-panel-pad"],
      [SETTINGS_WIDE_MEDIA]: SETTINGS_CLOSE_CLEARANCE,
    },
  },
  panelColumn: {
    width: "100%",
    maxWidth: SETTINGS_CONTENT_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 28px section rhythm is Cursor's tab-content intrinsic; honk's spacing tokens stop at 12px
    gap: SETTINGS_SECTION_GAP,
  },
});

export function SettingsOverlay(): React.ReactElement {
  const open = useSettingsSelector((snapshot) => snapshot.open);
  const section = useSettingsSelector((snapshot) => snapshot.section);
  const activeSectionRef = React.useRef<HTMLButtonElement>(null);
  const Panel = PANELS[section];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) settingsActions.close();
      }}
    >
      <Dialog.Popup style={SETTINGS_DIALOG_STYLE} initialFocus={activeSectionRef}>
        <Dialog.Title style={SETTINGS_DIALOG_TITLE_STYLE}>Settings</Dialog.Title>
        <div {...stylex.props(styles.close)}>
          <Dialog.Close
            render={
              <IconButton size="md" variant="quiet" aria-label="Close settings">
                <Icon icon={IconCrossMedium} size="md" />
              </IconButton>
            }
          />
        </div>

        <div {...stylex.props(styles.root)}>
          <nav {...stylex.props(styles.nav)} aria-label="Settings sections">
            <div {...stylex.props(styles.navList)}>
              {SETTINGS_GROUPS.map((group, groupIndex) => (
                <React.Fragment key={group.id}>
                  {groupIndex === 0 ? null : (
                    <div {...stylex.props(styles.navDivider)}>
                      <Separator />
                    </div>
                  )}
                  <div {...stylex.props(styles.navGroup)}>
                    {group.sections.map((item) => {
                      const active = item.id === section;
                      return (
                        <ListRow
                          key={item.id}
                          {...(active ? { ref: activeSectionRef } : {})}
                          size="menu"
                          isSelected={active}
                          aria-current={active ? "page" : undefined}
                          onClick={() => {
                            settingsActions.setSection(item.id);
                          }}
                        >
                          <ListRow.Slot>
                            {/* The selected row already carries the tint and primary label;
                                tinting its icon too would spend accent on navigation. */}
                            <Icon icon={item.icon} size="sm" tone={active ? "current" : "muted"} />
                          </ListRow.Slot>
                          <ListRow.Title>{item.label}</ListRow.Title>
                        </ListRow>
                      );
                    })}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </nav>

          <div {...stylex.props(styles.panel)}>
            <header {...stylex.props(styles.pageHeader)}>
              {/* Cursor's page title is 17px/21px medium (`.glass-settings-tab__title`); honk's
                  heading token (16px/21px semibold) is the token-mapped equivalent. */}
              <Text as="p" size="xl" weight="semibold">
                {sectionLabelFor(section)}
              </Text>
            </header>
            <div key={section} {...stylex.props(styles.panelScroll)}>
              <div {...stylex.props(styles.panelColumn)}>
                <Panel />
              </div>
            </div>
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
