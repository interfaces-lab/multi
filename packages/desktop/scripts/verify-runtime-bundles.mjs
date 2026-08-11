import { init, parse } from "es-module-lexer";
import { readdir, readFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guards the packaged runtime graph: workspace packages must be bundled, and the only
// bare imports left in main/preload must be packages we actually ship in node_modules.
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(desktopDir, "package.json"), "utf8"));
const rendererIndexPath = resolve(desktopDir, "out/renderer/index.html");
const rendererIndex = await readFile(rendererIndexPath, "utf8").catch(() => null);

if (rendererIndex === null) {
  console.error("Desktop renderer index is missing. Remote browser access would be unavailable.");
  process.exit(1);
}

const rendererAssets = [...rendererIndex.matchAll(/(?:src|href)=["'](?:\.\/|\/)([^"']+)["']/g)].map(
  (match) => match[1],
);
if (rendererAssets.length === 0) {
  console.error("Desktop renderer index does not reference any built assets.");
  process.exit(1);
}
for (const asset of rendererAssets) {
  const available = await readFile(resolve(desktopDir, "out/renderer", asset)).then(
    () => true,
    () => false,
  );
  if (!available) {
    console.error(`Desktop renderer asset is missing: ${asset}`);
    process.exit(1);
  }
}
const rendererStylesheets = await Promise.all(
  rendererAssets
    .filter((asset) => asset.endsWith(".css"))
    .map((asset) => readFile(resolve(desktopDir, "out/renderer", asset), "utf8")),
);
if (
  !rendererStylesheets.some(
    (stylesheet) => stylesheet.includes("@layer priority1") && /\.x[a-z0-9]+\s*\{/.test(stylesheet),
  )
) {
  console.error("Desktop renderer entry stylesheets are missing compiled StyleX rules.");
  process.exit(1);
}

const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
const allDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.optionalDependencies,
};
const workspacePackages = Object.entries(allDependencies)
  .filter((entry) => entry[1].startsWith("workspace:"))
  .map((entry) => entry[0]);

// A silent no-op check is worse than no check, so refuse to pass when the set is empty.
if (workspacePackages.length === 0) {
  console.error("No workspace packages found in package.json. The bundle check would be inert.");
  process.exit(1);
}

const allowedRuntimeImports = new Set([...runtimeDependencies, "electron"]);
const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

await init;

function packageRootOf(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

async function bundleFiles(outDir) {
  const directory = resolve(desktopDir, outDir);
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(js|cjs|mjs)$/.test(entry.name))
    .map((entry) => relative(desktopDir, resolve(entry.parentPath, entry.name)));
}

const files = [...(await bundleFiles("out/main")), ...(await bundleFiles("out/preload"))];
const violations = [];

for (const file of files) {
  const source = await readFile(resolve(desktopDir, file), "utf8");
  const specifiers = file.endsWith(".cjs")
    ? [...source.matchAll(requirePattern)].map((match) => match[1])
    : parse(source)[0].flatMap((entry) => (entry.n === undefined ? [] : [entry.n]));

  for (const specifier of specifiers) {
    if (specifier.startsWith(".") || specifier.startsWith("node:") || isBuiltin(specifier)) {
      continue;
    }

    const root = packageRootOf(specifier);
    if (workspacePackages.includes(root)) {
      violations.push(`${file}: unbundled workspace import "${specifier}"`);
      continue;
    }
    if (root === "playwright-core") {
      violations.push(`${file}: playwright-core must be embedded at build time, not imported`);
      continue;
    }
    if (!allowedRuntimeImports.has(root)) {
      violations.push(`${file}: "${specifier}" is not a shipped runtime dependency`);
    }
  }
}

// Pi loads OAuth flow modules through a bundler-opaque dynamic import, so a
// bundle can silently ship without them and every interactive login fails at
// runtime (the host registers them statically via registerBunOAuthFlows).
// The Anthropic flow's fixed PKCE callback port is the cheapest stable marker
// that the flow code made it into the main bundle.
const mainSources = await Promise.all(
  files.filter((file) => file.startsWith("out/main")).map((file) => readFile(file, "utf8")),
);
if (!mainSources.some((source) => source.includes("53692"))) {
  violations.push(
    "out/main: Pi OAuth flow modules are missing from the bundle; models.login would fail in the packaged app",
  );
}

if (violations.length > 0) {
  for (const violation of new Set(violations)) console.error(violation);
  process.exit(1);
}

console.log(
  `Desktop runtime bundles are clean (${files.length} files, ${rendererAssets.length} renderer assets, runtime deps: ${runtimeDependencies.join(", ")}).`,
);
