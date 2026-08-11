import babel from "@rolldown/plugin-babel";
import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";

// oxlint-disable-next-line no-control-regex -- rolldown virtual module id
const rolldownRuntimeModulePattern = new RegExp("^\\u0000rolldown/runtime\\.js$");

// main.tsx paints a static shell, then reaches the application through one
// dynamic import("./start-app"). Preload that chunk and its static imports
// from the HTML so fetch and decode overlap the shell paint instead of
// starting only after main.tsx executes.
function preloadStartAppChunk(): Plugin {
  return {
    name: "honk:preload-start-app",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const bundle = context.bundle;
        if (bundle === undefined) return;
        const startApp = Object.values(bundle).find(
          (output) =>
            output.type === "chunk" && output.facadeModuleId?.endsWith("src/start-app.tsx"),
        );
        if (startApp === undefined || startApp.type !== "chunk") return;
        return [startApp.fileName, ...startApp.imports]
          .filter((fileName) => !html.includes(fileName))
          .map<HtmlTagDescriptor>((fileName) => ({
            tag: "link",
            attrs: { rel: "modulepreload", crossorigin: true, href: `/${fileName}` },
            injectTo: "head",
          }));
      },
    },
  };
}

// Match packages/ui plugin order. StyleX before React, Tailwind after. optimizeDeps.exclude
// for raw-source @honk/ui is mandatory. Forgetting it silently drops all StyleX styles.
export default defineConfig({
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      // StyleX aggregates rules into one CSS asset. Keep them on the eagerly loaded entry
      // stylesheet instead of whichever lazy chunk Rollup happens to emit first.
      cssInjectionTarget: (fileName) => /(?:^|\/)index(?:-[^/]+)?\.css$/.test(fileName),
      // Pin lightningcss like @honk/ui so light-dark() tokens still resolve under Shell color-scheme.
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
    babel({
      // plugin-babel only auto-enables TS/JSX for CWD-relative globs. Workspace packages need this.
      exclude: [/[/\\]node_modules[/\\]/, rolldownRuntimeModulePattern],
      parserOpts: { plugins: ["typescript", "jsx"] },
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    preloadStartAppChunk(),
  ],
  optimizeDeps: {
    exclude: ["@honk/ui"],
  },
  resolve: {
    // @honk/ui is raw workspace source and keeps its own preview React install. The app must
    // always resolve UI primitives and Base UI onto the renderer's React singleton.
    dedupe: ["react", "react-dom"],
    // Prefer TS over stale generated .js siblings for extensionless imports.
    extensions: [".tsx", ".ts", ".mts", ".jsx", ".js", ".mjs", ".json"],
  },
  worker: {
    format: "es",
  },
  // Pin IPv4 loopback. Desktop probes 127.0.0.1 while Node may otherwise bind ::1-only.
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
