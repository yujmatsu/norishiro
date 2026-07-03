// MCPサーバー本体。ツールのビジネスエラーは全てisError応答へ統一し（docs/14 5.1節、
// 確定済み設計判断5）、プロトコルエラー（メソッド不明・内部例外）のみJSON-RPCエラーとする。
// SDKのMcpServer(registerTool)は入力検証失敗をJSON-RPCエラーで返すため、5章の契約
// （zod検証失敗→INVALID_INPUTのisError応答）を満たす目的で低レベルServer APIを使う。

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolError, type ToolErrorBody } from "./errors.js";
import { TOOL_DEFINITIONS, type ToolContext } from "./tools.js";

export const SERVER_INFO = { name: "norishiro-transit", version: "0.1.0" } as const;

function toJsonSchema(schema: z.ZodType): Tool["inputSchema"] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Tool["inputSchema"];
}

const TOOL_LIST: Tool[] = TOOL_DEFINITIONS.map((def) => ({
  name: def.name,
  description: def.description,
  inputSchema: toJsonSchema(def.inputSchema),
}));

function okResult(body: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: false };
}

function errorResult(body: ToolErrorBody): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
}

/** ツール呼び出しの実行（テストからも直接呼ぶ）。ToolErrorをisError応答へ変換する */
export async function callTool(
  ctx: ToolContext,
  name: string,
  args: unknown,
): Promise<CallToolResult> {
  const def = TOOL_DEFINITIONS.find((d) => d.name === name);
  if (def === undefined) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  try {
    return okResult(await def.handler(ctx, args));
  } catch (e) {
    if (e instanceof ToolError) return errorResult(e.body);
    if (e instanceof McpError) throw e;
    // 予期しない内部例外。内部詳細を漏らさない（docs/14 5.5節）
    throw new McpError(ErrorCode.InternalError, "内部エラーが発生しました。");
  }
}

/** リクエストごとに生成するMCPサーバー（ステートレス運用、docs/14 2.1節） */
export function createMcpServer(ctx: ToolContext): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOL_LIST }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(ctx, req.params.name, req.params.arguments ?? {}),
  );
  return server;
}
