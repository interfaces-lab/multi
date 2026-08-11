// A minimal stdio MCP server for lifecycle tests, modeled on
// packages/opencode/src/host-plugin/mcp-server.mjs. Dependency-free plain JS
// spawned via process.execPath.
//
// argv: server.mjs <markerFile> <label>
//
// Every boot appends "<pid>\n" to the marker file, so a test can count starts
// and check process liveness — the observable behind "an unused server never
// starts" and "a reconnect never duplicates a process".

import { appendFileSync } from "node:fs";

const [markerFile, label] = process.argv.slice(2);
appendFileSync(markerFile, `${process.pid}\n`);

const TOOLS = [
  {
    name: "echo",
    description: `Echoes text back from the ${label} fixture server.`,
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo." } },
      required: ["text"],
    },
  },
  {
    name: `${label}_echo`,
    description: `Echoes text back, offered only by the ${label} server.`,
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo." } },
      required: ["text"],
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message) {
  if (message.id === undefined || message.id === null) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: label, version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (!TOOLS.some((tool) => tool.name === name)) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: `Unknown tool: ${String(name)}` },
      });
      return;
    }
    const text = message.params?.arguments?.text;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: `${label}:${String(text)}` }] },
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Unknown method: ${String(message.method)}` },
  });
}

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // Malformed input is ignored, matching a tolerant server.
    }
  }
});
process.stdin.on("end", () => {
  process.exit(0);
});
