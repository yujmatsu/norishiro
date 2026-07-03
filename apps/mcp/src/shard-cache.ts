// 都道府県シャードの遅延ロード＋LRUキャッシュ（docs/14 4.2節、最大3シャード）。
//
// packages/routerは「最後にloadShard()したシャード」をplan()/isochrone()の対象とする
// 暫定方式（docs/13 11.2節U-3）のため、キャッシュはシャードJSON原本を保持し、対象シャードが
// アクティブでない場合はloadShard()を再実行して切り替える。plan()/isochrone()は同期関数で
// あり、切り替えから実行までの間にawaitを挟まないことで並行リクエスト下でも整合を保つ。
// v1のレジストリは1シャードのみで、切り替え再構築は実際には発生しない。

import { loadShard } from "@norishiro/router";
import type { Shard } from "@norishiro/types";
import type { ShardRegistryEntry } from "./registry.js";
import type { ShardSource } from "./shard-source.js";
import { buildStopIndex, type StopIndex } from "./stop-index.js";

export interface LoadedShard {
  entry: ShardRegistryEntry;
  raw: Shard;
  index: StopIndex;
}

const MAX_CACHED_SHARDS = 3;

export class ShardCache {
  /** Mapの挿入順をLRU順として使う（アクセス時にdelete→setで末尾へ移動） */
  private readonly cache = new Map<string, LoadedShard>();
  private readonly inflight = new Map<string, Promise<LoadedShard>>();
  private activeShardId: string | null = null;

  constructor(private readonly source: ShardSource) {}

  /** シャードを取得（キャッシュ→なければfetch）。同時要求は単一fetchに合流させる */
  async get(entry: ShardRegistryEntry): Promise<LoadedShard> {
    const hit = this.cache.get(entry.shardId);
    if (hit !== undefined) {
      this.cache.delete(entry.shardId);
      this.cache.set(entry.shardId, hit);
      return hit;
    }
    const pending = this.inflight.get(entry.shardId);
    if (pending !== undefined) return pending;

    const task = (async (): Promise<LoadedShard> => {
      const raw = await this.source.fetchShard(entry.shardId);
      const loaded: LoadedShard = { entry, raw, index: buildStopIndex(raw) };
      while (this.cache.size >= MAX_CACHED_SHARDS) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
        if (this.activeShardId === oldest) this.activeShardId = null;
      }
      this.cache.set(entry.shardId, loaded);
      return loaded;
    })();
    this.inflight.set(entry.shardId, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(entry.shardId);
    }
  }

  /**
   * 対象シャードをrouterのアクティブシャードにした上でfnを同期実行する。
   * fn内でawaitしないこと（アクティブシャードが差し替わる可能性があるため）。
   */
  runWithActive<T>(loaded: LoadedShard, fn: () => T): T {
    if (this.activeShardId !== loaded.entry.shardId) {
      loadShard(loaded.raw);
      this.activeShardId = loaded.entry.shardId;
    }
    return fn();
  }
}
