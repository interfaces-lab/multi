import { parsePatchFiles, registerCustomTheme, trimPatchContext } from "@pierre/diffs";
import type { FileDiffOptions } from "@pierre/diffs";

export const DIFF_THEME_NAMES = {
  light: "honk-diff-light",
  dark: "honk-diff-dark",
} as const;

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES];
type CustomDiffThemeRegistration = Awaited<ReturnType<Parameters<typeof registerCustomTheme>[1]>>;

export const DARK_DIFF_THEME = {
  name: DIFF_THEME_NAMES.dark,
  type: "dark",
  colors: {
    "diffEditor.insertedLineBackground": "#3FA26633",
    "diffEditor.insertedTextBackground": "#3FA26622",
    "diffEditor.removedLineBackground": "#B8004933",
    "diffEditor.removedTextBackground": "#B8004922",
    "editor.background": "#181818",
    "editor.foreground": "#E4E4E4EB",
    "editorLineNumber.foreground": "#E4E4E499",
    foreground: "#E4E4E4EB",
    "gitDecoration.addedResourceForeground": "#70B489",
    "gitDecoration.deletedResourceForeground": "#FC6B83",
    "gitDecoration.modifiedResourceForeground": "#F1B467",
    "terminal.ansiBlue": "#81A1C1",
    "terminal.ansiCyan": "#88C0D0",
    "terminal.ansiGreen": "#3FA266",
    "terminal.ansiRed": "#FC6B83",
    "terminal.ansiYellow": "#D2943E",
  },
  semanticHighlighting: true,
  semanticTokenColors: {
    "builtinConstant.readonly.builtin:python": "#82D2CE",
    "class.builtin": "#82D2CE",
    "class.typeHint": "#82D2CE",
    "entity.name.function": "#EBC88D",
    enumMember: "#D6D6DD",
    function: "#EBC88D",
    "function.builtin": "#82D2CE",
    "function.declaration": "#EFB080",
    macro: "#A8CC7C",
    "method.declaration": "#EFB080",
    property: "#AAA0FA",
    selfParameter: "#CC7C8A",
    "support.variable.property": "#AAA0FA",
    type: "#87C3FF",
    "variable.constant": "#82D2CE",
    "variable.defaultLibrary": "#D6D6DD",
  },
  settings: [
    {
      name: "Comment",
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: "#E4E4E45E", fontStyle: "italic" },
    },
    {
      name: "Strings",
      scope: ["string", "punctuation.definition.string.begin", "punctuation.definition.string.end"],
      settings: { foreground: "#E394DC" },
    },
    {
      name: "Text",
      scope: ["variable.parameter.function", "punctuation.separator.key-value"],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Keywords",
      scope: "keyword",
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Storage",
      scope: ["storage", "storage.type", "token.storage"],
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Special Operators",
      scope: [
        "keyword.operator.expression.delete",
        "keyword.operator.expression.in",
        "keyword.operator.expression.instanceof",
        "keyword.operator.expression.keyof",
        "keyword.operator.expression.of",
        "keyword.operator.expression.typeof",
        "keyword.operator.expression.void",
        "keyword.operator.new",
        "keyword.operator.optional",
        "keyword.operator.ternary",
      ],
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Operators",
      scope: [
        "keyword.operator",
        "keyword.operator.arithmetic",
        "keyword.operator.assignment",
        "keyword.operator.comparison",
        "keyword.operator.logical",
      ],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Functions",
      scope: ["entity.name.function", "meta.require", "support.function", "variable.function"],
      settings: { foreground: "#EFB080" },
    },
    {
      name: "Constants",
      scope: ["constant", "constant.numeric", "punctuation.definition.constant"],
      settings: { foreground: "#EBC88D" },
    },
    {
      name: "Constant Variables",
      scope: "variable.other.constant",
      settings: { foreground: "#AAA0FA" },
    },
    {
      name: "Readwrite Variables",
      scope: "variable.other.readwrite",
      settings: { foreground: "#87C3FF" },
    },
    {
      name: "Properties",
      scope: ["support.variable.property", "variable.other.property", "variable.other.property.ts"],
      settings: { foreground: "#AAA0FA" },
    },
    {
      name: "Template Punctuation",
      scope: [
        "keyword.other.substitution.begin",
        "keyword.other.substitution.end",
        "keyword.other.template.begin",
        "keyword.other.template.end",
        "punctuation.quasi.element",
      ],
      settings: { foreground: "#E394DC" },
    },
    {
      name: "Embedded Punctuation",
      scope: ["punctuation.section.embedded.begin", "punctuation.section.embedded.end"],
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Punctuation",
      scope: [
        "punctuation.separator.delimiter",
        "punctuation.section.block.begin",
        "punctuation.section.block.end",
        "punctuation.terminator.statement",
      ],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Diff Inserted",
      scope: ["markup.inserted", "markup.inserted.diff", "meta.diff.header.to-file"],
      settings: { foreground: "#E394DC" },
    },
    {
      name: "Diff Deleted",
      scope: ["markup.deleted", "markup.deleted.diff", "meta.diff.header.from-file"],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Diff Changed",
      scope: ["markup.changed", "markup.changed.diff"],
      settings: { foreground: "#EFB080" },
    },
  ],
} as const satisfies CustomDiffThemeRegistration;

