// シャード・クレジットJSONの取得層（docs/14 4.4節）。取得元はFirebase Hostingの公開URL
// （apps/webと同一の静的ファイル）で、専用データストアは持たない（確定済み設計判断4）。
// テストではこのインターフェースをローカルファイル実装に差し替える。

import type { Shard } from "@norishiro/types";
import { ToolError } from "./errors.js";

/** docs/12 6.2節のCreditManifest（credits.json）。docs/14 3.6節がそのまま返す */
export interface CreditEntry {
  feedId: string;
  providerName: string;
  creditText: string;
  licenseId: string;
  licenseUrl: string;
  sourceUrl: string;
  challengeLimited: boolean;
  prefecture: string;
}

export interface CreditManifest {
  generatedAt: string;
  entries: CreditEntry[];
}

export interface ShardSource {
  fetchShard(shardId: string): Promise<Shard>;
  fetchCredits(): Promise<CreditManifest>;
}

const FETCH_TIMEOUT_MS = 10000;

/**
 * HTTP経由の取得実装。404は「データ未整備地域」、5xx・ネットワークエラー・タイムアウトは
 * 「シャード取得失敗」に分類する（docs/14 5.4節）。
 */
export class HttpShardSource implements ShardSource {
  constructor(private readonly baseUrl: string) {}

  private async fetchJson(path: string, notFoundMessage: string): Promise<unknown> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/${path}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new ToolError(
        "SHARD_FETCH_FAILED",
        "一時的にデータを取得できませんでした。しばらく待って再試行してください。",
        "配信元への接続に失敗（タイムアウトまたはネットワークエラー）",
      );
    }
    if (res.status === 404) {
      throw new ToolError("DATA_NOT_AVAILABLE", notFoundMessage);
    }
    if (!res.ok) {
      throw new ToolError(
        "SHARD_FETCH_FAILED",
        "一時的にデータを取得できませんでした。しばらく待って再試行してください。",
        `配信元がHTTP ${String(res.status)}を返却`,
      );
    }
    return (await res.json()) as unknown;
  }

  async fetchShard(shardId: string): Promise<Shard> {
    return (await this.fetchJson(
      `shards/${shardId}.json`,
      "この地域のデータは現在整備されていません。",
    )) as Shard;
  }

  async fetchCredits(): Promise<CreditManifest> {
    return (await this.fetchJson(
      "credits.json",
      "データ出典一覧が未配置です。しばらく待って再試行してください。",
    )) as CreditManifest;
  }
}
