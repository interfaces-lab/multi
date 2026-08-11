/// <reference types="vite/client" />

import "dialkit/styles.css";

import * as stylex from "@stylexjs/stylex";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { DialRoot } from "dialkit";
import * as React from "react";
import { createRoot } from "react-dom/client";

import {
  AlertDialog,
  AnchoredTooltip,
  Badge,
  Button,
  ChangeReceipt,
  Checkbox,
  Combobox,
  Dialog,
  Icon,
  IconButton,
  Kbd,
  ListRow,
  Matrix,
  Menu,
  Picker,
  Pill,
  Popover,
  Prose,
  SegmentedControl,
  Separator,
  Shell,
  Spinner,
  StatusDot,
  StatusRow,
  Switch,
  TabStrip,
  Text,
  Toaster,
  Tooltip,
  TooltipProvider,
  ToolCallLine,
  UserMessage,
  WorkGroup,
  toast,
} from "../src";
import type { IconSize, IconTone, TabDescriptor, TextSize, TextTone, TextWeight } from "../src";
import {
  ICON_CATALOG,
  IconCircleCheck,
  IconConsole,
  IconCrossSmall,
  IconEyeOpen,
  IconFolder1,
  IconFolderOpen,
  IconMagnifyingGlass,
} from "../src/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  shellVars,
  spaceVars,
} from "../src/tokens.stylex";
import {
  ConversationDials,
  DesignSystemDials,
  IconDials,
  ProseDials,
  ShellDials,
  TabsDials,
  TextDials,
  ThemeDials,
  ToastDials,
  useAppearance,
} from "./dials";
import type { Appearance } from "./dials";
import { startFake, useFakeThread } from "./fake-thread";
import { useShellHotkeys } from "./hotkeys";
import type { ShellHotkeyActions } from "./hotkeys";
import { getTabsSnapshot, tabActions, useTabs } from "./tab-store";

const STORY_RAIL_WIDTH = "168px";
const RAIL_ITEM_PAD_Y = "4px";
const SECTION_GAP = "28px";
const CANVAS_PAD = "32px";
const RAIL_ITEM_GAP = "2px";
// Traffic lights are OS chrome facts for the demo, not product tokens.
const TRAFFIC_LIGHT_SIZE = "12px";
const TRAFFIC_LIGHT_GAP = "8px";
const TRAFFIC_LIGHT_CLOSE = "#ff5f57";
const TRAFFIC_LIGHT_MINIMIZE = "#febc2e";
const TRAFFIC_LIGHT_ZOOM = "#28c840";

// Shell pins light/dark on itself, so the appearance dial overrides colorScheme via xstyle.
const schemeStyles: Record<Appearance, React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

const styles = stylex.create({
  galleryBody: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
  },
  galleryCol: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    flexShrink: 1,
    flexBasis: "0%",
  },
  galleryColGrow: {
    flexGrow: 1,
  },
  galleryColDivided: {
    borderLeftWidth: borderVars["--honk-border-hairline"],
    borderLeftStyle: "solid",
    borderLeftColor: colorVars["--honk-color-border-muted"],
  },
  storyRegion: {
    flexBasis: STORY_RAIL_WIDTH,
    flexShrink: 0,
  },
  dialRegion: {
    // oxlint-disable-next-line honk/design-no-raw-values -- dial rail width is fixed dev-tool panel geometry; no layout sizing token owns the Dialkit region
    flexBasis: "300px",
    flexShrink: 0,
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px rail-item gap is fixed intrinsic; no spacing token equals 2px
    gap: RAIL_ITEM_GAP,
    padding: spaceVars["--honk-space-gutter"],
    overflowY: "auto",
  },
  railItem: {
    display: "block",
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px rail-item vertical pad is fixed intrinsic; no spacing token equals 4px
    paddingBlock: RAIL_ITEM_PAD_Y,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-layer-01"] },
    },
    color: colorVars["--honk-color-text-muted"],
    textDecoration: "none",
    fontSize: fontVars["--honk-font-size-body"],
  },
  railItemActive: {
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-primary"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  canvas: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 32px canvas gutter is the gallery's fixed demo padding; no spacing token equals 32px
    paddingBlock: CANVAS_PAD,
    // oxlint-disable-next-line honk/design-no-raw-values -- 32px canvas gutter is the gallery's fixed demo padding; no spacing token equals 32px
    paddingInline: CANVAS_PAD,
  },
  canvasInner: {
    width: "100%",
    // oxlint-disable-next-line honk/design-no-raw-values -- gallery canvas width bounds component specimens for inspection; no layout sizing token owns the dev gallery canvas
    maxWidth: "1120px",
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 28px section rhythm is the gallery's fixed demo spacing; no spacing token equals 28px
    gap: SECTION_GAP,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  specRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    flexWrap: "wrap",
  },
  specColumn: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- specimen column width keeps gallery examples readable; no layout sizing token owns demo content measure
    maxWidth: "560px",
  },
  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  controlCell: {
    display: "flex",
    minWidth: 0,
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    // oxlint-disable-next-line honk/design-no-raw-values -- inset 0 0 0 hairline ring is fixed geometry; no elevation token owns a 1px inset ring
    boxShadow: `inset 0 0 0 ${borderVars["--honk-border-hairline"]} ${colorVars["--honk-color-border-muted"]}`,
  },
  narrowFixture: {
    // oxlint-disable-next-line honk/design-no-raw-values -- narrow fixture width deliberately stress-tests compact component layout; no sizing token owns test-fixture geometry
    width: "220px",
    maxWidth: "100%",
  },
  composerFixture: {
    display: "flex",
    width: "100%",
    // oxlint-disable-next-line honk/design-no-raw-values -- composer fixture width models the transcript composer specimen; no sizing token owns demo fixture geometry
    maxWidth: "720px",
    // oxlint-disable-next-line honk/design-no-raw-values -- composer fixture minimum height models the specimen's empty prompt area; no control token owns the full fixture height
    minHeight: "112px",
    flexDirection: "column",
    justifyContent: "flex-end",
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-raised"],
  },
  composerPrompt: {
    flexGrow: 1,
    padding: spaceVars["--honk-space-panel-pad"],
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-body"],
  },
  composerFooter: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    // oxlint-disable-next-line honk/design-no-raw-values -- composer fixture footer height models composed toolbar geometry; no control-height token owns the entire footer row
    height: "44px",
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  composerSpacer: { flexGrow: 1 },
  proseSpecimen: {
    width: "100%",
    // oxlint-disable-next-line honk/design-no-raw-values -- prose specimen width provides a stable reading measure in the gallery; no sizing token owns demo content measure
    maxWidth: "840px",
  },
  statusInline: {
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  matrixAttention: {
    color: colorVars["--honk-color-warn-fg"],
  },
  iconGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  iconCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- icon specimen cell width aligns catalog labels; no sizing token owns dev-gallery grid cells
    width: "148px",
  },
  truncateBox: {
    // oxlint-disable-next-line honk/design-no-raw-values -- truncation fixture width intentionally forces label overflow; no sizing token owns test-fixture geometry
    width: "160px",
  },
  trafficLights: {
    position: "absolute",
    insetInlineStart: 0,
    insetBlock: 0,
    width: shellVars["--honk-shell-inset-left"],
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 8px macOS traffic-light spacing is fixed OS chrome, deliberately not a product spacing token
    gap: TRAFFIC_LIGHT_GAP,
    pointerEvents: "none",
  },
  trafficLight: {
    width: TRAFFIC_LIGHT_SIZE,
    height: TRAFFIC_LIGHT_SIZE,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
  },
  // oxlint-disable-next-line honk/design-no-raw-values -- macOS close-button red is fixed OS chrome, not a product color token
  trafficLightClose: { backgroundColor: TRAFFIC_LIGHT_CLOSE },
  // oxlint-disable-next-line honk/design-no-raw-values -- macOS minimize-button amber is fixed OS chrome, not a product color token
  trafficLightMinimize: { backgroundColor: TRAFFIC_LIGHT_MINIMIZE },
  // oxlint-disable-next-line honk/design-no-raw-values -- macOS zoom-button green is fixed OS chrome, not a product color token
  trafficLightZoom: { backgroundColor: TRAFFIC_LIGHT_ZOOM },
  regionContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    overflow: "hidden",
  },
  stripHost: {
    display: "flex",
    alignItems: "center",
    padding: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-deep"],
  },
  button: {
    height: shellVars["--honk-shell-tab-h"], // the shell's control height — reused, not re-invented
    width: "fit-content",
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: colorVars["--honk-color-layer-02"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-layer-03"] },
    },
    color: colorVars["--honk-color-text-primary"],
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    transitionProperty: "background-color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
});

function useRenderCount(): number {
  const renders = React.useRef(0);
  renders.current += 1;
  return renders.current;
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <section {...stylex.props(styles.section)}>
      <Text as="p" size="sm" tone="faint" weight="semibold">
        {title}
      </Text>
      {note !== undefined && (
        <Text as="p" size="sm" tone="faint">
          {note}
        </Text>
      )}
      {children}
    </section>
  );
}

function SpecLabel({ children }: { children: string }): React.ReactElement {
  return (
    <Text
      size="sm"
      tone="faint"
      family="mono"
      style={{
        flexBasis: STORY_RAIL_WIDTH,
        flexShrink: 0,
      }}
    >
      {children}
    </Text>
  );
}

function RegionPlaceholder({
  title,
  children,
}: {
  title: string;
  children: string;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.regionContent)}>
      <Text size="base" tone="muted" weight="regular">
        {title}
      </Text>
      <Text as="p" size="sm" tone="faint">
        {children}
      </Text>
    </div>
  );
}

const WINDOW_SPEC_TABS: readonly TabDescriptor[] = [
  { key: "home", title: "Home", kind: "home", status: "idle" },
  {
    key: "w-working",
    title: "composer tokens",
    kind: "thread",
    status: "working",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-done",
    title: "aux→core git",
    kind: "thread",
    status: "done",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-needs-you",
    title: "screencast spike",
    kind: "thread",
    status: "needs-you",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-failed",
    title: "trace flaky verify",
    kind: "thread",
    status: "failed",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-draft",
    title: "dark mode audit",
    kind: "thread",
    status: "draft",
    repository: { state: "ready", label: "honk" },
  },
];

