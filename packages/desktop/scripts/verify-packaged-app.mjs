import { extractFile, listPackage } from "@electron/asar";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MEBIBYTE = 1024 * 1024;
// Shiki's full grammar/theme bundle plus the Monaco and Ghostty renderer payload account for most
// of the ASAR. Honk needs those assets offline, so the budget leaves a small regression margin.
const MAX_ASAR_BYTES = 34 * MEBIBYTE;
const MAX_LOCALE_BYTES = 2 * MEBIBYTE;
const desktopDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

function formatMebibytes(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(1)} MiB`;
}

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

async function totalFileBytes(root) {
  const rootStat = await lstat(root);
  if (rootStat.isFile()) return rootStat.size;
  const sizes = await Promise.all(
    (await filesUnder(root)).map(async (file) => (await lstat(file)).size),
  );
  return sizes.reduce((total, bytes) => total + bytes, 0);
}

function fail(message) {
  throw new Error(`Packaged app verification failed: ${message}`);
}

export async function verifyPackagedApp(appPath) {
  const appRoot = resolve(appPath);
  const isMac = appRoot.endsWith(".app");
  const maxAppBytes = (isMac ? 260 : 325) * MEBIBYTE;
  const resourcesDir = isMac ? join(appRoot, "Contents", "Resources") : join(appRoot, "resources");
  const asarPath = join(resourcesDir, "app.asar");
  const appBytes = await totalFileBytes(appRoot);
  const asarBytes = (await lstat(asarPath)).size;
  const appFiles = await filesUnder(appRoot);
  const asarEntries = listPackage(asarPath);
  const rendererIndexEntry = "/out/renderer/index.html";
  const localeRoot = isMac
    ? join(
        appRoot,
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Versions",
        "A",
        "Resources",
      )
    : join(appRoot, "locales");
  const locales = (await readdir(localeRoot, { withFileTypes: true }))
    .filter((entry) =>
      isMac ? entry.isDirectory() && entry.name.endsWith(".lproj") : entry.isFile(),
    )
    .map((entry) => entry.name)
    .filter((name) => (isMac ? true : name.endsWith(".pak")));
  const localeBytes = (
    await Promise.all(locales.map((locale) => totalFileBytes(join(localeRoot, locale))))
  ).reduce((total, bytes) => total + bytes, 0);

  if (appBytes > maxAppBytes) {
    fail(`app is ${formatMebibytes(appBytes)}; budget is ${formatMebibytes(maxAppBytes)}`);
  }
  if (asarBytes > MAX_ASAR_BYTES) {
    fail(`app.asar is ${formatMebibytes(asarBytes)}; budget is ${formatMebibytes(MAX_ASAR_BYTES)}`);
  }
  if (localeBytes > MAX_LOCALE_BYTES || locales.length > 2) {
    fail(`Electron locales are ${formatMebibytes(localeBytes)} across ${locales.length} entries`);
  }
  if (locales.some((locale) => !/^en(?:[-_.]|$)/i.test(locale))) {
    fail(`unexpected Electron locales: ${locales.join(", ")}`);
  }
  if (!asarEntries.includes(rendererIndexEntry)) {
    fail("desktop renderer index is missing; remote browser access would be unavailable");
  }

  const rendererIndex = extractFile(asarPath, rendererIndexEntry.slice(1)).toString("utf8");
  const rendererAssets = [
    ...rendererIndex.matchAll(/(?:src|href)=["'](?:\.\/|\/)([^"']+)["']/g),
  ].map((match) => `/out/renderer/${match[1]}`);
  if (rendererAssets.length === 0) {
    fail("desktop renderer index does not reference any built assets");
  }
  const missingRendererAssets = rendererAssets.filter((asset) => !asarEntries.includes(asset));
  if (missingRendererAssets.length > 0) {
    fail(`desktop renderer assets are missing: ${missingRendererAssets.join(", ")}`);
  }
  const rendererStylesheets = rendererAssets
    .filter((asset) => asset.endsWith(".css"))
    .map((asset) => extractFile(asarPath, asset.slice(1)).toString("utf8"));
  if (
    !rendererStylesheets.some(
      (stylesheet) =>
        stylesheet.includes("@layer priority1") && /\.x[a-z0-9]+\s*\{/.test(stylesheet),
    )
  ) {
    fail("desktop renderer entry stylesheets are missing compiled StyleX rules");
  }

  const forbiddenAsarEntries = asarEntries.filter((entry) =>
    [
      /^\/node_modules\/playwright-core(?:\/|$)/,
      /^\/out\/core(?:\/|$)/,
      /^\/resources\/dmg-background/,
      /^\/resources\/entitlements\.plist$/,
      /\.map$/,
    ].some((pattern) => pattern.test(entry)),
  );
  if (forbiddenAsarEntries.length > 0) {
    fail(`forbidden ASAR content: ${forbiddenAsarEntries.slice(0, 5).join(", ")}`);
  }

  const runtimePackages = new Set(
    asarEntries.flatMap((entry) => {
      const segments = entry.split("/").filter(Boolean);
      if (segments[0] !== "node_modules" || segments.length < 3) return [];
      return [segments[1].startsWith("@") ? `${segments[1]}/${segments[2]}` : segments[1]];
    }),
  );
  const unexpectedRuntimePackages = [...runtimePackages].filter(
    (name) => name !== "@lydell/node-pty" && !name.startsWith("@lydell/node-pty-"),
  );
  if (unexpectedRuntimePackages.length > 0) {
    fail(`unexpected runtime packages: ${unexpectedRuntimePackages.join(", ")}`);
  }

  const forbiddenAppFiles = appFiles.filter((file) =>
    /(?:^|\/)node_modules\/playwright-core(?:\/|$)/.test(file),
  );
  if (forbiddenAppFiles.length > 0) {
    fail(`playwright-core package escaped the ASAR: ${forbiddenAppFiles[0]}`);
  }

  const mainSource = extractFile(asarPath, "out/main/index.js").toString("utf8");
  if (!mainSource.includes("InjectedScript") || mainSource.includes("playwright-core")) {
    fail("Playwright's injected agent runtime was not embedded cleanly");
  }

  console.log(
    [
      `Packaged app verified: ${appRoot}`,
      `  app: ${formatMebibytes(appBytes)} / ${formatMebibytes(maxAppBytes)}`,
      `  app.asar: ${formatMebibytes(asarBytes)} / ${formatMebibytes(MAX_ASAR_BYTES)}`,
      `  Electron locales: ${formatMebibytes(localeBytes)} (${locales.join(", ")})`,
      `  Web client: index plus ${rendererAssets.length} assets`,
      `  runtime packages: ${[...runtimePackages].sort().join(", ")}`,
      "  Playwright: injected runtime embedded; full package absent",
    ].join("\n"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await verifyPackagedApp(process.argv[2] ?? join(desktopDir, "dist", "mac-arm64", "Honk.app"));
}
