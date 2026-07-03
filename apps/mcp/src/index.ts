// @norishiro/mcp エントリポイント（docs/14）。Cloud Run上でMCPサーバーを起動する。
//
// 環境変数:
//   NORISHIRO_ASSET_BASE_URL … シャード・credits.jsonの配信元（Firebase Hosting等、必須）
//   PORT                     … リッスンポート（Cloud Runが注入。既定8080）

import { createHttpServer } from "./http.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { SHARD_REGISTRY } from "./registry.js";
import { ShardCache } from "./shard-cache.js";
import { HttpShardSource } from "./shard-source.js";
import type { ToolContext } from "./tools.js";

export { callTool, createMcpServer, SERVER_INFO } from "./server.js";
export { createHttpServer } from "./http.js";
export { FixedWindowRateLimiter } from "./rate-limit.js";
export { ShardCache } from "./shard-cache.js";
export { HttpShardSource, type ShardSource } from "./shard-source.js";
export type { ToolContext } from "./tools.js";

function main(): void {
  const baseUrl = process.env.NORISHIRO_ASSET_BASE_URL;
  if (baseUrl === undefined || baseUrl === "") {
    console.error(
      "環境変数NORISHIRO_ASSET_BASE_URLが未設定です。シャード配信元（例: https://<firebase-hosting-domain>）を指定してください。",
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? "8080");
  const source = new HttpShardSource(baseUrl);
  const cache = new ShardCache(source);
  const ctx: ToolContext = { cache, source };

  // コールドスタート時の事前ロード（docs/14 4.1節）。バックボーンシャードはI-6で導入予定の
  // ため、v1はレジストリ先頭のシャードをベストエフォートで温める（失敗しても起動は継続）。
  const first = SHARD_REGISTRY[0];
  if (first !== undefined) {
    cache.get(first).catch((e: unknown) => {
      console.error(`シャード事前ロードに失敗（初回リクエスト時に再試行）: ${String(e)}`);
    });
  }

  const server = createHttpServer(ctx, new FixedWindowRateLimiter());
  server.listen(port, () => {
    console.log(`norishiro MCP server listening on :${String(port)} (POST /mcp)`);
  });
}

// テストからのimport時には起動しない（Cloud Run/CLI実行時のみmainを走らせる）
if (process.env.VITEST === undefined) {
  main();
}
