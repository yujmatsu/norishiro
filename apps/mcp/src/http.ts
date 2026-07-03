// HTTP層: Streamable HTTPトランスポート（docs/14 2.1節）＋IPレート制限（2.3節）。
// ステートレス運用のためセッションIDは発行せず、リクエストごとにサーバー/トランスポートを
// 生成する（SDKのステートレス構成パターン）。レート超過はツール応答に至る前段でHTTP 429。

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { FixedWindowRateLimiter } from "./rate-limit.js";
import { createMcpServer } from "./server.js";
import type { ToolContext } from "./tools.js";

const MAX_BODY_BYTES = 1024 * 1024;

function clientIp(req: IncomingMessage): string {
  // Cloud Run前段のプロキシが付与するX-Forwarded-Forの先頭（送信元に最も近い値）を鍵にする
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first !== undefined && first !== "" ? first : (req.socket.remoteAddress ?? "unknown");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: object,
  headers?: Record<string, string>,
): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function jsonRpcError(code: number, message: string): object {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

async function handleMcpPost(
  ctx: ToolContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, jsonRpcError(-32700, "Parse error: リクエストボディが不正です"));
    return;
  }
  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // ステートレス運用（docs/14 2.1節）
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function createHttpServer(ctx: ToolContext, limiter: FixedWindowRateLimiter): Server {
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/mcp") {
        sendJson(res, 404, jsonRpcError(-32000, "Not found: MCPエンドポイントはPOST /mcp"));
        return;
      }
      const decision = limiter.check(clientIp(req));
      if (!decision.allowed) {
        sendJson(
          res,
          429,
          jsonRpcError(
            -32000,
            "Too Many Requests: リクエストが多すぎます。1分ほど待って再試行してください",
          ),
          { "retry-after": String(decision.retryAfterSec) },
        );
        return;
      }
      if (req.method !== "POST") {
        // ステートレス構成のためSSEストリーム(GET)・セッション削除(DELETE)は提供しない
        sendJson(res, 405, jsonRpcError(-32000, "Method not allowed"), { allow: "POST" });
        return;
      }
      try {
        await handleMcpPost(ctx, req, res);
      } catch {
        if (!res.headersSent) {
          sendJson(res, 500, jsonRpcError(-32603, "Internal server error"));
        } else {
          res.end();
        }
      }
    })();
  });
}