export const LIGHT_DIFF_THEME = {
  name: DIFF_THEME_NAMES.light,
  type: "light",
  colors: {
    "diffEditor.insertedLineBackground": "#00AF6624",
    "diffEditor.insertedTextBackground": "#00B06838",
    "diffEditor.removedLineBackground": "#FF617B38",
    "diffEditor.removedTextBackground": "#FF617B57",
    "editor.background": "#FCFCFC",
    "editor.foreground": "#141414EB",
    "editorLineNumber.foreground": "#14141499",
    foreground: "#141414EB",
    "gitDecoration.addedResourceForeground": "#1F8A65",
    "gitDecoration.deletedResourceForeground": "#B3003F",
    "gitDecoration.modifiedResourceForeground": "#DB704B",
    "terminal.ansiBlue": "#206595",
    "terminal.ansiCyan": "#6F9BA6",
    "terminal.ansiGreen": "#1F8A65",
    "terminal.ansiRed": "#CF2D56",
    "terminal.ansiYellow": "#A33900",
  },
  semanticHighlighting: true,
  semanticTokenColors: {
    "builtinConstant.readonly.builtin:python": "#6F9BA6",
    "class.builtin": "#6F9BA6",
    "class.typeHint": "#6F9BA6",
    "function.builtin": "#6F9BA6",
    function: "#DB704B",
    "function.declaration": "#DB704B",
    macro: "#1F8A65",
    "method.declaration": "#DB704B",
    property: "#6049B3",
    selfParameter: "#B8448B",
    type: "#206595",
    "variable.constant": "#206595",
  },
  settings: [
    {
      name: "Comments",
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: "#141414AD", fontStyle: "italic" },
    },
    {
      name: "Strings",
      scope: ["string", "punctuation.definition.string.begin", "punctuation.definition.string.end"],
      settings: { foreground: "#9E94D5" },
    },
    {
      name: "Keywords",
      scope: "keyword",
      settings: { foreground: "#B3003F" },
    },
    {
      name: "Storage",
      scope: ["storage", "storage.type"],
      settings: { foreground: "#B3003F" },
    },
    {
      name: "Special Operators",
      scope: [
        "keyword.operator.expression.delete",
        "keyword.operator.expression.in",
        "keyword.operator.expression.instanceof",
        "keyword.operator.expression.keyof",
        "keyword.operator.expression.of",
        "keyword.operator.expression.typeof",
        "keyword.operator.expression.void",
        "keyword.operator.new",
        "keyword.operator.optional",
        "keyword.operator.ternary",
      ],
      settings: { foreground: "#206595" },
    },
    {
      name: "Operators",
      scope: ["keyword.operator.arithmetic", "keyword.operator.assignment"],
      settings: { foreground: "#141414EB" },
    },
    {
      name: "Functions",
      scope: ["entity.name.function", "meta.require", "support.function", "variable.function"],
      settings: { foreground: "#DB704B" },
    },
    {
      name: "Numbers",
      scope: "constant.numeric",
      settings: { foreground: "#B8448B" },
    },
    {
      name: "Variables",
      scope: "variable.other.readwrite",
      settings: { foreground: "#206595" },
    },
    {
      name: "Properties",
      scope: ["support.variable.property", "variable.other.property", "variable.other.property.ts"],
      settings: { foreground: "#6049B3" },
    },
    {
      name: "Punctuation",
      scope: "punctuation.separator.delimiter",
      settings: { foreground: "#141414EB" },
    },
  ],
} as const satisfies CustomDiffThemeRegistration;

