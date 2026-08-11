import { defineConfig } from "vitest/config";

// Keep unit tests separate from the StyleX-enabled dev playground. The tests
// mock StyleX to expose semantic style values, so running the build transform
// first would replace those values with generated class names.
export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