function SpecimenTabStrip(): React.ReactElement {
  const [tabs, setTabs] = React.useState<readonly TabDescriptor[]>(WINDOW_SPEC_TABS);
  const [activeKey, setActiveKey] = React.useState("w-working");
  const draftSerial = React.useRef(0);

  return (
    <TabStrip
      tabs={tabs}
      activeKey={activeKey}
      onActivate={setActiveKey}
      onClose={(key) => {
        const index = tabs.findIndex((tab) => tab.key === key);
        if (index === -1) {
          return;
        }
        const next = tabs.filter((tab) => tab.key !== key);
        setTabs(next);
        if (key === activeKey) {
          const neighbor = next[index - 1] ?? next[0];
          if (neighbor !== undefined) {
            setActiveKey(neighbor.key);
          }
        }
      }}
      onReorder={(from, to) => {
        setTabs((current) => {
          const next = [...current];
          const [moved] = next.splice(from, 1);
          if (moved === undefined) {
            return current;
          }
          next.splice(to, 0, moved);
          return next;
        });
      }}
      onNew={() => {
        draftSerial.current += 1;
        const key = `w-new-${String(draftSerial.current)}`;
        setTabs((current) => [
          ...current,
          {
            key,
            title: "untitled draft",
            kind: "thread",
            status: "draft",
            repository: { state: "ready", label: "honk" },
          },
        ]);
        setActiveKey(key);
      }}
    />
  );
}

function ShellStory(): React.ReactElement {
  const appearance: Appearance = useAppearance();
  return (
    <>
      <ShellDials />
      <Section
        title="Shell — the window anatomy"
        note="The canonical inset floating sheet end to end: deep root → 36px titlebar → Stage carrying the 8px gutter → ONE floating Sheet (bg-base, 10px radius, the raised elevation ring) — never sibling cards. The real TabStrip sits on the titlebar's bottom edge exactly as the app seats it, on honest specimen state: activate, close, drag-reorder, and + all really happen; Home is pinned first."
      >
        <Shell
          style={[
            {
              width: "100%",
              // oxlint-disable-next-line honk/design-no-raw-values -- shell specimen width demonstrates the desktop window anatomy; no sizing token owns demo-window dimensions
              maxWidth: "1120px",
              // oxlint-disable-next-line honk/design-no-raw-values -- shell specimen height demonstrates the desktop window anatomy; no sizing token owns demo-window dimensions
              height: "640px",
              flexShrink: 0,
              borderRadius: radiusVars["--honk-radius-window"],
              overflow: "hidden",
              boxShadow: elevationVars["--honk-elevation-floating"],
            },
            schemeStyles[appearance],
          ]}
        >
          <Shell.TitleBar
            style={{ position: "relative" }}
            trailing={
              <Text size="xs" tone="faint">
                trailing slot
              </Text>
            }
          >
            <div aria-hidden={true} {...stylex.props(styles.trafficLights)}>
              <span {...stylex.props(styles.trafficLight, styles.trafficLightClose)} />
              <span {...stylex.props(styles.trafficLight, styles.trafficLightMinimize)} />
              <span {...stylex.props(styles.trafficLight, styles.trafficLightZoom)} />
            </div>
            <SpecimenTabStrip />
          </Shell.TitleBar>
          <Shell.Stage>
            <Shell.Sheet>
              <RegionPlaceholder title="Shell.Sheet">
                The floating content sheet: base paint, 10px radius, the raised elevation ring — 8px
                of the deep well shows on every side (the Stage gutter). There is no rail/sidebar
                column in this anatomy; page nav lives inside the sheet.
              </RegionPlaceholder>
            </Shell.Sheet>
          </Shell.Stage>
        </Shell>
        <Text as="p" size="xs" tone="faint">
          The three dots are stand-ins: the titlebar's left inset (--honk-shell-inset-left) is
          reserved for macOS, which draws the real traffic lights there — nothing of ours renders or
          clicks in that space.
        </Text>
      </Section>
      <Section
        title="Window drag — an Electron contract"
        note="Shell.TitleBar marks itself data-shell-drag-region and interactive chrome opts out with data-shell-no-drag — attributes only, inert in this browser. The -webkit-app-region CSS that makes the bar actually drag the window lives in the Electron host's plain-CSS escape (ADR 0025 §5), so this demo makes no pretense of dragging."
      />
      <Section
        title="The sheet at rest"
        note="Stage owns the gutter; Sheet is the ONLY card. Content splits inside it with hairlines and layer fills — never nested cards."
      >
        <Shell
          style={[
            {
              // oxlint-disable-next-line honk/design-no-raw-values -- compact shell specimen height demonstrates the resting window frame; no sizing token owns demo-window dimensions
              height: "240px",
              // oxlint-disable-next-line honk/design-no-raw-values -- compact shell specimen width demonstrates the resting window frame; no sizing token owns demo-window dimensions
              width: "440px",
              flexShrink: 0,
              borderRadius: radiusVars["--honk-radius-window"],
              overflow: "hidden",
              boxShadow: elevationVars["--honk-elevation-floating"],
            },
            schemeStyles[appearance],
          ]}
        >
          <Shell.TitleBar />
          <Shell.Stage>
            <Shell.Sheet>
              <RegionPlaceholder title="Shell.Sheet">
                The frame at rest: one sheet, no dividers.
              </RegionPlaceholder>
            </Shell.Sheet>
          </Shell.Stage>
        </Shell>
      </Section>
    </>
  );
}

const THREAD_TITLES: readonly string[] = [
  "Refactor the tab plane",
  "Trace the flaky verify",
  "Port matrix to StyleX",
  "Audit token drift",
  "Wire the hotkey map",
  "Dedupe reopen stack",
];

let threadSerial = 0;

function newThread(): void {
  do {
    threadSerial += 1;
  } while (getTabsSnapshot().tabs.some((tab) => tab.key === `T${threadSerial}`));

  const key = `T${threadSerial}`;
  const title = THREAD_TITLES[(threadSerial - 1) % THREAD_TITLES.length] ?? key;

  startFake(key, title, (threadKey, status) => {
    tabActions.setStatus(threadKey, status);
  });
  tabActions.open({
    key,
    title,
    kind: "thread",
    status: "working",
    repository: { state: "ready", label: "honk" },
  });
}

const tabsHotkeyActions: ShellHotkeyActions = {
  closeActive(): void {
    tabActions.closeActive();
  },
  reopen(): void {
    tabActions.reopen();
  },
  newThread,
  activateIndex(index: number): void {
    const tab = getTabsSnapshot().tabs[index];

    if (tab !== undefined) {
      tabActions.activate(tab.key);
    }
  },
};

const STATUS_SPEC_TABS: readonly TabDescriptor[] = [
  { key: "home", title: "Home", kind: "home", status: "idle" },
  {
    key: "s-loading",
    title: "loading repository",
    kind: "thread",
    status: "idle",
    repository: { state: "loading" },
  },
  {
    key: "s-working",
    title: "working — matrix",
    kind: "thread",
    status: "working",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "s-needs-you",
    title: "needs you — yellow matrix",
    kind: "thread",
    status: "needs-you",
    repository: { state: "ready", label: "honk" },
    server: { label: "cloud.honk.dev", kind: "cloud" },
  },
  {
    key: "s-done",
    title: "done — green",
    kind: "thread",
    status: "done",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "s-failed",
    title: "failed — red",
    kind: "thread",
    status: "failed",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "s-draft",
    title: "draft — hollow",
    kind: "thread",
    status: "draft",
    repository: { state: "ready", label: "honk" },
  },
];

function StatusSpecStrip(): React.ReactElement {
  const [tabs, setTabs] = React.useState<readonly TabDescriptor[]>(STATUS_SPEC_TABS);
  const [activeKey, setActiveKey] = React.useState("s-working");

  return (
    <div {...stylex.props(styles.stripHost)}>
      <TabStrip
        tabs={tabs}
        activeKey={activeKey}
        onActivate={setActiveKey}
        onClose={(key) => {
          setTabs((current) => current.filter((tab) => tab.key !== key));
        }}
        onReorder={(from, to) => {
          setTabs((current) => {
            const next = [...current];
            const [moved] = next.splice(from, 1);
            if (moved === undefined) {
              return current;
            }
            next.splice(to, 0, moved);
            return next;
          });
        }}
        onNew={() => {
          setTabs(STATUS_SPEC_TABS); // the + on the specimen resets it
        }}
      />
    </div>
  );
}

function TabsStory(): React.ReactElement {
  const { tabs, activeKey } = useTabs();
  useShellHotkeys(tabsHotkeyActions);
  const stripRenders = useRenderCount();

  return (
    <>
      <TabsDials />
      <Section
        title="TabStrip — live store"
        note="Wired to dev/tab-store.ts (persisted) + dev/hotkeys.ts: ⌥W close · ⌥⇧T reopen · ⌥N new · ⌥1-9 activate (the ⌘ twins are browser-reserved until the Electron host). Drag to reorder; middle-click closes; new runs walk working → needs-you → done."
      >
        <div {...stylex.props(styles.stripHost)}>
          <TabStrip
            tabs={tabs}
            activeKey={activeKey}
            onActivate={(key) => {
              tabActions.activate(key);
            }}
            onClose={(key) => {
              tabActions.close(key);
            }}
            onReorder={(from, to) => {
              tabActions.reorder(from, to);
            }}
            onNew={newThread}
          />
        </div>
        <div {...stylex.props(styles.specRow)}>
          <button type="button" onClick={newThread} {...stylex.props(styles.button)}>
            new fake thread
          </button>
          <button
            type="button"
            onClick={() => {
              tabActions.closeActive();
            }}
            {...stylex.props(styles.button)}
          >
            close active
          </button>
          <button
            type="button"
            onClick={() => {
              tabActions.reopen();
            }}
            {...stylex.props(styles.button)}
          >
            reopen
          </button>
          <Text size="xs" tone="faint" family="mono" tabularNums>
            strip ×{stripRenders}
          </Text>
        </div>
      </Section>
      <Section
        title="Status vocabulary"
        note="matrix = working · green = done · yellow pulse matrix = needs you · red = failed · hollow = draft · gray = idle (Home). The specimen is its own little state — the + resets it."
      >
        <StatusSpecStrip />
      </Section>
    </>
  );
}