type DiffThemeRegistrationGlobal = typeof globalThis & {
  __honkDiffThemesRegistered?: boolean;
};

const diffThemeRegistrationGlobal = globalThis as DiffThemeRegistrationGlobal;

// Registration is idempotent: the module-load call runs once, and callers that
// build options through `buildDiffOptions` re-assert it so a lazily imported
// consumer never hands Pierre an unregistered theme name.
export function ensureDiffThemesRegistered(): void {
  if (diffThemeRegistrationGlobal.__honkDiffThemesRegistered === true) return;
  registerCustomTheme(DIFF_THEME_NAMES.dark, () => Promise.resolve(DARK_DIFF_THEME));
  registerCustomTheme(DIFF_THEME_NAMES.light, () => Promise.resolve(LIGHT_DIFF_THEME));
  diffThemeRegistrationGlobal.__honkDiffThemesRegistered = true;
}

ensureDiffThemesRegistered();

export function resolveDiffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

export const WORKBENCH_DIFF_LINE_HEIGHT = 20;

// Pierre's default diff colors are derived through color-mix(). The unsafe
// layer consumes Honk's concrete generated variables instead.
export const PIERRE_DIFF_THEME_CSS = `
:host {
  --diffs-bg: var(--honk-color-bg-base);
  --diffs-bg-buffer: var(--honk-color-bg-base);
  --diffs-bg-context: var(--honk-color-bg-base);
  --diffs-bg-context-gutter: var(--honk-color-bg-base);
  /* Tint collapsed context with the translucent editor-widget surface. */
  --diffs-bg-separator: color-mix(in srgb, var(--honk-color-layer-01) 60%, transparent);
  --diffs-fg: var(--honk-color-text-primary);
  /* Line numbers use the base editor foreground at 60% alpha. Honk's
     --honk-color-text-faint carries a different alpha, so pin the mix here. */
  --diffs-fg-number: light-dark(
    color-mix(in srgb, #141414 60%, transparent),
    color-mix(in srgb, #E4E4E4 60%, transparent)
  );
  /* The gutter cells use the editor's inserted and removed line fallbacks.
     Pierre composes --diffs-bg-addition/-deletion from these override hooks. */
  --diffs-bg-addition-override: rgba(155, 185, 85, 0.3);
  --diffs-bg-deletion-override: rgba(255, 0, 0, 0.3);
  --diffs-addition-base: var(--honk-color-diff-gutter-addition);
  --diffs-deletion-base: var(--honk-color-diff-gutter-deletion);
  --diffs-modified-base: var(--honk-color-diff-gutter-modification);
  --diffs-bg-addition-emphasis: var(--honk-color-diff-text-addition);
  --diffs-bg-deletion-emphasis: var(--honk-color-diff-text-deletion);
  /* Keep gutter and code row backgrounds contiguous. Pierre's default border
     reads as a vertical gap, especially across changed rows. */
  --diffs-gap-style: none;
  --diffs-min-number-column-width: 36px;
  --diffs-font-family: var(--honk-font-family-mono);
  --diffs-header-font-family: var(--honk-font-family-ui);
  --diffs-font-size: var(--honk-font-size-code);
  /* The diff body is 20px; the shared --honk-leading-code is 18px and is used
     elsewhere, so force the diff-only line height without repointing it. */
  --diffs-line-height: ${WORKBENCH_DIFF_LINE_HEIGHT}px;
}

[data-line-type="change-addition"][data-line],
[data-line-type="change-addition"][data-no-newline],
[data-line-type="change-addition"][data-column-number],
[data-line-type="change-addition"][data-gutter-buffer] {
  --diffs-line-bg: var(--honk-color-diff-line-addition);
}

[data-line-type="change-deletion"][data-line],
[data-line-type="change-deletion"][data-no-newline],
[data-line-type="change-deletion"][data-column-number],
[data-line-type="change-deletion"][data-gutter-buffer] {
  --diffs-line-bg: var(--honk-color-diff-line-deletion);
}
`;

