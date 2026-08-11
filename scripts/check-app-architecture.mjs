#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const appSourceRoot = join(repoRoot, "packages/app/src");
const sourceRoots = [
  appSourceRoot,
  join(repoRoot, "packages/desktop/src"),
  join(repoRoot, "packages/shared/src"),
];
const maxAppSourceLines = 1_000;
// Inherited debts, not a license for new ones: files already over the limit
// when the check landed. Do not add to this list.
const oversizeFileAllowlist = new Set(["packages/app/src/workbench-changes.tsx"]);
const canonicalHelperNames = [
  "basename",
  "errorMessage",
  "newMessageId",
  "requireClient",
  "trimNonEmptyOption",
];

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (name === "node_modules") continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (/\.[cm]?tsx?$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

const findings = [];
for (const path of walk(appSourceRoot)) {
  if (oversizeFileAllowlist.has(relative(repoRoot, path))) continue;
  const lineCount = readFileSync(path, "utf8").split("\n").length;
  if (lineCount > maxAppSourceLines) {
    findings.push(
      `${relative(repoRoot, path)} has ${lineCount} lines, above the ${maxAppSourceLines}-line limit`,
    );
  }
}

const helperDefinitions = new Map(canonicalHelperNames.map((name) => [name, []]));
for (const root of sourceRoots) {
  for (const path of walk(root)) {
    const source = readFileSync(path, "utf8");
    for (const name of canonicalHelperNames) {
      const definitionPattern = new RegExp(
        `\\b(?:function\\s+${name}\\b|(?:const|let)\\s+${name}\\s*=)`,
        "g",
      );
      for (const match of source.matchAll(definitionPattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        helperDefinitions.get(name).push(`${relative(repoRoot, path)}:${line}`);
      }
    }
  }
}

for (const [name, definitions] of helperDefinitions) {
  if (definitions.length > 1) {
    findings.push(`${name} has ${definitions.length} local definitions: ${definitions.join(", ")}`);
  }
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
// main.tsx defers start-app.tsx behind a dynamic import, so a single-entry
// walk misses the app graph; both entries seed the union.
const eagerEntryFiles = ["main.tsx", "start-app.tsx"].map((file) => join(appSourceRoot, file));
// Settings and its panels are eager so opening the dialog never crosses a
// chunk boundary. Route contents, including Home's composer, still load behind
// route boundaries.
const maxEagerModules = 63;
// Ceiling re-baselined at 376.3 measured + margin after making Settings eager.
// It is a ceiling, not a target for newly eager route code.
const maxEagerSourceKib = 382;
const requiredEagerModuleGroups = [
  {
    label: "instant settings module",
    files: [
      "settings.tsx",
      "settings-appearance.tsx",
      "settings-general.tsx",
      "settings-mcp.tsx",
      "settings-providers.tsx",
    ],
  },
];
const lazyModuleGroups = [
  { label: "closed overlay", files: ["command-menu.tsx", "toast.tsx"] },
  { label: "route module", files: ["chat/start-page.tsx", "chat/thread-page.tsx"] },
  // The mention menu opens on an "@" the user has not typed yet, so it rides a
  // dynamic import through prompt-menu-resource. A static import from the
  // composer would drag its @honk/ui popup graph into the first paint.
  { label: "closed composer menu", files: ["chat/prompt-menu.tsx"] },
  {
    label: "inactive workbench Files module",
    files: ["workbench-files.tsx", "workbench-file-viewer.tsx"],
  },
  {
    label: "inactive workbench Changes module",
    files: [
      "workbench-changes.tsx",
      "workbench-changes-card.tsx",
      "workbench-changes-file-tree.tsx",
    ],
  },
  { label: "inactive workbench runtime pane", files: ["browser.tsx"] },
  {
    label: "closed workbench panel module",
    files: ["workbench-panel-column.tsx", "workbench-panel-surface.tsx"],
  },
];

function resolveRelativeImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const unresolved = fileURLToPath(new URL(specifier, pathToFileURL(importer)));
  const candidates = [
    unresolved,
    ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
    ...sourceExtensions.map((extension) => `${unresolved}/index${extension}`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function staticImportSpecifiers(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const withoutTypeOnlyImports = withoutComments.replace(
    /(^|\n)\s*(?:import|export)\s+type\b[\s\S]*?\bfrom\s+["'][^"']+["'];?/g,
    "$1",
  );
  const specifiers = [];
  const staticImport =
    /(?:^|\n)\s*(?:import|export)\s+(?:[\w*$,\s{}]+\s+from\s+)?["']([^"']+)["']/g;
  for (const match of withoutTypeOnlyImports.matchAll(staticImport)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

function collectStaticGraph(entries) {
  const pending = [...entries];
  const graph = new Map();
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || graph.has(file)) continue;
    const source = readFileSync(file, "utf8");
    graph.set(file, Buffer.byteLength(source));
    for (const specifier of staticImportSpecifiers(source)) {
      const dependency = resolveRelativeImport(file, specifier);
      if (dependency !== null && dependency.startsWith(`${appSourceRoot}/`)) {
        pending.push(dependency);
      }
    }
  }
  return graph;
}

const eagerGraph = collectStaticGraph(eagerEntryFiles);
const eagerKib = [...eagerGraph.values()].reduce((total, bytes) => total + bytes, 0) / 1024;
console.log(`app architecture check: ${eagerGraph.size} eager app modules`);
console.log(`app architecture check: ${eagerKib.toFixed(1)} KiB eager app source`);

if (eagerGraph.size > maxEagerModules) {
  findings.push(`${eagerGraph.size} eager app modules, above the ${maxEagerModules}-module limit`);
}
if (eagerKib > maxEagerSourceKib) {
  findings.push(
    `${eagerKib.toFixed(1)} KiB eager app source, above the ${maxEagerSourceKib} KiB limit`,
  );
}
for (const group of requiredEagerModuleGroups) {
  for (const file of group.files) {
    const path = join(appSourceRoot, file);
    if (!eagerGraph.has(path)) {
      findings.push(`non-eager ${group.label}: ${relative(repoRoot, path)}`);
    }
  }
}
for (const group of lazyModuleGroups) {
  for (const file of group.files) {
    const path = join(appSourceRoot, file);
    if (eagerGraph.has(path)) {
      findings.push(`eager ${group.label}: ${relative(repoRoot, path)}`);
    }
  }
}

if (findings.length === 0) {
  console.log("app architecture check: 0 violations");
  process.exit(0);
}

for (const finding of findings) {
  console.error(`app architecture check: ${finding}`);
}
process.exit(1);