const MATRIX_GRIDS: readonly number[] = [3, 5, 7];

// The gallery's slow row stands in for a wait that already crossed the 15s threshold.
const STATUS_ROW_STORY_EPOCH_MS = Date.now() - 15_000;

function MatrixStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Matrix — the signature status glyph"
        note="Working uses the sacred 1.2s diagonal sweep; needs-you uses the supplied 1.4s circular two-beat pulse in yellow. Reduced motion holds both at an honest resting state."
      >
        {MATRIX_GRIDS.map((grid) => (
          <div key={grid} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`grid=${grid}`}</SpecLabel>
            <Matrix grid={grid} isActive />
            <Text size="sm" tone="faint">
              active
            </Text>
            <Matrix grid={grid} isActive={false} />
            <Text size="sm" tone="faint">
              idle
            </Text>
          </div>
        ))}
        <div {...stylex.props(styles.specRow, styles.matrixAttention)}>
          <SpecLabel>needs-you</SpecLabel>
          <Matrix grid={5} variant="attention" isActive />
          <Text size="sm" tone="faint">
            active
          </Text>
          <Matrix grid={5} variant="attention" isActive={false} />
          <Text size="sm" tone="faint">
            idle
          </Text>
        </div>
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>drive</SpecLabel>
          <Matrix grid={3} variant="drive" isActive />
          <Text size="sm" tone="faint">
            active
          </Text>
          <Matrix grid={3} variant="drive" isActive={false} />
          <Text size="sm" tone="faint">
            idle
          </Text>
        </div>
      </Section>
    </>
  );
}

const TEXT_SIZES: readonly TextSize[] = ["xs", "sm", "base", "lg", "xl"];
const TEXT_TONES: readonly TextTone[] = [
  "primary",
  "muted",
  "faint",
  "accent",
  "ok",
  "warn",
  "err",
  "inherit",
];
const TEXT_WEIGHTS: readonly TextWeight[] = ["regular", "semibold"];

function TextStory(): React.ReactElement {
  return (
    <>
      <TextDials />
      <Section
        title="Sizes — the prose ramp"
        note="caption 11/14 · detail 12/16 · body 13/18 · title 14/20 (the conversation tier) · heading 16/21."
      >
        {TEXT_SIZES.map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`size=${size}`}</SpecLabel>
            <Text size={size}>The quick brown honk jumps over the lazy shell.</Text>
          </div>
        ))}
      </Section>
      <Section title="Tones">
        {TEXT_TONES.map((tone) => (
          <div key={tone} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`tone=${tone}`}</SpecLabel>
            <Text tone={tone}>Color carries status, never identity.</Text>
          </div>
        ))}
      </Section>
      <Section title="Weights">
        {TEXT_WEIGHTS.map((weight) => (
          <div key={weight} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`weight=${weight}`}</SpecLabel>
            <Text weight={weight} size="lg">
              Verbs lead, details trail.
            </Text>
          </div>
        ))}
      </Section>
      <Section title="Family · numerals · truncation">
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>family=mono</SpecLabel>
          <Text family="mono">pnpm --filter @honk/ui exec tsc --noEmit</Text>
        </div>
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>tabularNums</SpecLabel>
          <Text tabularNums>1,024 rows · +118 −12 · 0.4s</Text>
        </div>
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>truncate</SpecLabel>
          <div {...stylex.props(styles.truncateBox)}>
            <Text as="p" truncate>
              A very long line that must ellipsize inside its 160px box instead of wrapping.
            </Text>
          </div>
        </div>
      </Section>
    </>
  );
}

function ProseStory(): React.ReactElement {
  return (
    <>
      <ProseDials />
      <Section
        title="Assistant prose — measured text, wider evidence"
        note="Long-form text uses Making Software's 576px reading measure at 14/25, with 20px block rhythm and 48px section breaks. Code, tables, and media keep the full 840px conversation lane without importing its editorial chrome."
      >
        <div {...stylex.props(styles.proseSpecimen)}>
          <Prose>
            <Prose.Heading level={1}>Make the answer easy to stay inside</Prose.Heading>
            <Prose.Paragraph>
              Dense application chrome and long-form explanation do different jobs. Controls remain
              compact, while assistant prose gets a stable measure and enough leading for the eye to
              return to the next line without searching.
            </Prose.Paragraph>
            <Prose.Paragraph>
              The hierarchy comes from rhythm as much as scale. Paragraphs breathe, sections open
              more decisively, and <Prose.InlineCode>inline evidence</Prose.InlineCode> stays
              visibly distinct without turning every sentence into a row of chips.
            </Prose.Paragraph>
            <Prose.Heading level={2}>Let evidence use the wider lane</Prose.Heading>
            <Prose.List>
              <Prose.ListItem>
                Keep explanatory lines within a readable character measure.
              </Prose.ListItem>
              <Prose.ListItem>
                Allow code, tables, and media to use the full transcript width.
              </Prose.ListItem>
              <Prose.ListItem>
                Preserve the same semantic anatomy in compact windows.
              </Prose.ListItem>
            </Prose.List>
            <Prose.CodeBlock>
              <code>{`stream: {
  overflowY: "auto",
  overscrollBehaviorY: "contain",
  scrollbarGutter: "stable both-edges",
}`}</code>
            </Prose.CodeBlock>
            <Prose.Blockquote>
              Reading comfort is cumulative: line length, leading, spacing, and stable scroll
              geometry all have to agree.
            </Prose.Blockquote>
          </Prose>
        </div>
      </Section>
    </>
  );
}

const ICON_SIZES: readonly IconSize[] = ["xs", "sm", "md", "lg", "xl"];
const ICON_TONES: readonly IconTone[] = [
  "current",
  "muted",
  "faint",
  "accent",
  "ok",
  "warn",
  "err",
  "info",
];

function IconStory(): React.ReactElement {
  return (
    <>
      <IconDials />
      {ICON_CATALOG.map((group) => (
        <Section key={group.category} title={group.category}>
          <div {...stylex.props(styles.iconGrid)}>
            {group.glyphs.map(([name, glyph]) => (
              <div key={name} {...stylex.props(styles.iconCell)}>
                <Icon icon={glyph} size="lg" />
                <SpecLabel>{name}</SpecLabel>
              </div>
            ))}
          </div>
        </Section>
      ))}
      <Section
        title="Sizes"
        note="xs 12 · sm 14 · md 16 (default) · lg 18 · xl 20 — the wrapper owns the font box, the glyph renders at 1em."
      >
        {(
          [
            ["IconMagnifyingGlass", IconMagnifyingGlass],
            ["IconEyeOpen", IconEyeOpen],
            ["IconConsole", IconConsole],
          ] as const
        ).map(([name, glyph]) => (
          <div key={name} {...stylex.props(styles.specRow)}>
            <SpecLabel>{name}</SpecLabel>
            {ICON_SIZES.map((size) => (
              <Icon key={size} icon={glyph} size={size} />
            ))}
          </div>
        ))}
      </Section>
      <Section
        title="Tones"
        note="current (default) inherits the surrounding text color; the rest are the status family."
      >
        {ICON_TONES.map((tone) => (
          <div key={tone} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`tone=${tone}`}</SpecLabel>
            <Icon icon={IconConsole} tone={tone} />
            <Icon icon={IconMagnifyingGlass} tone={tone} />
            <Icon icon={IconEyeOpen} tone={tone} />
          </div>
        ))}
      </Section>
    </>
  );
}

function ExpandableToolCall(): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(false);

  return (
    <div {...stylex.props(styles.specColumn)}>
      <ToolCallLine
        verb="Ran"
        detail="pnpm test composer · exit 0"
        isExpanded={isExpanded}
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      />
      {isExpanded && (
        <WorkGroup.OutputStrip>
          {"RUN  composer.spec.tsx\n ✓ parses token spans (12ms)\n ✓ queues on enter (4ms)"}
        </WorkGroup.OutputStrip>
      )}
    </div>
  );
}

function ExpandableWorkGroup(): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(false);

  return (
    <WorkGroup>
      <WorkGroup.Header
        verb="Explored"
        detail="input.tsx, tokens.ts · 3 searches"
        isExpanded={isExpanded}
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      />
      {isExpanded && (
        <>
          <ToolCallLine verb="Read" detail="composer/input.tsx · 412 lines" />
          <ToolCallLine verb="Grepped" detail="richTextJson · 9 hits" />
          <ToolCallLine verb="Read" detail="composer/tokens.ts · 118 lines" />
        </>
      )}
    </WorkGroup>
  );
}

const LIVE_KEY = "live-spec";

const LIVE_STATUS_LINES = {
  working: "working — rows stream through the live window",
  "needs-you": "needs you — the run is paused on your input",
  done: "done — all steps settled",
} as const;

function startLiveRun(): void {
  startFake(LIVE_KEY, "Streaming spec", (threadKey, status) => {
    tabActions.setStatus(threadKey, status);
  });
}

