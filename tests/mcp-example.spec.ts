/**
 * Protocol-level tests of the example MCP server: a real MCP client speaks
 * the protocol to the real server over an in-memory transport - exactly what
 * Claude Code does over stdio, minus the process boundary.
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../mcp/example-server.js";

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text" || first.text === undefined)
    throw new Error("expected a text content block");
  return first.text;
}

describe("course-tools MCP server", () => {
  it("lists both tools, with roll_dice requiring `sides`", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["count_letters", "roll_dice"]);

    const rollDice = tools.find((t) => t.name === "roll_dice")!;
    expect(rollDice.inputSchema.required).toContain("sides");
  });

  it("count_letters answers exactly", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "count_letters",
      arguments: { text: "Orchestration", letter: "r" },
    });
    expect(JSON.parse(textOf(result))).toEqual({ letter: "r", count: 2 });
  });

  it("roll_dice returns the asked-for number of in-range rolls and their total", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "roll_dice",
      arguments: { sides: 6, rolls: 4 },
    });
    const parsed = JSON.parse(textOf(result)) as { rolls: number[]; total: number };
    expect(parsed.rolls).toHaveLength(4);
    for (const r of parsed.rolls) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
    expect(parsed.total).toBe(parsed.rolls.reduce((a, b) => a + b, 0));
  });

  it("rejects a call that omits the required `sides`", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "roll_dice", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/sides/);
  });
});
