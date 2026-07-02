// 経路探索Web Worker（docs/11 3章(a): 探索はWorker内で実行し、サーバーへ探索リクエストを送らない）。
// fetch＋JSON.parseはWorker（呼び出し側）の責務で、@norishiro/routerは環境非依存のまま使う（docs/13 9.4節）。
import {
  isochrone,
  loadShard,
  plan,
  type IsochroneResult,
  type Itinerary,
  type LocationRef,
  type PlanRequest,
} from "@norishiro/router";
import type { Shard } from "@norishiro/types";

export type WorkerRequest =
  | { id: number; type: "plan"; req: PlanRequest }
  | {
      id: number;
      type: "isochrone";
      origin: LocationRef;
      departureTime: number;
      cutoffs: number[];
    };

export type WorkerResponse =
  | { type: "ready"; shardId: string; calendarWindow: { from: string; to: string } }
  | { type: "init-error"; error: string }
  | { id: number; type: "result"; ok: true; result: Itinerary[] | IsochroneResult }
  | { id: number; type: "result"; ok: false; error: string };

const SHARD_URL = "/shards/13-mizuho.json";

const post = (message: WorkerResponse): void => {
  self.postMessage(message);
};

let ready = false;

async function init(): Promise<void> {
  try {
    const res = await fetch(SHARD_URL);
    if (!res.ok) {
      throw new Error(`シャード取得に失敗しました (HTTP ${res.status})`);
    }
    const shardJson = (await res.json()) as Shard;
    loadShard(shardJson);
    ready = true;
    post({
      type: "ready",
      shardId: shardJson.meta.shardId,
      calendarWindow: shardJson.meta.calendarWindow,
    });
  } catch (e) {
    post({ type: "init-error", error: e instanceof Error ? e.message : String(e) });
  }
}

const initPromise = init();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void (async () => {
    const msg = event.data;
    await initPromise;
    if (!ready) {
      post({ id: msg.id, type: "result", ok: false, error: "シャードが読み込まれていません" });
      return;
    }
    try {
      const result =
        msg.type === "plan" ? plan(msg.req) : isochrone(msg.origin, msg.departureTime, msg.cutoffs);
      post({ id: msg.id, type: "result", ok: true, result });
    } catch (e) {
      post({
        id: msg.id,
        type: "result",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
};