function LiveRun(): React.ReactElement {
  const thread = useFakeThread(LIVE_KEY);
  const rowRenders = useRenderCount();

  if (thread === undefined) {
    return (
      <button type="button" onClick={startLiveRun} {...stylex.props(styles.button)}>
        start a streaming run
      </button>
    );
  }

  const isWorking = thread.status === "working";
  const tail = thread.rows[thread.rows.length - 1];

  return (
    <div {...stylex.props(styles.specColumn)}>
      <div {...stylex.props(styles.specRow)}>
        <Text size="sm" tone={thread.status === "needs-you" ? "warn" : "faint"}>
          {LIVE_STATUS_LINES[thread.status]}
        </Text>
        <Text size="xs" tone="faint" family="mono" tabularNums>
          rows ×{rowRenders}
        </Text>
      </div>
      <WorkGroup isRunning={isWorking}>
        <WorkGroup.Header
          verb={isWorking ? `${tail?.verb ?? "Working"}…` : "Worked"}
          detail={isWorking ? tail?.detail : `${thread.rows.length} steps`}
          isRunning={isWorking}
          isExpanded={!isWorking}
        />
        {isWorking ? (
          <WorkGroup.Preview isScrollable={thread.rows.length > 4}>
            {thread.rows.map((row) => (
              <ToolCallLine
                key={row.id}
                verb={row.verb}
                detail={row.detail}
                state={row.state}
                added={row.added}
                removed={row.removed}
              />
            ))}
          </WorkGroup.Preview>
        ) : (
          thread.rows.map((row) => (
            <ToolCallLine
              key={row.id}
              verb={row.verb}
              detail={row.detail}
              state={row.state}
              added={row.added}
              removed={row.removed}
            />
          ))
        )}
      </WorkGroup>
      {isWorking && <StatusRow>Planning next moves</StatusRow>}
      {thread.status !== "working" && (
        <button type="button" onClick={startLiveRun} {...stylex.props(styles.button)}>
          restart the run
        </button>
      )}
    </div>
  );
}

function ConversationStory(): React.ReactElement {
  return (
    <>
      <ConversationDials />
      <Section
        title="UserMessage — the only bubble"
        note="Full-column bubble on the elevated surface with a 1px inset ring; 13px text on the window's 16px leading. Assistant output NEVER gets one of these (locked §5)."
      >
        <div {...stylex.props(styles.specColumn)}>
          <UserMessage onEdit={() => undefined}>
            Replace richTextJson with token spans over the plain buffer.
          </UserMessage>
          <UserMessage>
            <UserMessage.Preview>
              Audit the composer command-menu placement against the live caret, including the fixed
              virtual anchor, viewport collision behavior, async result-count revisions, and the
              path-preview side panel. Verify both slash and at-mention flows with enough results to
              force the menu against every viewport edge, then report the exact files changed and
              the checks that passed after the fix.
            </UserMessage.Preview>
          </UserMessage>
          <UserMessage
            footer={
              <Text size="sm" tone="err">
                The turn failed — the model rejected the request.
              </Text>
            }
          >
            Fix the flake in composer/input.tsx, then run the verify workflow and report which gates
            were red before your change and which stayed red after it.
          </UserMessage>
        </div>
      </Section>
      <Section
        title="ChangeReceipt — the settled turn receipt"
        note="Resolved snapshot diffs stay attached to their turn. The first four files and disclosure occupy Cursor's five-row preview; Review is the one aggregate action."
      >
        <ChangeReceipt
          files={[
            {
              path: "packages/ui/src/user-message.tsx",
              additions: 96,
              deletions: 8,
              status: "modified",
            },
            {
              path: "packages/ui/src/change-receipt.tsx",
              additions: 214,
              deletions: 0,
              status: "added",
            },
            {
              path: "packages/app/src/thread.tsx",
              additions: 18,
              deletions: 31,
              status: "modified",
            },
            {
              path: "packages/ui/src/index.ts",
              additions: 7,
              deletions: 1,
              status: "modified",
            },
            {
              path: "packages/ui/src/legacy-patch-chip.tsx",
              additions: 0,
              deletions: 44,
              status: "deleted",
            },
            {
              path: "packages/ui/dev/main.tsx",
              additions: 42,
              deletions: 0,
              status: "modified",
            },
          ]}
          onReview={() => {
            toast("Reviewing the six resolved turn changes");
          }}
        />
      </Section>
      <Section
        title="ToolCallLine — the activity row"
        note="verb (74% fg) · detail (54% fg, tabular) · optional diff stats · optional chevron. No status icons — running shimmers, failed goes red, hover promotes one step. Sole exception: live-session rows (subagents) opt into the working Matrix via workingGlyph."
      >
        <div {...stylex.props(styles.specColumn)}>
          <ToolCallLine verb="Read" detail="src/tabs.tsx · 687 lines" />
          <ToolCallLine verb="Running" detail="pnpm test composer…" state="running" />
          <ToolCallLine
            verb="Fix invalid workbench route"
            detail="Sol High"
            supportingText="Read packages/app/src/tab-store.ts"
            state="running"
            workingGlyph
            isExpanded={false}
            onToggle={() => {
              toast("Subagent rows open the work details tray");
            }}
          />
          <ToolCallLine verb="Command" detail="pnpm run lint:design · exit 1" state="failed" />
          <ToolCallLine verb="Edited" detail="composer/tokens.ts" added={118} removed={12} />
          <ExpandableToolCall />
        </div>
      </Section>
      <Section
        title="StatusRow — the waiting indicator"
        note="Drive-chevron glyph plus a mask-shimmer label at the conversation tier. The 15s slow-label swap is store timing; the elapsed readout rides that same swap and only then does the row own a timer."
      >
        <div {...stylex.props(styles.specColumn)}>
          <StatusRow>Planning next moves</StatusRow>
          <StatusRow startedAtMs={STATUS_ROW_STORY_EPOCH_MS}>
            Taking longer than expected…
          </StatusRow>
        </div>
      </Section>
      <Section
        title="WorkGroup — verb line + live window"
        note="Header leads with the verb; running groups keep a 144px bottom-anchored preview with a top fade, and the last shell/edit step tails output in the 90px mono strip."
      >
        <div {...stylex.props(styles.specColumn)}>
          <WorkGroup>
            <WorkGroup.Header verb="Edited" detail="composer/tokens.ts" added={118} removed={12} />
          </WorkGroup>
          <ExpandableWorkGroup />
          <WorkGroup isRunning>
            <WorkGroup.Header verb="Editing…" detail="dev-footer.tsx" isRunning />
            <WorkGroup.Preview isScrollable>
              <ToolCallLine verb="Read" detail="dev-footer.tsx · 0.4s" />
              <ToolCallLine verb="Edited" detail="dev-footer.tsx" added={24} removed={3} />
              <ToolCallLine verb="Running" detail="pnpm test dev-footer…" state="running" />
              <WorkGroup.OutputStrip isPreview>
                {
                  "RUN  dev-footer.spec.tsx\n ✓ renders perf cells (12ms)\n ⠸ retry cell shows live count…"
                }
              </WorkGroup.OutputStrip>
            </WorkGroup.Preview>
          </WorkGroup>
        </div>
      </Section>
      <Section
        title="Live streaming run"
        note="dev/fake-thread.ts drives structured rows on real 300ms timers: each tick settles the running row (references of settled rows survive) and streams the next."
      >
        <LiveRun />
      </Section>
    </>
  );
}

const BADGE_TONES = ["neutral", "accent", "ok", "warn", "err", "outline"] as const;

function BadgeStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Badge — tones"
        note="A small labelled chip: neutral + accent, the status fills (ok/warn/err — the pale *-bg under the *-fg), and outline. No info tone yet — the status family has no sourced info background."
      >
        <div {...stylex.props(styles.specRow)}>
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
      </Section>

      <Section
        title="Sizes + counts"
        note="sm · md. minWidth = height, so a single glyph reads as a coin (a count, a dot of emphasis)."
      >
        <div {...stylex.props(styles.specRow)}>
          <Badge size="sm" tone="accent">
            sm
          </Badge>
          <Badge size="md" tone="accent">
            md
          </Badge>
          <Badge size="sm" tone="err">
            3
          </Badge>
          <Badge size="md" tone="neutral">
            128
          </Badge>
          <Badge size="md" tone="ok">
            NEW
          </Badge>
        </div>
      </Section>
    </>
  );
}

const PILL_TONES = ["control", "muted", "surface", "neutral", "ok", "warn", "err"] as const;

function PillStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Pill — tones"
        note="A soft, rounded label chip: the neutral surfaces (control/muted/surface/neutral) and the status fills (ok/warn/err)."
      >
        <div {...stylex.props(styles.specRow)}>
          {PILL_TONES.map((tone) => (
            <Pill key={tone} tone={tone}>
              {tone}
            </Pill>
          ))}
        </div>
      </Section>

      <Section title="Sizes" note="inline · sm · md.">
        <div {...stylex.props(styles.specRow)}>
          <Pill size="inline">inline</Pill>
          <Pill size="sm">sm</Pill>
          <Pill size="md">md</Pill>
        </div>
      </Section>

      <Section
        title="Slots + modifiers"
        note="Leading icon, a removable close button, monospace label, and the inset ring."
      >
        <div {...stylex.props(styles.specRow)}>
          <Pill icon={<Icon icon={IconCrossSmall} size="sm" />}>with icon</Pill>
          <Pill removeLabel="tag" onRemove={() => {}}>
            removable
          </Pill>
          <Pill isMono>mono</Pill>
          <Pill hasRing>ring</Pill>
        </div>
      </Section>
    </>
  );
}

const STATUS_TONES = ["ok", "warn", "err", "info", "accent", "neutral", "draft"] as const;