export const WORKBENCH_CODE_UNSAFE_CSS = `
  :host {
    min-width: 0;
    max-width: 100%;
  }

  [data-file],
  [data-diff] {
    min-width: 0;
    max-width: 100%;
  }

  [data-code],
  [data-content],
  [data-gutter] {
    min-width: 0;
  }

  [data-code] {
    line-height: var(--diffs-line-height, ${WORKBENCH_DIFF_LINE_HEIGHT}px);
  }

  [data-line] {
    min-height: var(--diffs-line-height, ${WORKBENCH_DIFF_LINE_HEIGHT}px);
  }

  /* The 2px edge accent mixes the git-decoration hue 60% into the editor
     background instead of using the full-strength gutter color. */
  [data-line-type='change-addition']:is([data-column-number], [data-gutter-buffer]) {
    background:
      linear-gradient(
        to right,
        color-mix(in srgb, var(--honk-color-diff-gutter-addition) 60%, var(--honk-color-bg-base)) 0 2px,
        var(--diffs-bg-addition) 2px 100%
      );
  }

  [data-line-type='change-deletion']:is([data-column-number], [data-gutter-buffer]) {
    background:
      linear-gradient(
        to right,
        color-mix(in srgb, var(--honk-color-diff-gutter-deletion) 60%, var(--honk-color-bg-base)) 0 2px,
        var(--diffs-bg-deletion) 2px 100%
      );
  }

  /* The +/- glyph sits in a fixed 16px column ahead of the code, centered and
     semibold. Pierre reserves 2ch in "classic" mode and draws the glyph as a
     ::before on the content line. */
  [data-indicators='classic'] [data-line] {
    padding-inline-start: 16px;
  }

  [data-indicators='classic']
    :is([data-line-type='change-addition'], [data-line-type='change-deletion']):is([data-line], [data-no-newline])::before {
    width: 16px;
    text-align: center;
    font-weight: 600;
  }

  [data-indicators='classic'] [data-line-type='change-addition']:is([data-line], [data-no-newline])::before {
    color: light-dark(#1F8A65, #70B489);
  }

  [data-indicators='classic'] [data-line-type='change-deletion']:is([data-line], [data-no-newline])::before {
    color: light-dark(#B3003F, #FC6B83);
  }

  /* Collapsed context uses italic, dimmed text. Pierre owns the label wording
     ("N unmodified lines"). */
  [data-separator='line-info-basic'] :is([data-separator-content], [data-unmodified-lines]) {
    font-style: italic;
    color: color-mix(in srgb, var(--honk-color-text-muted) 60%, transparent);
  }

  /* The unified gutter carries two number columns (original, then modified).
     Pierre emits a single gutter cell whose number is the modified one
     for context and added rows and the original one for deleted rows, so
     buildDiffOptions writes the missing counterpart to data-alt-number and it is
     painted as a pseudo column: ::before adds the leading original column, and
     deleted rows instead reserve the trailing modified column with ::after.
     Split mode already shows one column per side, and its recycled cells can
     still carry a stale data-alt-number, so the rules stay scoped to unified
     ("single") rendering. */
  [data-diff-type='single'] [data-column-number][data-alt-number] {
    font-variant-numeric: tabular-nums;
  }

  [data-diff-type='single']
    [data-column-number][data-alt-number]:not([data-line-type='change-deletion'])::before {
    content: attr(data-alt-number);
    display: inline-block;
    min-width: 36px;
    margin-inline-end: 1ch;
    text-align: right;
    color: var(--diffs-fg-number);
  }

  [data-diff-type='single']
    [data-column-number][data-alt-number][data-line-type='change-deletion']::after {
    content: '';
    display: inline-block;
    min-width: 36px;
    margin-inline-start: 1ch;
  }
`;

