/**
 * Logging proxy for Claude Code.
 *
 * Sits between the `claude` CLI and api.anthropic.com, writes every request
 * and its response to a directory, and forwards traffic unchanged.
 * Credentials are redacted in the log files but forwarded intact to
 * Anthropic.
 *
 * Usage:
 *     pnpm proxy <output-dir> [port]            # default port 8765
 *     ANTHROPIC_BASE_URL=http://127.0.0.1:8765 claude -p "..."
 *
 * Each exchange produces <output-dir>/<time>_<n>_<METHOD>_<path>.json holding
 * {"request": {...}, "response": {...}}. Streaming responses are captured
 * whole, so the reply reaches the CLI only when generation finishes; use it
 * for short headless runs, not for daily interactive work.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const UPSTREAM = "api.anthropic.com";
const REDACT = new Set(["authorization", "x-api-key", "cookie", "set-cookie"]);

export type CapturedBody =
  | null
  | string
  | Record<string, unknown>
  | { sse_events: unknown[]; event_count: number };

export function redact(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k] = REDACT.has(k.toLowerCase()) ? "<redacted>" : v;
  }
  return out;
}

export function parseBody(raw: Buffer, contentType = ""): CapturedBody {
  if (raw.length === 0) return null;
  const text = raw.toString("utf8");
  if (contentType.includes("text/event-stream")) {
    // Server-sent events: one JSON object per "data:" line.
    const events: unknown[] = [];
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      try {
        events.push(JSON.parse(payload));
      } catch {
        events.push(payload);
      }
    }
    return { sse_events: events, event_count: events.length };
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
}

export function captureFileName(seq: number, method: string, urlPath: string): string {
  const t = new Date();
  const hms = [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join("");
  const slug = urlPath.replace(/^\/+|\/+$/g, "").replaceAll("/", "_").slice(0, 50);
  return `${hms}_${String(seq).padStart(3, "0")}_${method}_${slug}.json`;
}

function main(): void {
  const outDir = process.argv[2];
  const port = process.argv[3] ? Number(process.argv[3]) : 8765;
  if (!outDir) {
    console.error("usage: pnpm proxy <output-dir> [port]");
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let seq = 0;

  const server = http.createServer((req, res) => {
    seq += 1;
    const mySeq = seq;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);

      // Forward to Anthropic with the original headers, minus hop-by-hop ones.
      const fwd: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (["host", "content-length", "accept-encoding", "connection"].includes(k.toLowerCase()))
          continue;
        fwd[k] = v;
      }
      fwd["host"] = UPSTREAM;
      if (body.length > 0) fwd["content-length"] = String(body.length);

      const started = Date.now();
      const upstream = https.request(
        { host: UPSTREAM, method: req.method, path: req.url, headers: fwd, timeout: 600_000 },
        (up) => {
          const upChunks: Buffer[] = [];
          up.on("data", (c: Buffer) => upChunks.push(c));
          up.on("end", () => {
            const data = Buffer.concat(upChunks);
            const elapsedMs = Date.now() - started;

            // Log request and response together.
            const file = path.join(outDir, captureFileName(mySeq, req.method ?? "GET", req.url ?? "/"));
            fs.writeFileSync(
              file,
              JSON.stringify(
                {
                  request: {
                    method: req.method,
                    path: req.url,
                    headers: redact(req.headers),
                    body: parseBody(body, String(req.headers["content-type"] ?? "")),
                  },
                  response: {
                    status: up.statusCode,
                    elapsed_ms: elapsedMs,
                    headers: redact(up.headers),
                    body: parseBody(data, String(up.headers["content-type"] ?? "")),
                  },
                },
                null,
                1,
              ),
            );

            // Relay the response to the CLI.
            const relayHeaders: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(up.headers)) {
              if (v === undefined) continue;
              if (["transfer-encoding", "content-length", "content-encoding", "connection"].includes(k.toLowerCase()))
                continue;
              relayHeaders[k] = v;
            }
            relayHeaders["content-length"] = String(data.length);
            res.writeHead(up.statusCode ?? 502, relayHeaders);
            res.end(data);
          });
        },
      );
      upstream.on("error", (err) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ proxy_error: String(err) }));
      });
      if (body.length > 0) upstream.write(body);
      upstream.end();
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.error(
      `logging proxy on http://127.0.0.1:${port} -> https://${UPSTREAM}, writing to ${outDir}`,
    );
  });
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  main();
}