function StatusDotStory(): React.ReactElement {
  return (
    <>
      <Section
        title="StatusDot — semantic tones"
        note="The status color language as a round glyph. The app maps its vocabulary onto the tone: done→ok, needs-you→warn, failed→err, unseen→accent, idle→neutral, and draft→the hollow ring."
      >
        <div {...stylex.props(styles.iconGrid)}>
          {STATUS_TONES.map((tone) => (
            <div key={tone} {...stylex.props(styles.iconCell)}>
              <StatusDot tone={tone} label={tone} />
              <Text size="xs" tone="faint" family="mono">
                {tone}
              </Text>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Pulse — the attention beat"
        note="warn + pulse is the needs-you dot — the identity's slow amber pulse (2000ms, opacity breath). Every pulse carries its own reduced-motion off-switch."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="warn" pulse />
            <Text size="sm">Needs you</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="accent" pulse />
            <Text size="sm">Unseen</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="err" pulse />
            <Text size="sm">Failed</Text>
          </span>
        </div>
      </Section>

      <Section
        title="Inline with text"
        note="A dot beside its own label is decorative (aria-hidden) — the row already reads as one status. A lone dot with no text takes a label prop and becomes an announced status region."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="ok" />
            <Text size="sm">Done</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="neutral" />
            <Text size="sm">Idle</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="draft" />
            <Text size="sm">Draft</Text>
          </span>
        </div>
      </Section>
    </>
  );
}

const BUTTON_VARIANTS = ["primary", "neutral", "quiet", "destructive"] as const;
const BUTTON_SIZES = ["sm", "md", "lg"] as const;

function ControlsStory(): React.ReactElement {
  const [preset, setPreset] = React.useState("balanced");
  const [location, setLocation] = React.useState("honk");

  return (
    <>
      <Section
        title="Canonical control matrix"
        note="Button is a command, Picker owns a value, ListRow is persistent navigation, and Menu holds transient actions. Tab through for focus, press controls for active/open, and compare selected against hover without changing primitives at the call site."
      >
        <div {...stylex.props(styles.controlsGrid)}>
          <div {...stylex.props(styles.controlCell)}>
            <Text size="xs" tone="faint" weight="semibold">
              Commands
            </Text>
            <div {...stylex.props(styles.specRow)}>
              <Button variant="primary">Primary</Button>
              <Button variant="neutral">Neutral</Button>
              <Button variant="quiet">Quiet</Button>
              <Button variant="destructive">Delete</Button>
              <Button variant="neutral" disabled>
                Disabled
              </Button>
              <IconButton aria-label="Search">
                <Icon icon={IconMagnifyingGlass} size="sm" />
              </IconButton>
            </div>
          </div>

          <div {...stylex.props(styles.controlCell)}>
            <Text size="xs" tone="faint" weight="semibold">
              Persistent rows
            </Text>
            <ListRow isSelected>
              <ListRow.Slot>
                <StatusDot tone="accent" />
              </ListRow.Slot>
              <ListRow.Content>
                <ListRow.Title>Selected workspace</ListRow.Title>
                <ListRow.Description>Selection stays visible through hover.</ListRow.Description>
              </ListRow.Content>
              <ListRow.Meta>12</ListRow.Meta>
            </ListRow>
            <ListRow>
              <ListRow.Slot>
                <StatusDot tone="neutral" />
              </ListRow.Slot>
              <ListRow.Content>
                <ListRow.Title>A very long project label that must truncate cleanly</ListRow.Title>
                <ListRow.Description>
                  packages/ui/src/canonical-control-contract
                </ListRow.Description>
              </ListRow.Content>
            </ListRow>
            <ListRow disabled>
              <ListRow.Title>Disabled row</ListRow.Title>
            </ListRow>
          </div>

          <div {...stylex.props(styles.controlCell)}>
            <Text size="xs" tone="faint" weight="semibold">
              Value picker
            </Text>
            <Picker.Root value={preset} onValueChange={setPreset}>
              <Picker.Trigger accessibilityLabel="Model preset">
                <Icon icon={IconConsole} size="sm" tone="muted" />
                {preset === "balanced" ? "Balanced" : "Deep review"}
              </Picker.Trigger>
              <Picker.Popup label="Model preset" width="wide">
                <Picker.GroupLabel>Model preset</Picker.GroupLabel>
                <Picker.Option
                  value="balanced"
                  label="Balanced"
                  description="Main Sonnet · Sidekick Haiku"
                  leading={<Icon icon={IconConsole} size="sm" tone="muted" />}
                  metadata="medium"
                />
                <Picker.Option
                  value="deep"
                  label="Deep review with a deliberately long model name"
                  description="Main Opus · Sidekick Sonnet"
                  leading={<Icon icon={IconEyeOpen} size="sm" tone="muted" />}
                  metadata="high"
                />
                <Picker.Option value="disabled" label="Unavailable preset" disabled />
              </Picker.Popup>
            </Picker.Root>
            <Menu.Root>
              <Menu.Trigger render={<Button variant="neutral">Transient actions</Button>} />
              <Menu.Popup>
                <Menu.Item>Rename</Menu.Item>
                <Menu.Item>Duplicate</Menu.Item>
                <Menu.Item disabled>Move to project</Menu.Item>
              </Menu.Popup>
            </Menu.Root>
          </div>

          <div {...stylex.props(styles.controlCell, styles.narrowFixture)}>
            <Text size="xs" tone="faint" weight="semibold">
              Narrow width
            </Text>
            <Picker.Root value={preset} onValueChange={setPreset}>
              <Picker.Trigger accessibilityLabel="Narrow model picker">
                A model name that cannot fit in this lane
              </Picker.Trigger>
              <Picker.Popup label="Narrow model picker" width="wide">
                <Picker.Option
                  value="balanced"
                  label="Balanced"
                  description="Main Sonnet · Sidekick Haiku"
                />
                <Picker.Option
                  value="deep"
                  label="Deep review with a deliberately long model name"
                  description="Main Opus · Sidekick Sonnet"
                />
              </Picker.Popup>
            </Picker.Root>
          </div>
        </div>
      </Section>

      <Section
        title="Composer footer cluster"
        note="The cluster is the acceptance fixture: attachment, constrained mode, model, location, and send share one baseline while preserving their different intent."
      >
        <div {...stylex.props(styles.composerFixture)}>
          <div {...stylex.props(styles.composerPrompt)}>Describe a task…</div>
          <div {...stylex.props(styles.composerFooter)}>
            <IconButton size="sm" variant="quiet" aria-label="Add attachments">
              <Icon icon={IconCrossSmall} size="sm" />
            </IconButton>
            <Button size="sm" variant="quiet">
              Plan
            </Button>
            <Picker.Root value={preset} onValueChange={setPreset}>
              <Picker.Trigger size="sm" tone="quiet" accessibilityLabel="Model preset">
                <Icon icon={IconConsole} size="sm" tone="muted" />
                {preset === "balanced" ? "Balanced" : "Deep review"}
              </Picker.Trigger>
              <Picker.Popup label="Model preset" width="wide">
                <Picker.Option
                  value="balanced"
                  label="Balanced"
                  description="Main Sonnet · Sidekick Haiku"
                  metadata="medium"
                />
                <Picker.Option
                  value="deep"
                  label="Deep review"
                  description="Main Opus · Sidekick Sonnet"
                  metadata="high"
                />
              </Picker.Popup>
            </Picker.Root>
            <Picker.Root value={location} onValueChange={setLocation}>
              <Picker.Trigger size="sm" tone="quiet" accessibilityLabel="Project location">
                {location === "honk" ? "honk" : "a-very-long-worktree-name"}
              </Picker.Trigger>
              <Picker.Popup label="Project location" width="wide">
                <Picker.Option value="honk" label="honk" description="~/Developer/honk" />
                <Picker.Option
                  value="worktree"
                  label="a-very-long-worktree-name"
                  description="~/Developer/honk-worktrees/canonical-styling"
                />
              </Picker.Popup>
            </Picker.Root>
            <span {...stylex.props(styles.composerSpacer)} />
            <IconButton size="sm" variant="primary" aria-label="Send">
              <Icon icon={IconCircleCheck} size="sm" />
            </IconButton>
          </div>
        </div>
      </Section>
    </>
  );
}

function ButtonStory(): React.ReactElement {
  const [colorMode, setColorMode] = React.useState("system");

  return (
    <>
      <Section
        title="Button — variants (Base UI)"
        note="Neutral is the default raised command, primary carries the single accent fill, quiet recedes into surrounding chrome, and destructive uses the error surface. Hover, press, focus, and disabled states remain distinct without stacked rings."
      >
        <div {...stylex.props(styles.specRow)}>
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Segmented control — one visible choice"
        note="Use for a short, stable set where comparing every option matters more than conserving width. The selected segment lifts from the muted track; arrow keys move focus through the group."
      >
        <div {...stylex.props(styles.specRow)}>
          <SegmentedControl
            value={colorMode}
            accessibilityLabel="Color mode"
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onValueChange={setColorMode}
          />
        </div>
      </Section>

      <Section
        title="Sizes"
        note="sm · md · lg on the shared control scale (24 / 28 / 32px). md reuses honk's 28px control height — the same number the tab + sidebar row use."
      >
        {BUTTON_SIZES.map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{size}</SpecLabel>
            <Button size={size} variant="primary">
              Send
            </Button>
            <Button size={size} variant="neutral">
              Cancel
            </Button>
            <Button
              size={size}
              variant="neutral"
              iconStart={<Icon icon={IconCircleCheck} size="sm" />}
            >
              Approve
            </Button>
          </div>
        ))}
      </Section>

      <Section
        title="Icon + label"
        note="iconStart / iconEnd slot around the label; the root's flex + the control-gap token lay them out — no wrapper."
      >
        <div {...stylex.props(styles.specRow)}>
          <Button variant="neutral" iconStart={<Icon icon={IconMagnifyingGlass} size="sm" />}>
            Search
          </Button>
          <Button variant="primary" iconStart={<Icon icon={IconCircleCheck} size="sm" />}>
            Confirm
          </Button>
          <Button variant="destructive" iconStart={<Icon icon={IconCrossSmall} size="sm" />}>
            Delete
          </Button>
          <Button variant="quiet" iconEnd={<Icon icon={IconEyeOpen} size="sm" />}>
            Preview
          </Button>
        </div>
      </Section>

      <Section
        title="IconButton — square, tooltip-paired"
        note="Icon-only controls REQUIRE an aria-label; a Tooltip usually gives the same label visually. This is the port hierarchy paying off — the tab-strip's tooltip, now driving a button. Hover one."
      >
        <div {...stylex.props(styles.specRow)}>
          <Tooltip label="Search">
            <IconButton aria-label="Search">
              <Icon icon={IconMagnifyingGlass} size="sm" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Open console">
            <IconButton aria-label="Open console">
              <Icon icon={IconConsole} size="sm" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Approve">
            <IconButton aria-label="Approve" variant="neutral">
              <Icon icon={IconCircleCheck} size="sm" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Close">
            <IconButton aria-label="Close" variant="destructive">
              <Icon icon={IconCrossSmall} size="sm" />
            </IconButton>
          </Tooltip>
        </div>
      </Section>

      <Section
        title="States"
        note="disabled dims to 0.4 and drops the pointer; render composes the button AS an <a> (real anchor semantics, button paint); block fills the inline axis."
      >
        <div {...stylex.props(styles.specRow)}>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="neutral" disabled>
            Disabled
          </Button>
          <Button variant="quiet" render={<a href="#/button" />} nativeButton={false}>
            Rendered as a link
          </Button>
        </div>
        <div {...stylex.props(styles.specColumn)}>
          <Button variant="primary" block>
            Block — fills the inline axis
          </Button>
        </div>
      </Section>
    </>
  );
}

const TOOLTIP_SIDES = ["top", "right", "bottom", "left"] as const;

function ControlledTooltipProbe(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const anchor = React.useMemo(() => (): HTMLElement | null => btnRef.current, []);
  return (
    <div {...stylex.props(styles.specRow)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        {...stylex.props(styles.button)}
      >
        {open ? "hide anchored" : "show anchored"}
      </button>
      <AnchoredTooltip open={open} onOpenChange={setOpen} anchor={anchor}>
        Anchored, controlled, triggerless — the tab-strip path.
      </AnchoredTooltip>
    </div>
  );
}

function TooltipStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Tooltip — hover/focus label (Base UI)"
        note="Wraps @base-ui/react tooltip: portalled out of any overflow:hidden ancestor, a StyleX surface, on-self scale-fade (120ms in / 80ms out via the motion tokens), one shared open delay through TooltipProvider. Hover, or Tab to a control and hold focus."
      >
        <div {...stylex.props(styles.specRow)}>
          <Tooltip label="Run the verify workflow">
            <button type="button" {...stylex.props(styles.button)}>
              hover me
            </button>
          </Tooltip>
          <Tooltip label="Settings">
            <button type="button" aria-label="Settings" {...stylex.props(styles.button)}>
              <Icon icon={IconConsole} />
            </button>
          </Tooltip>
          <Tooltip label="A longer label that wraps within the tooltip's 280px max width instead of running off the edge of the window.">
            <button type="button" {...stylex.props(styles.button)}>
              long label
            </button>
          </Tooltip>
        </div>
      </Section>
      <Section
        title="Placement"
        note="side = top · right · bottom · left, with the shipped 6px offset; Base UI auto-flips when a side has no room."
      >
        <div {...stylex.props(styles.specRow)}>
          {TOOLTIP_SIDES.map((side) => (
            <Tooltip key={side} label={`side=${side}`} side={side}>
              <button type="button" {...stylex.props(styles.button)}>
                {side}
              </button>
            </Tooltip>
          ))}
        </div>
      </Section>
      <Section
        title="Delegated tab tooltips"
        note="The tab strip can't wrap each memo'd Tab in a Trigger, so it drives ONE controlled AnchoredTooltip from its delegated pointer events — the full title appears only when a tab is truncated or compact. Squeeze the window on the Shell story and hover a clipped tab. The button below is that same controlled/triggerless shape, toggled by click."
      >
        <ControlledTooltipProbe />
      </Section>
    </>
  );
}

