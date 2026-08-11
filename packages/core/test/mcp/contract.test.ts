// The wire contract: every RPC tag exists and every error carries its stable
// code. Behavior lives in the sibling files in this directory.

import { describe, expect, it } from "@effect/vitest";

import { Mcp } from "../../src/mcp";

describe("mcp contract", () => {
  it("defines typed RPCs with stable tags and error codes", () => {
    expect(Mcp.List._tag).toBe("mcp.list");
    expect(Mcp.Rpcs.requests.get("mcp.list")).toBe(Mcp.List);
    expect(Mcp.Rpcs.requests.get("mcp.status")).toBe(Mcp.Status);
    expect(Mcp.Rpcs.requests.get("mcp.connect")).toBe(Mcp.Connect);
    expect(Mcp.Rpcs.requests.get("mcp.disconnect")).toBe(Mcp.Disconnect);
    expect(Mcp.Rpcs.requests.get("mcp.add")).toBe(Mcp.Add);
    expect(Mcp.Rpcs.requests.get("mcp.update")).toBe(Mcp.Update);
    expect(Mcp.Rpcs.requests.get("mcp.remove")).toBe(Mcp.Remove);
    expect(Mcp.Rpcs.requests.get("mcp.login")).toBe(Mcp.Login);
    expect(Mcp.Rpcs.requests.get("mcp.logout")).toBe(Mcp.Logout);

    expect(new Mcp.ServerNotFoundError({ server: "x" }).code).toBe("mcp.server_not_found");
    expect(new Mcp.ServerExistsError({ server: "x" }).code).toBe("mcp.server_exists");
    expect(new Mcp.ServerDisabledError({ server: "x" }).code).toBe("mcp.server_disabled");
    expect(new Mcp.HttpUnsupportedError({ server: "x" }).code).toBe("mcp.http_unsupported");
    expect(new Mcp.OauthUnsupportedError({}).code).toBe("mcp.oauth_unsupported");
    expect(new Mcp.ConnectError({ server: "x", detail: "boom" }).code).toBe("mcp.connect_failed");
  });
});
