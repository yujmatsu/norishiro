// テスト用のShardSource実装。Firebase Hostingの代わりにapps/web/public配下の
// 実ファイル（瑞穂町シャード・credits.json）を読む。フィクスチャの正はapps/webと共有する。

import type { Shard } from "@norishiro/types";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolError } from "../src/errors.js";
import { ShardCache } from "../src/shard-cache.js";
import type { CreditManifest, ShardSource } from "../src/shard-source.js";
import type { ToolContext } from "../src/tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const webPublic = join(here, "..", "..", "web", "public");

export function readMizuhoShard(): Shard {
  return JSON.parse(readFileSync(join(webPublic, "shards", "13-mizuho.json"), "utf8")) as Shard;
}

export class StaticShardSource implements ShardSource {
  fetchShardCalls = 0;

  fetchShard(shardId: string): Promise<Shard> {
    this.fetchShardCalls += 1;
    if (shardId !== "13-mizuho") {
      return Promise.reject(
        new ToolError("DATA_NOT_AVAILABLE", "この地域のデータは現在整備されていません。"),
      );
    }
    return Promise.resolve(readMizuhoShard());
  }

  fetchCredits(): Promise<CreditManifest> {
    return Promise.resolve(
      JSON.parse(readFileSync(join(webPublic, "credits.json"), "utf8")) as CreditManifest,
    );
  }
}

export function makeCtx(): ToolContext {
  const source = new StaticShardSource();
  return { cache: new ShardCache(source), source };
}