function ToastStory(): React.ReactElement {
  return (
    <>
      <ToastDials />
      <Toaster />
      <Section
        title="Toast — friendly top-center stack (Sonner)"
        note="A compact dark pill with rounded type and a roomy leading slot. Toasts arrive from the top center, peek and scale as a collapsed stack, expand on hover, pause while you interact, and dismiss by swiping up or sideways. The stack behavior comes from Sonner; every visible value comes from @honk/ui tokens."
      >
        <div {...stylex.props(styles.specRow)}>
          <Button
            onClick={() => {
              toast("Ready to review", {
                description: "The verify checks all passed.",
                icon: <Icon icon={IconCircleCheck} size="lg" tone="ok" />,
              });
            }}
          >
            Default
          </Button>
          <Button
            onClick={() => {
              toast.success("Changes saved", {
                description: "Your workspace is up to date.",
              });
            }}
          >
            Success
          </Button>
          <Button
            onClick={() => {
              toast.error("Couldn’t save changes", {
                description: "The Core connection closed unexpectedly.",
              });
            }}
          >
            Error
          </Button>
          <Button
            onClick={() => {
              toast("Update available", {
                description: "Restart when you’re ready.",
                action: {
                  label: "Restart",
                  onClick: () => {
                    toast.success("Restart scheduled");
                  },
                },
              });
            }}
          >
            Action
          </Button>
          <Button
            onClick={() => {
              toast("First notification", { description: "Hover the stack to open it." });
              toast.info("Second notification", { description: "The cards keep their depth." });
              toast.warning("Third notification", {
                description: "Swipe one away in any direction.",
              });
            }}
          >
            Stack three
          </Button>
          <Button
            onClick={() => {
              toast.loading("Syncing workspace", {
                description: "This stays until it is dismissed.",
              });
            }}
          >
            Loading
          </Button>
        </div>
      </Section>
    </>
  );
}

function PopoverStory(): React.ReactElement {
  return (
    <Section
      title="Popover — bare floating surface (Base UI)"
      note="Wraps @base-ui/react popover: portalled out of any overflow:hidden ancestor, a StyleX surface (bg-base fill, floating elevation + a hairline ring, window radius), the tooltip's on-self scale-fade (120ms in / 80ms out). Pointer-interactive — it holds arbitrary content. Base UI moves focus into the popup on open and back to the trigger on close. Click a trigger."
    >
      <div {...stylex.props(styles.specRow)}>
        <Popover.Root>
          <Popover.Trigger render={<Button>Rename thread…</Button>} />
          <Popover.Popup>
            <div {...stylex.props(styles.specColumn)}>
              <Popover.Title>Rename thread</Popover.Title>
              <Popover.Description>
                Give this thread a name — arbitrary interactive content lives on the popover
                surface.
              </Popover.Description>
              <Popover.Close render={<Button variant="primary">Done</Button>} />
            </div>
          </Popover.Popup>
        </Popover.Root>

        <Popover.Root>
          <Popover.Trigger render={<Button variant="quiet">Open above, end-aligned</Button>} />
          <Popover.Popup side="top" align="end">
            <div {...stylex.props(styles.specColumn)}>
              <Popover.Title>Placement</Popover.Title>
              <Popover.Description>
                side=&quot;top&quot; align=&quot;end&quot; — the folded positioner steers it.
              </Popover.Description>
              <Popover.Close render={<Button>Close</Button>} />
            </div>
          </Popover.Popup>
        </Popover.Root>
      </div>
    </Section>
  );
}

function MenuStory(): React.ReactElement {
  return (
    <Section
      title="Menu — a dropdown of actions (Base UI)"
      note="A Button opens a portalled list on the shared overlay surface (bg-base · floating elevation · window radius) with the on-self scale-fade (120ms in / 80ms out via the motion tokens). Base UI brings the composite keyboard model: ↑/↓ roam rows, the active row lights via [data-highlighted], type-ahead jumps, Esc / outside-click dismiss. Rows snap to the 28px control scale. Open it, then drive it from the keyboard."
    >
      <div {...stylex.props(styles.specRow)}>
        <Menu.Root>
          <Menu.Trigger render={<Button variant="neutral">Actions</Button>} />
          <Menu.Popup>
            <Menu.Group>
              <Menu.GroupLabel>This thread</Menu.GroupLabel>
              <Menu.Item>
                <Icon icon={IconMagnifyingGlass} size="sm" />
                Find in thread
              </Menu.Item>
              <Menu.Item>
                <Icon icon={IconEyeOpen} size="sm" />
                View details
              </Menu.Item>
              <Menu.Item disabled>
                <Icon icon={IconConsole} size="sm" />
                Move to project
              </Menu.Item>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Item>Export transcript</Menu.Item>
            <Menu.Item>Delete thread</Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      </div>
    </Section>
  );
}

function ComboboxStory(): React.ReactElement {
  const [project, setProject] = React.useState<string | null>("/Users/goose/Developer/honk");

  return (
    <Section
      title="Combobox — a searchable picker (Base UI)"
      note="The project/worktree picker: a fixed search header, an optional pinned group, a scrolling list, and a fixed action footer, each separated by hairline dividers. Rows sit inside an 8px gutter so their 6px-radius highlight is inset from the popup wall (never full-bleed), the search magnifier column-aligns with row leading icons, and the popup enters with the float ease — a 150ms scale-fade plus a 4px slide from the trigger side. Open it, type to filter, roam with ↑/↓."
    >
      <div {...stylex.props(styles.specRow)}>
        <Combobox
          value={project}
          onValueChange={setProject}
          accessibilityLabel="Project"
          searchPlaceholder="Search projects…"
          emptyLabel="No recent projects."
          noMatchesLabel="No matching projects."
          width="wide"
          groups={[
            {
              label: "Current project",
              pinned: true,
              options: [
                {
                  value: "/Users/goose/Developer/honk",
                  label: "honk",
                  description: "/Users/goose/Developer/honk",
                  leading: <Icon icon={IconFolder1} size="sm" tone="muted" />,
                },
              ],
            },
            {
              label: "Recent projects",
              options: [
                {
                  value: "/Users/goose/Developer/v7",
                  label: "v7",
                  description: "/Users/goose/Developer/v7",
                  leading: <Icon icon={IconFolder1} size="sm" tone="muted" />,
                },
                {
                  value: "/Users/goose/Documents",
                  label: "Documents",
                  description: "/Users/goose/Documents",
                  leading: <Icon icon={IconFolder1} size="sm" tone="muted" />,
                },
                {
                  value: "/Users/goose/Developer/bloom",
                  label: "bloom",
                  description: "/Users/goose/Developer/bloom",
                  leading: <Icon icon={IconFolder1} size="sm" tone="muted" />,
                },
                {
                  value: "/Users/goose/Developer/gestures",
                  label: "gestures",
                  description: "/Users/goose/Developer/gestures",
                  leading: <Icon icon={IconFolder1} size="sm" tone="muted" />,
                },
              ],
            },
          ]}
          actions={[
            {
              label: "Open Folder…",
              leading: <Icon icon={IconFolderOpen} size="sm" tone="muted" />,
              onSelect: () => {
                toast("Open Folder…");
              },
            },
          ]}
        >
          <Icon icon={IconFolder1} size="sm" />
          <span>{project === null ? "Choose project" : project.split("/").at(-1)}</span>
        </Combobox>

        <Combobox
          value={null}
          onValueChange={() => {}}
          accessibilityLabel="Worktree"
          searchPlaceholder="Search worktrees…"
          emptyLabel="No existing worktrees."
          noMatchesLabel="No matching worktrees."
          size="sm"
          tone="quiet"
          side="top"
          groups={[
            {
              label: "Existing worktrees",
              options: [],
            },
          ]}
        >
          <span>Opens above (empty)</span>
        </Combobox>
      </div>
    </Section>
  );
}

