import { readFile } from "node:fs/promises";

import { UPSTREAM_VERSION } from "@honk/pi-protocol/schema";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { HONK_CORE_PROTOCOL } from "../../src/client";

const PackageManifest = Schema.Struct({
  dependencies: Schema.Record(Schema.String, Schema.String),
});

describe("Core protocol fingerprint", () => {
  it("matches both installed Pi packages and the vendored Pi protocol", async () => {
    const manifest = Schema.decodeUnknownSync(PackageManifest)(
      JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")),
    );

    expect(manifest.dependencies["@earendil-works/pi-agent-core"]).toBe(HONK_CORE_PROTOCOL.pi);
    expect(manifest.dependencies["@earendil-works/pi-ai"]).toBe(HONK_CORE_PROTOCOL.pi);
    expect(UPSTREAM_VERSION).toBe(HONK_CORE_PROTOCOL.pi);
  });

  it("keeps Pi out of the package-manager patch surface", async () => {
    const manifest = await readFile(
      new URL("../../../../pnpm-workspace.yaml", import.meta.url),
      "utf8",
    );
    const start = manifest.indexOf("\npatchedDependencies:\n");
    const end = manifest.indexOf("\n\n", start + 1);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(manifest.slice(start, end < 0 ? undefined : end)).not.toContain("@earendil-works/pi-");
  });
});
