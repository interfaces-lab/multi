import { defineConfig } from "tsdown";

export default defineConfig({
  // @honk/core is a dev dependency, so tsdown inlines the private workspace
  // package while leaving the CLI's published runtime dependencies external.
});