function DialogStory(): React.ReactElement {
  const [notificationLevel, setNotificationLevel] = React.useState("mentions");

  return (
    <Section
      title="Dialog — a centered modal (Base UI)"
      note="A Button opens a centered portalled modal. The dropdown keeps its trigger-derived transform origin above the dialog layer. Customize opens a structurally nested dialog: Base UI suppresses its backdrop and blocks dismiss passthrough, while the parent keeps its size and position. Escape closes only the topmost popup."
    >
      <div {...stylex.props(styles.specRow)}>
        <Dialog.Root>
          <Dialog.Trigger render={<Button>Rename thread…</Button>} />
          <Dialog.Popup>
            <Dialog.Header>
              <Dialog.Title>Rename thread</Dialog.Title>
              <Dialog.Description>
                Give this thread a name — it updates everywhere the thread appears.
              </Dialog.Description>
            </Dialog.Header>
            <Text size="sm" tone="muted">
              The thread is currently “Untitled”.
            </Text>
            <Picker.Root value={notificationLevel} onValueChange={setNotificationLevel}>
              <Picker.Trigger accessibilityLabel="Notification level">
                {notificationLevel === "all" ? "All activity" : "Mentions only"}
              </Picker.Trigger>
              <Picker.Popup label="Notification level" layer="dialog">
                <Picker.Option value="mentions" label="Mentions only" />
                <Picker.Option value="all" label="All activity" />
              </Picker.Popup>
            </Picker.Root>
            <Dialog.Footer>
              <Dialog.Close render={<Button variant="quiet">Cancel</Button>} />
              <Dialog.Root>
                <Dialog.Trigger render={<Button>Customize…</Button>} />
                <Dialog.Popup>
                  <Dialog.Header>
                    <Dialog.Title>Customize thread</Dialog.Title>
                    <Dialog.Description>
                      This nested dialog stays centered above the rename dialog.
                    </Dialog.Description>
                  </Dialog.Header>
                  <Dialog.Footer>
                    <Dialog.Close render={<Button variant="primary">Done</Button>} />
                  </Dialog.Footer>
                </Dialog.Popup>
              </Dialog.Root>
              <Button variant="primary">Save</Button>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Root>
      </div>
    </Section>
  );
}

function AlertDialogStory(): React.ReactElement {
  return (
    <Section
      title="Alert Dialog — a forced decision (Base UI)"
      note="Base UI's alert-dialog: always modal, role=alertdialog, and non-dismissable by the scrim (outside-press disabled), so the choice can't be dodged by clicking away. The centered card reuses the overlay surface (bg-base · window radius · hairline ring + floating elevation) and grows from its center with the scale-fade (120ms in / 80ms out); the scrim wash fades under it. Header stacks Title + Description; Footer right-aligns the actions over a hairline divider. Open it, then pick Cancel (closes) or Delete."
    >
      <div {...stylex.props(styles.specRow)}>
        <AlertDialog.Root>
          <AlertDialog.Trigger render={<Button variant="destructive">Delete thread…</Button>} />
          <AlertDialog.Popup>
            <AlertDialog.Header>
              <AlertDialog.Title>Delete thread?</AlertDialog.Title>
              <AlertDialog.Description>
                This permanently deletes the thread and its entire transcript. This action cannot be
                undone.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Close render={<Button variant="quiet">Cancel</Button>} />
              <Button variant="destructive">Delete</Button>
            </AlertDialog.Footer>
          </AlertDialog.Popup>
        </AlertDialog.Root>
      </div>
    </Section>
  );
}

function SwitchStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Switch — off · on · disabled (Base UI)"
        note="An instant-effect toggle: the track flips layer-02 → accent and the on-accent knob slides on check. State is uncontrolled here (defaultChecked) — click to toggle; tab in for the accent focus ring, drop your OS to reduced-motion and the slide + flip go instant."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <Switch />
            <Text size="sm">Off</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Switch defaultChecked />
            <Text size="sm">On</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Switch disabled />
            <Text size="sm" tone="faint">
              Disabled off
            </Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Switch disabled defaultChecked />
            <Text size="sm" tone="faint">
              Disabled on
            </Text>
          </span>
        </div>
      </Section>
      <Section
        title="Sizes"
        note="md is the canonical toggle (30×18 track, 14px knob); sm is the compact menu-row density (26×16, 12px knob). Named-intrinsic geometry — a switch track is shorter than the 24/28/32 control scale, so it reads its own anatomy consts, not controlVars."
      >
        {(["sm", "md"] as const).map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{size}</SpecLabel>
            <Switch size={size} />
            <Switch size={size} defaultChecked />
          </div>
        ))}
      </Section>
    </>
  );
}

function CheckboxStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Checkbox — states"
        note="Base UI Checkbox.Root (role=checkbox + hidden input) + Indicator. Unchecked = bg-base field + hairline border-base ring; checked/indeterminate = accent fill (ring drops); the tick fades in on Base UI's transition attrs. Uncontrolled via defaultChecked; the mixed box uses `indeterminate` (a centered dash, not the checkmark)."
      >
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>unchecked</SpecLabel>
          <Checkbox aria-label="unchecked" />
          <SpecLabel>checked</SpecLabel>
          <Checkbox defaultChecked aria-label="checked" />
          <SpecLabel>indeterminate</SpecLabel>
          <Checkbox indeterminate aria-label="indeterminate" />
        </div>
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>disabled</SpecLabel>
          <Checkbox disabled aria-label="disabled" />
          <SpecLabel>disabled checked</SpecLabel>
          <Checkbox disabled defaultChecked aria-label="disabled checked" />
          <SpecLabel>disabled mixed</SpecLabel>
          <Checkbox disabled indeterminate aria-label="disabled mixed" />
        </div>
      </Section>
      <Section
        title="Checkbox — sizes"
        note="md 18 (default) · sm 16 — named intrinsics matched to switch.tsx's md/sm track heights so a checkbox and a switch sit level in a row, NOT the 24/28/32 control scale (a tick box is not a full control). The checkmark is a 12px <Icon> for both."
      >
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>sm</SpecLabel>
          <Checkbox size="sm" defaultChecked aria-label="small checked" />
          <Checkbox size="sm" indeterminate aria-label="small mixed" />
          <SpecLabel>md</SpecLabel>
          <Checkbox size="md" defaultChecked aria-label="medium checked" />
          <Checkbox size="md" indeterminate aria-label="medium mixed" />
        </div>
      </Section>
    </>
  );
}

function SeparatorStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Separator — horizontal rule (Base UI)"
        note="A hairline between stacked sections. tone=muted (default) is the quiet divider; tone=base is a hair stronger (border-base vs border-muted). It is a 1px background fill, not a CSS border, so toggling it never shifts layout."
      >
        <div {...stylex.props(styles.specColumn)}>
          <Text size="sm" tone="muted">
            Above the muted rule (default)
          </Text>
          <Separator />
          <Text size="sm" tone="muted">
            Between the two tones
          </Text>
          <Separator tone="base" />
          <Text size="sm" tone="muted">
            Below the base rule
          </Text>
        </div>
      </Section>
      <Section
        title="Vertical — the toolbar divider"
        note="orientation=vertical stretches to the row's cross axis via alignSelf (never height:100%, which would collapse under an indefinite parent); flexShrink 0 keeps it from vanishing in a tight row. Base UI supplies role=separator + aria-orientation for free."
      >
        <div {...stylex.props(styles.specRow)}>
          <Text size="sm">Edit</Text>
          <Separator orientation="vertical" />
          <Text size="sm">Select</Text>
          <Separator orientation="vertical" />
          <Text size="sm">View</Text>
          <Separator orientation="vertical" tone="base" />
          <Text size="sm">Help</Text>
        </div>
      </Section>
    </>
  );
}

function SpinnerStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Spinner — indeterminate loader"
        note="A faint ring (border-muted) whose top arc the tone repaints, spinning linearly at the 900ms spinner duration — the classic quarter-arc loader. tone = accent (the liveness default) · muted (a quiet inline loader). Pure StyleX, no Base UI."
      >
        <div {...stylex.props(styles.iconGrid)}>
          {(["accent", "muted"] as const).map((tone) => (
            <div key={tone} {...stylex.props(styles.iconCell)}>
              <Spinner tone={tone} label={`Loading (${tone})`} />
              <Text size="xs" tone="faint" family="mono">
                {tone}
              </Text>
            </div>
          ))}
        </div>
      </Section>
      <Section
        title="Sizes"
        note="sm · md · lg on the ICON ramp (14 / 16 / 18px) — a spinner stands in for a glyph, so it sizes like an <Icon>, not a control."
      >
        {(["sm", "md", "lg"] as const).map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`size=${size}`}</SpecLabel>
            <Spinner size={size} tone="accent" label={`Loading ${size}`} />
            <Spinner size={size} tone="muted" label={`Loading ${size} muted`} />
          </div>
        ))}
      </Section>
      <Section
        title="A11y — announced vs decorative"
        note="A lone spinner takes a label and becomes an announced status region (role=status). A spinner beside its own visible text is decorative (aria-hidden), so nothing double-announces. Reduced motion halts the spin to a static tracked ring — toggle the OS setting to see it stop."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <Spinner tone="muted" />
            <Text size="sm">Loading…</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Spinner tone="accent" />
            <Text size="sm">Sending</Text>
          </span>
          <Spinner tone="accent" label="Loading" />
        </div>
      </Section>
    </>
  );
}

function KbdStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Kbd — sizes"
        note="A monospace keycap chip on a native <kbd>. minWidth = height, so a lone glyph reads as a square coin; a word grows past it on the inline pad. sm takes micro type, md caption."
      >
        <div {...stylex.props(styles.specRow)}>
          <Kbd size="sm">K</Kbd>
          <Kbd size="sm">/</Kbd>
          <Kbd size="sm">Esc</Kbd>
          <Kbd size="md">K</Kbd>
          <Kbd size="md">/</Kbd>
          <Kbd size="md">Esc</Kbd>
        </div>
      </Section>
      <Section
        title="Shortcuts"
        note="Modifier symbols and multi-key hints compose as separate keycaps in the app's own flex row — the app arranges primitives; a Kbd is one key."
      >
        <div {...stylex.props(styles.specRow)}>
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>⌥</Kbd>
          <Kbd>⌃</Kbd>
          <Kbd>K</Kbd>
          <Kbd>⏎</Kbd>
          <Kbd>Tab</Kbd>
          <Kbd>Space</Kbd>
        </div>
      </Section>
    </>
  );
}

const SWATCH_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
const RADIUS_SWATCHES = [
  ["panel", "rPanel"],
  ["window", "rWindow"],
  ["control", "rControl"],
  ["field", "rField"],
  ["bubble", "rBubble"],
] as const;
const TYPE_RAMP = [
  ["xl", "Heading — the largest step"],
  ["lg", "Title — the conversation tier"],
  ["base", "Body — default prose"],
  ["sm", "Detail — secondary rows"],
  ["xs", "Caption — the smallest label"],
] as const;
const ICON_RAMP = ["xs", "sm", "md", "lg", "xl"] as const;

const swatchStyles = stylex.create({
  box: {
    // oxlint-disable-next-line honk/design-no-raw-values -- token swatch width is fixed gallery sample geometry; no sizing token owns design-token specimens
    width: "72px",
    // oxlint-disable-next-line honk/design-no-raw-values -- token swatch height is fixed gallery sample geometry; no sizing token owns design-token specimens
    height: "44px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-micro"],
    boxShadow: SWATCH_RING,
  },
  rPanel: { borderRadius: radiusVars["--honk-radius-panel"] },
  rWindow: { borderRadius: radiusVars["--honk-radius-window"] },
  rControl: { borderRadius: radiusVars["--honk-radius-control"] },
  rField: { borderRadius: radiusVars["--honk-radius-field"] },
  rBubble: { borderRadius: radiusVars["--honk-radius-bubble"] },
});

function DesignStory(): React.ReactElement {
  return (
    <>
      <DesignSystemDials />
      <Toaster />
      <Section
        title="Design system — every knob in one place"
        note="The dial rail on the right has a panel per token group. Move any knob and every specimen below repaints live — the values rewrite --honk-* on <html> with zero React. Hit a panel's Copy button to export its values as JSON, then paste into tokens.stylex.ts. (Colors arrive in the next pass — light-dark pairs need per-arm knobs.)"
      />

      <Section title="Controls — dial Control · Radius · Chrome & weight">
        <div {...stylex.props(styles.specRow)}>
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
        <div {...stylex.props(styles.specRow)}>
          {BUTTON_SIZES.map((size) => (
            <Button key={size} size={size} variant="primary">
              Send
            </Button>
          ))}
          <Tooltip label="Search">
            <IconButton aria-label="Search">
              <Icon icon={IconMagnifyingGlass} size="sm" />
            </IconButton>
          </Tooltip>
          {BADGE_TONES.slice(0, 4).map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          {STATUS_TONES.slice(0, 5).map((tone) => (
            <StatusDot key={tone} tone={tone} label={tone} />
          ))}
        </div>
      </Section>

      <Section title="Radius — dial Radius">
        <div {...stylex.props(styles.specRow)}>
          {RADIUS_SWATCHES.map(([label, variant]) => (
            <span key={label} {...stylex.props(swatchStyles.box, swatchStyles[variant])}>
              {label}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Type — dial Prose type · Chrome & weight">
        <div {...stylex.props(styles.specColumn)}>
          {TYPE_RAMP.map(([size, sample]) => (
            <Text key={size} size={size}>
              {sample}
            </Text>
          ))}
        </div>
      </Section>

      <Section title="Icon — dial Icon">
        <div {...stylex.props(styles.specRow)}>
          {ICON_RAMP.map((size) => (
            <Icon key={size} icon={IconEyeOpen} size={size} />
          ))}
        </div>
      </Section>

      <Section title="Motion — dial Motion (hover the button; the dot pulses)">
        <div {...stylex.props(styles.specRow)}>
          <StatusDot tone="warn" pulse label="pulse" />
          <Tooltip label="I fade in on the Motion durations">
            <Button variant="neutral">Hover me</Button>
          </Tooltip>
        </div>
      </Section>
      <Section title="Toast — dial Toast">
        <Button
          onClick={() => {
            toast("Design tokens updated", {
              description: "The friendly top-center surface repaints live.",
              icon: <Icon icon={IconCircleCheck} size="lg" tone="ok" />,
            });
          }}
        >
          Show toast
        </Button>
      </Section>
    </>
  );
}

const STORIES = [
  { path: "/design", label: "Design system" },
  { path: "/controls", label: "Controls" },
  { path: "/shell", label: "Shell" },
  { path: "/tabs", label: "Tabs" },
  { path: "/button", label: "Button" },
  { path: "/switch", label: "Switch" },
  { path: "/checkbox", label: "Checkbox" },
  { path: "/badge", label: "Badge" },
  { path: "/pill", label: "Pill" },
  { path: "/status-dot", label: "StatusDot" },
  { path: "/separator", label: "Separator" },
  { path: "/spinner", label: "Spinner" },
  { path: "/kbd", label: "Kbd" },
  { path: "/toast", label: "Toast" },
  { path: "/tooltip", label: "Tooltip" },
  { path: "/popover", label: "Popover" },
  { path: "/menu", label: "Menu" },
  { path: "/combobox", label: "Combobox" },
  { path: "/dialog", label: "Dialog" },
  { path: "/alert-dialog", label: "AlertDialog" },
  { path: "/matrix", label: "Matrix" },
  { path: "/text", label: "Text" },
  { path: "/prose", label: "Prose" },
  { path: "/icon", label: "Icon" },
  { path: "/conversation", label: "Conversation" },
] as const;

function StoryRail(): React.ReactElement {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav aria-label="Component stories" {...stylex.props(styles.rail)}>
      <Text
        as="p"
        size="xs"
        tone="faint"
        weight="semibold"
        style={{
          paddingInline: spaceVars["--honk-space-control-pad-x"],
          // oxlint-disable-next-line honk/design-no-raw-values -- nav preview row padding matches the gallery rail-item intrinsic; no spacing token owns this compact demo row
          paddingBlock: RAIL_ITEM_PAD_Y,
        }}
      >
        @honk/ui
      </Text>
      {STORIES.map((story) => (
        <Link
          key={story.path}
          to={story.path}
          {...stylex.props(styles.railItem, pathname === story.path && styles.railItemActive)}
        >
          {story.label}
        </Link>
      ))}
    </nav>
  );
}

function RootLayout(): React.ReactElement {
  const appearance: Appearance = useAppearance();

  return (
    <Shell style={schemeStyles[appearance]}>
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.galleryBody)}>
            <div {...stylex.props(styles.galleryCol, styles.storyRegion)}>
              <StoryRail />
            </div>
            <div
              {...stylex.props(styles.galleryCol, styles.galleryColDivided, styles.galleryColGrow)}
            >
              <div {...stylex.props(styles.canvas)}>
                <div {...stylex.props(styles.canvasInner)}>
                  <Outlet />
                </div>
              </div>
            </div>
            <div {...stylex.props(styles.galleryCol, styles.galleryColDivided, styles.dialRegion)}>
              <DialRoot mode="inline" defaultOpen />
              <ThemeDials />
            </div>
          </div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: () => {
    throw redirect({ to: "/shell" });
  },
  component: () => null,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shell",
  component: ShellStory,
});

const tabsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tabs",
  component: TabsStory,
});

const buttonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/button",
  component: ButtonStory,
});

const controlsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/controls",
  component: ControlsStory,
});

const badgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/badge",
  component: BadgeStory,
});

const pillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pill",
  component: PillStory,
});

const statusDotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status-dot",
  component: StatusDotStory,
});

const tooltipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tooltip",
  component: TooltipStory,
});

const toastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/toast",
  component: ToastStory,
});

const popoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/popover",
  component: PopoverStory,
});

const menuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/menu",
  component: MenuStory,
});

const comboboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/combobox",
  component: ComboboxStory,
});

const dialogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dialog",
  component: DialogStory,
});

const alertDialogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alert-dialog",
  component: AlertDialogStory,
});

const matrixRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/matrix",
  component: MatrixStory,
});

const textRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/text",
  component: TextStory,
});

const proseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prose",
  component: ProseStory,
});

const iconRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/icon",
  component: IconStory,
});

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/conversation",
  component: ConversationStory,
});

const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/design",
  component: DesignStory,
});

const switchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/switch",
  component: SwitchStory,
});

const checkboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checkbox",
  component: CheckboxStory,
});

const separatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/separator",
  component: SeparatorStory,
});

const spinnerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spinner",
  component: SpinnerStory,
});

const kbdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kbd",
  component: KbdStory,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  designRoute,
  shellRoute,
  tabsRoute,
  controlsRoute,
  buttonRoute,
  switchRoute,
  checkboxRoute,
  badgeRoute,
  pillRoute,
  statusDotRoute,
  separatorRoute,
  spinnerRoute,
  kbdRoute,
  toastRoute,
  tooltipRoute,
  popoverRoute,
  menuRoute,
  comboboxRoute,
  dialogRoute,
  alertDialogRoute,
  matrixRoute,
  textRoute,
  proseRoute,
  iconRoute,
  conversationRoute,
]);

// Hash history keeps story deep links alive across reloads of the single HTML file.
const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");

if (rootEl === null) {
  throw new Error("dev/index.html must provide #root");
}

createRoot(rootEl).render(
  <React.StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </React.StrictMode>,
);
