import { describe, expect, it } from "vitest";

import {
  CORE_CONNECTION_SCHEMA,
  decodeStoredCoreConnection,
  type StoredCoreConnection,
} from "@honk/core/access";

describe("Core connection record", () => {
  it("accepts only the current HTTPS bearer record", () => {
    const record: StoredCoreConnection = {
      schema: CORE_CONNECTION_SCHEMA,
      url: "https://laptop.example.ts.net",
      bearerToken: "secret",
      environmentId: "environment",
      computerLabel: "Laptop",
      device: { id: "phone", label: "My phone" },
    };
    expect(decodeStoredCoreConnection(JSON.stringify(record))).toEqual(record);
    expect(() =>
      decodeStoredCoreConnection(JSON.stringify({ ...record, schema: "legacy" })),
    ).toThrow("unsupported format");
    expect(() =>
      decodeStoredCoreConnection(JSON.stringify({ ...record, url: "http://laptop.local" })),
    ).toThrow("unsupported format");
  });
});
