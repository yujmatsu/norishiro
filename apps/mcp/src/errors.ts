// エラー設計（docs/14 5章）。全ツールエラーはMCPのisError応答に統一する（確定済み設計判断5）。
// レート超過のみHTTP 429の別経路（http.ts）で、RATE_LIMITEDは予備分類として保持する。

export type ToolErrorCode =
  "INVALID_INPUT" | "DATA_NOT_AVAILABLE" | "SHARD_FETCH_FAILED" | "RATE_LIMITED";

/** ツールエラー応答のボディ（docs/14 5.3節）。textコンテンツにJSON文字列として格納する */
export interface ToolErrorBody {
  errorCode: ToolErrorCode;
  /** 利用者向け日本語メッセージ（何を直せば再試行できるかを具体的に示す、docs/14 5.2節） */
  message: string;
  /** 開発者向けの補足。内部実装の詳細（パス・スタックトレース・内部URL）は含めない（5.5節） */
  detail?: string;
  retryable: boolean;
}

const RETRYABLE: Record<ToolErrorCode, boolean> = {
  INVALID_INPUT: false,
  DATA_NOT_AVAILABLE: false,
  SHARD_FETCH_FAILED: true,
  RATE_LIMITED: true,
};

/** ツールハンドラ内で投げる分類済みエラー。server.tsがisError応答へ変換する */
export class ToolError extends Error {
  readonly body: ToolErrorBody;

  constructor(errorCode: ToolErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ToolError";
    this.body = { errorCode, message, retryable: RETRYABLE[errorCode] };
    if (detail !== undefined) this.body.detail = detail;
  }
}