export const PIERRE_DIFF_OPTIONS = {
  diffStyle: "unified",
  diffIndicators: "classic",
  disableBackground: true,
  disableFileHeader: true,
  // Skipped context is a static count row with no git @@ header or expand
  // affordance. "line-info-basic" is Pierre's flat collapsed-count separator;
  // partial patches render it without expand buttons.
  hunkSeparators: "line-info-basic",
  lineDiffType: "word",
  overflow: "scroll",
  unsafeCSS: PIERRE_DIFF_THEME_CSS,
} satisfies FileDiffOptions<undefined>;

export function buildDiffOptions(
  theme: "light" | "dark",
  diffStyle: "unified" | "split",
  wordWrap = false,
  patch?: string,
): FileDiffOptions<undefined> {
  ensureDiffThemesRegistered();
  const options = {
    ...PIERRE_DIFF_OPTIONS,
    diffStyle,
    overflow: wordWrap ? "wrap" : "scroll",
    theme: resolveDiffThemeName(theme),
    themeType: theme,
    preferredHighlighter: "shiki-js",
    unsafeCSS: `${PIERRE_DIFF_THEME_CSS}\n${WORKBENCH_CODE_UNSAFE_CSS}`,
  } satisfies FileDiffOptions<undefined>;
  // Split mode already renders one number column per side, and without the patch
  // text the counterpart numbers are unknowable, so both cases keep Pierre's
  // single-column gutter rather than guessing at them.
  if (patch === undefined || diffStyle !== "unified") return options;
  const originalByModified = contextOriginalsByModified(parseUnifiedPatchRows(patch));
  return {
    ...options,
    onPostRender: (node, _instance, phase) => {
      if (phase === "unmount") return;
      applyGutterAltNumbers(node, originalByModified);
    },
  };
}

export type DiffGutterRow = {
  kind: "context" | "addition" | "deletion";
  originalLineNumber: number | undefined;
  modifiedLineNumber: number | undefined;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// One row per rendered unified line, in gutter order: context rows carry both
// numbers, deletions only the original, additions only the modified. Collapsed
// gaps between hunks produce no row because their lines are absent from the
// patch.
export function parseUnifiedPatchRows(patch: string): DiffGutterRow[] {
  const rows: DiffGutterRow[] = [];
  let originalLineNumber = 0;
  let modifiedLineNumber = 0;
  let insideHunk = false;
  // The patch's own terminating newline would otherwise split into a phantom
  // trailing context line.
  for (const line of (patch.endsWith("\n") ? patch.slice(0, -1) : patch).split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      originalLineNumber = Number(header[1]);
      modifiedLineNumber = Number(header[2]);
      insideHunk = true;
      continue;
    }
    if (!insideHunk) continue;
    // "\ No newline at end of file" annotates the previous row instead of
    // adding one.
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      rows.push({
        kind: "addition",
        originalLineNumber: undefined,
        modifiedLineNumber,
      });
      modifiedLineNumber += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({
        kind: "deletion",
        originalLineNumber,
        modifiedLineNumber: undefined,
      });
      originalLineNumber += 1;
      continue;
    }
    // Git writes context lines with a leading space; an entirely empty line is
    // a context line whose trailing space was stripped. Anything else (the next
    // file's "diff --git" header) ends the hunk.
    if (line.length > 0 && !line.startsWith(" ")) {
      insideHunk = false;
      continue;
    }
    rows.push({ kind: "context", originalLineNumber, modifiedLineNumber });
    originalLineNumber += 1;
    modifiedLineNumber += 1;
  }
  return rows;
}

