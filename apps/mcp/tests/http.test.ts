// HTTP層の統合テスト（T-MCP-15〜T-MCP-17）。Streamable HTTPトランスポート経由で
// 公式SDKクライアントから接続し、ツール一覧・呼び出し・レート制限429を検証する。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../src/http.js";
import { FixedWindowRateLimiter } from "../src/rate-limit.js";
import { makeCtx } from "./helpers.js";

function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe("HTTPサーバー（Streamable HTTP）", () => {
  const server = createHttpServer(makeCtx(), new FixedWindowRateLimiter(1000, 60000));
  let port = 0;

  beforeAll(async () => {
    port = await listen(server);
  });
  afterAll(() => {
    server.close();
  });

  it("T-MCP-15: SDKクライアントから接続し6ツールが列挙・呼び出しできる", async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(port)}/mcp`)),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "get_booking_rules",
        "get_isochrone",
        "list_data_sources",
        "list_flex_services",
        "plan_journey",
        "search_stops",
      ]);
      const res = await client.callTool({ name: "list_data_sources", arguments: {} });
      expect(res.isError).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("T-MCP-16: /mcp以外は404、GETは405を返す", async () => {
    const notFound = await fetch(`http://127.0.0.1:${String(port)}/other`);
    expect(notFound.status).toBe(404);
    const get = await fetch(`http://127.0.0.1:${String(port)}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });
});

describe("レート制限（HTTP 429）", () => {
  it("T-MCP-17: 上限超過はHTTP 429とRetry-Afterヘッダを返す", async () => {
    const server = createHttpServer(makeCtx(), new FixedWindowRateLimiter(2, 60000));
    const port = await listen(server);
    try {
      const post = (): Promise<Response> =>
        fetch(`http://127.0.0.1:${String(port)}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "t", version: "0" },
            },
          }),
        });
      expect((await post()).status).toBeLessThan(429);
      expect((await post()).status).toBeLessThan(429);
      const third = await post();
      expect(third.status).toBe(429);
      expect(Number(third.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    } finally {
      server.close();
    }
  });
});
