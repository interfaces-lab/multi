/**
 * stylelint-config-standard + allowances for Tailwind v4/CSS entrypoints (`@tailwind`,
 * `@layer`, `@theme`, …) and for VS Code / Honk naming (`--vscode-sideBar-*`, BEM-ish
 * selectors in shell.css).
 *
 * Note: this validates `.css` only. Tailwind utilities in JSX/TSX are not linted here.
 *
 * @see https://tailwindcss.com/docs/compatibility — at-rules Tailwind emits
 */
export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: ["**/node_modules/**", "**/dist/**", "**/out/**", "packages/cli/web/**"],
  overrides: [
    {
      files: ["packages/app/src/**/*.css", "packages/ui/src/**/*.css"],
      ignoreFiles: ["**/*.module.css", "**/platform-tokens.css"],
      rules: {
        // Product component anatomy belongs to StyleX. Global CSS is reserved for the root,
        // scroll/window contracts, generated tokens, and vendor baseline imports.
        "selector-disallowed-list": [
          "/\\[data-slot(?:\\]|[~|^$*]?=)/",
          "/\\[data-sonner-/",
          "/\\.xterm(?:\\b|[.:\\[])/",
        ],
      },
    },
    {
      files: ["packages/app/src/**/*.module.css", "packages/ui/src/**/*.module.css"],
      rules: {
        // Scoped third-party adapters still consume theme variables. Literal paint values would
        // fork the palette from theme.ts and fail dark/native parity.
        "declaration-property-value-disallowed-list": {
          "/^(?:background|background-color|border(?:-.*)?-color|box-shadow|color|outline-color)$/":
            ["/#[0-9a-f]{3,8}\\b/i", "/\\b(?:hsl|hsla|lab|lch|oklch|rgb|rgba)\\(/i"],
        },
      },
    },
  ],
  rules: {
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          "apply",
          "custom-variant",
          "layer",
          "theme",
          "utility",
          "variant",
          "config",
          "plugin",
          "source",
          "reference",
          "scope",
          "supports",
          "starting-style",
        ],
      },
    ],
    "function-no-unknown": [
      true,
      {
        ignoreFunctions: [
          "calc",
          "color-mix",
          "hsl",
          "hsla",
          "hwb",
          "lab",
          "lch",
          "light-dark",
          "max",
          "min",
          "oklch",
          "rgba",
          "rgb",
          "round",
          "theme",
          "var",
          "--spacing",
        ],
      },
    ],
    "import-notation": null,
    "media-query-no-invalid": null,
    "rule-empty-line-before": null,
    "custom-property-pattern": null,
    "selector-class-pattern": null,
    "lightness-notation": null,
    "hue-degree-notation": null,
    "alpha-value-notation": null,
    "color-function-alias-notation": null,
    "color-function-notation": null,
    "property-no-vendor-prefix": null,
    "no-descending-specificity": null,
    "declaration-property-value-keyword-no-deprecated": null,
    "at-rule-empty-line-before": null,
    "declaration-empty-line-before": null,
    "custom-property-empty-line-before": null,
    "comment-empty-line-before": null,
    "declaration-block-no-redundant-longhand-properties": null,
    "value-keyword-case": null,
  },
};
