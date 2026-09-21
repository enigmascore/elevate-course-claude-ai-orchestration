/**
 * YOUR MCP server - the marked assignment's second server, alongside the
 * shipped example in mcp/example-server.ts.
 *
 * This file is the SLOT: it ships as a server that starts correctly and
 * exposes NO tools, so tests/gate/mcp-my-server.spec.ts fails on "at least one
 * tool" rather than on a missing file, and `tsc` stays green from the first
 * clone. It is already wired into Claude Code by .mcp.json as "my-tools".
 *
 * Your job (see the assignment): register at least one tool of YOUR OWN
 * design here - different from both example tools in NAME and in INPUT SHAPE,
 * with at least one REQUIRED, typed input - until the gate suite is green.
 * Read example-server.ts for the shape; do not copy its tools under new names
 * (the suite checks for that).
 *
 * Run standalone:  pnpm mcp:mine   (waits for a client on stdio)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";

export function createServer(): McpServer {
  const server = new McpServer({ name: "my-tools", version: "0.1.0" });

  // Register your tools here - server.registerTool(name, { title, description,
  // inputSchema: { ... zod fields ... } }, handler). Until you do, the server
  // is valid but empty.

  return server;
}

async function main(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  void main();
}
