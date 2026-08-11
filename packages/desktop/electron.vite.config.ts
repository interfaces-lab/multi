import babel from "@rolldown/plugin-babel";
import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import pkg from "./package.json" with { type: "json" };

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");
const appDir = resolve(repoRoot, "packages/app");
const desktopOutDir = resolve(currentDir, "out");

const port = Number(process.env.PORT ?? 5733);
const host = process.env.HOST?.trim() || "localhost";
const sourcemapEnv = process.env.HONK_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "1" || sourcemapEnv === "true"
    ? true
    : sourcemapEnv === "hidden"
      ? "hidden"
      : false;

// Playwright's selector runtime lives as an encoded string literal inside coreBundle.js.
// Scrape it here so the app embeds the source instead of shipping the 13MB package.
// Playwright is pinned exactly; these markers are private, so a shape change fails the build.
function extractPlaywrightInjectedSource(): string {
  const nodeRequire = createRequire(import.meta.url);
  const packageJsonPath = nodeRequire.resolve("playwright-core/package.json");
  const coreBundle = readFileSync(join(dirname(packageJsonPath), "lib/coreBundle.js"), "utf8");

  // source4 is InjectedScript. source3 is UtilityScript and is NOT interchangeable.
  const marker = "source4 = ";
  const start = coreBundle.indexOf(marker);
  if (start < 0 || coreBundle.indexOf(marker, start + marker.length) >= 0) {
    throw new Error("Expected exactly one Playwright injected runtime marker.");
  }
  const literalStart = start + marker.length;
  const literalEnd = coreBundle.indexOf(";\n  }\n});", literalStart);
  if (literalEnd < 0) {
    throw new Error("Playwright injected runtime terminator was not found.");
  }

  const source: unknown = runInNewContext(
    coreBundle.slice(literalStart, literalEnd),
    Object.create(null),
    { timeout: 1_000 },
  );
  if (typeof source !== "string" || source.length < 100_000) {
    throw new Error("Playwright injected runtime literal is not a plausible source string.");
  }
  if (!source.includes("module.exports") || !source.includes("InjectedScript")) {
    throw new Error("Playwright injected runtime source is missing its InjectedScript export.");
  }
  return source;
}

const playwrightInjectedSource = extractPlaywrightInjectedSource();

const reactCompilerBabelPlugin = await babel({
  exclude: [/node_modules/],
  parserOpts: { plugins: ["typescript", "jsx"] },
  presets: [reactCompilerPreset()],
});

export default defineConfig({
  main: {
    define: {
      __HONK_PLAYWRIGHT_INJECTED_SOURCE__: JSON.stringify(playwrightInjectedSource),
    },
    build: {
      outDir: "out/main",
      sourcemap: buildSourcemap,
      emptyOutDir: true,
      externalizeDeps: {
        // Bundle pure JavaScript so electron-builder does not copy entire dependency source trees.
        // The PTY wrapper stays external because it selects a platform-native package at runtime.
        exclude: ["@effect/platform-node", "effect", "electron-updater"],
        include: ["@lydell/node-pty"],
      },
      lib: {
        entry: "src/main/index.ts",
        formats: ["es"],
      },
      rolldownOptions: {
        output: {
          entryFileNames: "index.js",
          chunkFileNames: "[name]-[hash].js",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      sourcemap: buildSourcemap,
      emptyOutDir: true,
      lib: {
        entry: { index: "src/preload/index.ts" },
        formats: ["cjs"],
      },
      rolldownOptions: {
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "[name]-[hash].cjs",
        },
      },
    },
  },
  renderer: {
    root: appDir,
    plugins: [
      stylex.vite({
        useCSSLayers: true,
        // StyleX aggregates rules into one CSS asset. Keep them on the eagerly loaded entry
        // stylesheet instead of whichever lazy chunk Rollup happens to emit first.
        cssInjectionTarget: (fileName) => /(?:^|\/)index(?:-[^/]+)?\.css$/.test(fileName),
        lightningcssOptions: {
          targets: {
            chrome: 123 << 16,
            edge: 123 << 16,
            firefox: 120 << 16,
            safari: (17 << 16) | (5 << 8),
          },
        },
      }),
      react(),
      reactCompilerBabelPlugin,
      tailwindcss(),
    ],
    optimizeDeps: {
      exclude: ["@honk/ui"],
    },
    define: {
      "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    },
    resolve: {
      // Force one React instance so hooks share a dispatcher across @honk/ui.
      dedupe: ["react", "react-dom"],
      extensions: [".tsx", ".ts", ".mts", ".jsx", ".js", ".mjs", ".json"],
    },
    server: {
      host,
      port,
      strictPort: true,
      fs: {
        allow: [repoRoot],
      },
      hmr: {
        protocol: "ws",
        host,
      },
    },
    build: {
      outDir: resolve(desktopOutDir, "renderer"),
      emptyOutDir: true,
      sourcemap: buildSourcemap,
      // Pin packages/app as the HTML entry. Default would probe desktop/src/renderer.
      rolldownOptions: {
        input: resolve(appDir, "index.html"),
      },
    },
  },
});
