// 経路探索Web Worker（docs/11 3章(a): 探索はWorker内で実行し、サーバーへ探索リクエストを送らない）。
// fetch＋JSON.parseはWorker（呼び出し側）の責務で、@norishiro/routerは環境非依存のまま使う（docs/13 9.4節）。
// 地点名検索（docs/15 3.2節）もシャードを保持するWorker側で行い、stop一覧をメインスレッドへ送らない。
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
import { searchStopList, type StopCandidate } from "../lib/stop-search.js";

export type WorkerRequest =
  | { id: number; type: "plan"; req: PlanRequest }
  | {
      id: number;
      type: "isochrone";
      origin: LocationRef;
      departureTime: number;
      cutoffs: number[];
    }
  | { id: number; type: "searchStops"; query: string; limit: number }
  | { id: number; type: "stopNames"; stopIds: string[] };

export type WorkerResult = Itinerary[] | IsochroneResult | StopCandidate[] | Record<string, string>;

export type WorkerResponse =
  | { type: "ready"; shardId: string; calendarWindow: { from: string; to: string } }
  | { type: "init-error"; error: string }
  | { id: number; type: "result"; ok: true; result: WorkerResult }
  | { id: number; type: "result"; ok: false; error: string };

const SHARD_URL = "/shards/13-mizuho.json";

const post = (message: WorkerResponse): void => {
  self.postMessage(message);
};

let ready = false;
let stops: StopCandidate[] = [];
let stopNameById = new Map<string, string>();

async function init(): Promise<void> {
  try {
    const res = await fetch(SHARD_URL);
    if (!res.ok) {
      throw new Error(`シャード取得に失敗しました (HTTP ${res.status})`);
    }
    const shardJson = (await res.json()) as Shard;
    loadShard(shardJson);
    stops = shardJson.stops.stopId.map((stopId, i) => ({
      stopId,
      name: shardJson.stops.stopName[i] ?? stopId,
      lat: shardJson.stops.lat[i] ?? 0,
      lon: shardJson.stops.lon[i] ?? 0,
    }));
    stopNameById = new Map(stops.map((s) => [s.stopId, s.name]));
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

function handle(msg: WorkerRequest): WorkerResult {
  switch (msg.type) {
    case "plan":
      return plan(msg.req);
    case "isochrone":
      return isochrone(msg.origin, msg.departureTime, msg.cutoffs);
    case "searchStops":
      return searchStopList(stops, msg.query, msg.limit);
    case "stopNames": {
      const names: Record<string, string> = {};
      for (const stopId of msg.stopIds) {
        const name = stopNameById.get(stopId);
        if (name !== undefined) names[stopId] = name;
      }
      return names;
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void (async () => {
    const msg = event.data;
    await initPromise;
    if (!ready) {
      post({ id: msg.id, type: "result", ok: false, error: "シャードが読み込まれていません" });
      return;
    }
    try {
      post({ id: msg.id, type: "result", ok: true, result: handle(msg) });
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
