/**
 * The course's example MCP server: two small tools exposed over stdio.
 *
 * Wired into Claude Code by this repository's .mcp.json, so a fresh clone
 * already shows "course-tools" under /mcp. The final marked question asks
 * you to build ANOTHER server of your own design - differing in tool name
 * and input shape - next to this one.
 *
 * Run standalone:  pnpm mcp:example   (waits for a client on stdio)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";

export function createServer(): McpServer {
  const server = new McpServer({ name: "course-tools", version: "1.0.0" });

  // A tool with a REQUIRED, typed input: the model must supply `sides`.
  server.registerTool(
    "roll_dice",
    {
      title: "Roll dice",
      description:
        "Roll one or more dice and return each roll and the total. `sides` is required.",
      inputSchema: {
        sides: z.number().int().min(2).describe("Number of sides per die (required)"),
        rolls: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("How many dice to roll (default 1)"),
      },
    },
    async ({ sides, rolls }) => {
      const n = rolls ?? 1;
      const results = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      const total = results.reduce((a, b) => a + b, 0);
      return {
        content: [{ type: "text", text: JSON.stringify({ rolls: results, total }) }],
      };
    },
  );

  // A second tool, deterministic, so behaviour is easy to verify.
  server.registerTool(
    "count_letters",
    {
      title: "Count letters",
      description: "Count how many times a letter occurs in a text (case-insensitive).",
      inputSchema: {
        text: z.string().min(1).describe("The text to search"),
        letter: z.string().length(1).describe("The single letter to count"),
      },
    },
    async ({ text, letter }) => {
      const target = letter.toLowerCase();
      let count = 0;
      for (const ch of text.toLowerCase()) if (ch === target) count += 1;
      return { content: [{ type: "text", text: JSON.stringify({ letter, count }) }] };
    },
  );

  return server;
}

async function main(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  void main();
}