// Only context rows need a lookup: Pierre already prints the modified number for
// them, and change rows leave their counterpart column blank.
function contextOriginalsByModified(rows: DiffGutterRow[]): Map<number, number> {
  return new Map(
    rows.flatMap((row) =>
      row.kind === "context" && row.modifiedLineNumber !== undefined
        ? [[row.modifiedLineNumber, row.originalLineNumber ?? 0] as const]
        : [],
    ),
  );
}

// Keyed off each cell's own number instead of its position, so re-running on the
// "update" phase, collapsed context, and partial re-renders all stay aligned.
// Pierre hands onPostRender the shadow HOST, so the walk must enter shadowRoot:
// querySelectorAll on the host cannot see the rendered gutter.
function applyGutterAltNumbers(node: HTMLElement, originalByModified: Map<number, number>): void {
  (node.shadowRoot ?? node).querySelectorAll("[data-column-number]").forEach((cell) => {
    const lineType = cell.getAttribute("data-line-type");
    const original =
      lineType === "context" || lineType === "context-expanded"
        ? originalByModified.get(Number(cell.getAttribute("data-column-number")))
        : undefined;
    cell.setAttribute("data-alt-number", original === undefined ? "" : `${original}`);
  });
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

// The transcript's edit card. A collapsed card shows about four code rows,
// so context is trimmed to one line while collapsed and three when opened,
// and disclosure is offered only when there is more than the preview shows.
export const COLLAPSED_PATCH_ROWS = 4;
export const COLLAPSED_PATCH_CONTEXT_LINES = 1;
export const EXPANDED_PATCH_CONTEXT_LINES = 3;

/**
 * A patch prepared for rendering, or the honest fallback. Pierre owns the
 * parse; a patch it cannot read is shown raw under a plain reason rather
 * than dropped, because a silent empty card would hide a real edit.
 */
export type RenderablePatch =
  | { readonly kind: "patch"; readonly text: string; readonly rows: number }
  | { readonly kind: "raw"; readonly text: string; readonly reason: string };

export function renderablePatch(patch: string, contextLines: number): RenderablePatch | null {
  const source = patch.trim();
  if (source.length === 0) return null;
  try {
    const prepared = trimPatchContext(source, contextLines);
    const files = parsePatchFiles(prepared, buildPatchCacheKey(prepared), true).flatMap(
      (parsed) => parsed.files,
    );
    const rows = files.reduce(
      (total, file) => total + file.hunks.reduce((sum, hunk) => sum + hunk.unifiedLineCount, 0),
      0,
    );
    return files.length > 0
      ? { kind: "patch", text: prepared, rows }
      : { kind: "raw", text: source, reason: "Unsupported diff format. Showing raw patch." };
  } catch {
    return { kind: "raw", text: source, reason: "Failed to parse diff. Showing raw patch." };
  }
}

/** Whether an edit has more to show than its collapsed preview already does. */
export function patchExceedsPreview(patch: string): boolean {
  const renderable = renderablePatch(patch, EXPANDED_PATCH_CONTEXT_LINES);
  if (renderable === null) return false;
  return renderable.kind === "raw"
    ? renderable.text.split("\n").length > COLLAPSED_PATCH_ROWS
    : renderable.rows > COLLAPSED_PATCH_ROWS;
}

export function buildPatchCacheKey(patch: string, scope = "diff-rendering"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}
