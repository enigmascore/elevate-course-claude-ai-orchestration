import { describe, expect, it } from "vitest";
import { captureFileName, parseBody, redact } from "../proxy/logproxy.js";

describe("redact", () => {
  it("masks credential headers and keeps the rest", () => {
    const out = redact({
      authorization: "Bearer sk-secret",
      "x-api-key": "sk-secret",
      cookie: "session=abc",
      "content-type": "application/json",
    });
    expect(out["authorization"]).toBe("<redacted>");
    expect(out["x-api-key"]).toBe("<redacted>");
    expect(out["cookie"]).toBe("<redacted>");
    expect(out["content-type"]).toBe("application/json");
  });
});

describe("parseBody", () => {
  it("returns null for an empty body and JSON for a JSON body", () => {
    expect(parseBody(Buffer.alloc(0))).toBeNull();
    expect(parseBody(Buffer.from('{"model":"claude-opus-5"}'), "application/json")).toEqual({
      model: "claude-opus-5",
    });
  });

  it("parses an SSE stream into one object per data: line", () => {
    const sse = [
      'data: {"type":"message_start"}',
      "",
      'data: {"type":"content_block_delta","delta":{"text":"hi"}}',
      "data: [DONE]",
    ].join("\n");
    const parsed = parseBody(Buffer.from(sse), "text/event-stream");
    expect(parsed).toMatchObject({ event_count: 3 });
    const events = (parsed as { sse_events: unknown[] }).sse_events;
    expect(events[0]).toEqual({ type: "message_start" });
    expect(events[2]).toBe("[DONE]"); // non-JSON data lines are kept verbatim
  });

  it("falls back to the raw text for non-JSON bodies", () => {
    expect(parseBody(Buffer.from("plain text"), "text/plain")).toBe("plain text");
  });
});

describe("captureFileName", () => {
  it("slugs the path and pads the sequence", () => {
    const name = captureFileName(7, "POST", "/v1/messages");
    expect(name).toMatch(/^\d{6}_007_POST_v1_messages\.json$/);
  });
});
