// 経路探索Web Worker（docs/11 3章(a): 探索はWorker内で実行し、サーバーへ探索リクエストを送らない）。
// fetch＋JSON.parseはWorker（呼び出し側）の責務で、@norishiro/routerは環境非依存のまま使う（docs/13 9.4節）。
// 地点名検索・座標解決・Flexエリア停留所群（docs/15 3.2節・3.4節）もシャードを保持するWorker側で行い、
// stop一覧全体をメインスレッドへ送らない。
import {
  isochrone,
  loadShard,
  plan,
  type IsochroneOptions,
  type IsochroneResult,
  type Itinerary,
  type LocationRef,
  type PlanRequest,
} from "@norishiro/router";
import type { Shard } from "@norishiro/types";
import type { LatLon } from "../lib/geo-hull.js";
import { searchStopList, type StopCandidate } from "../lib/stop-search.js";

export interface StopPoint {
  name: string;
  lat: number;
  lon: number;
}

export type WorkerRequest =
  | { id: number; type: "plan"; req: PlanRequest }
  | {
      id: number;
      type: "isochrone";
      origin: LocationRef;
      departureTime: number;
      cutoffs: number[];
      options?: IsochroneOptions;
    }
  | { id: number; type: "searchStops"; query: string; limit: number }
  | { id: number; type: "stopPoints"; stopIds: string[] }
  | { id: number; type: "flexAreaStops"; locationGroupId: string }
  | { id: number; type: "routeNames"; routeIds: string[] };

export type WorkerResult =
  | Itinerary[]
  | IsochroneResult
  | StopCandidate[]
  | Record<string, StopPoint>
  | Record<string, string>
  | LatLon[];

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
let stopPointById = new Map<string, StopPoint>();
let flexGroupStops = new Map<string, LatLon[]>();
let routeNameById = new Map<string, string>();

function buildIndexes(shardJson: Shard): void {
  stops = shardJson.stops.stopId.map((stopId, i) => ({
    stopId,
    name: shardJson.stops.stopName[i] ?? stopId,
    lat: shardJson.stops.lat[i] ?? 0,
    lon: shardJson.stops.lon[i] ?? 0,
  }));
  stopPointById = new Map(stops.map((s) => [s.stopId, { name: s.name, lat: s.lat, lon: s.lon }]));

  flexGroupStops = new Map();
  if (shardJson.flex !== null) {
    const groups = shardJson.flex.locationGroups;
    groups.locationGroupId.forEach((groupId, gi) => {
      const points = (groups.memberStopIdx[gi] ?? [])
        .map((stopIdx) => ({
          lat: shardJson.stops.lat[stopIdx] ?? 0,
          lon: shardJson.stops.lon[stopIdx] ?? 0,
        }))
        .filter((pt) => pt.lat !== 0 || pt.lon !== 0);
      flexGroupStops.set(groupId, points);
    });
  }

  routeNameById = new Map(
    shardJson.routes.routeId.map((routeId, ri) => {
      const short = shardJson.routes.routeShortName[ri] ?? "";
      const long = shardJson.routes.routeLongName[ri] ?? "";
      return [routeId, short !== "" ? short : long !== "" ? long : routeId];
    }),
  );
}

async function init(): Promise<void> {
  try {
    const res = await fetch(SHARD_URL);
    if (!res.ok) {
      throw new Error(`シャード取得に失敗しました (HTTP ${res.status})`);
    }
    const shardJson = (await res.json()) as Shard;
    loadShard(shardJson);
    buildIndexes(shardJson);
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

function pickRecord<T>(map: Map<string, T>, keys: string[]): Record<string, T> {
  const record: Record<string, T> = {};
  for (const key of keys) {
    const value = map.get(key);
    if (value !== undefined) record[key] = value;
  }
  return record;
}

function handle(msg: WorkerRequest): WorkerResult {
  switch (msg.type) {
    case "plan":
      return plan(msg.req);
    case "isochrone":
      return isochrone(msg.origin, msg.departureTime, msg.cutoffs, msg.options);
    case "searchStops":
      return searchStopList(stops, msg.query, msg.limit);
    case "stopPoints":
      return pickRecord(stopPointById, msg.stopIds);
    case "flexAreaStops":
      return flexGroupStops.get(msg.locationGroupId) ?? [];
    case "routeNames":
      return pickRecord(routeNameById, msg.routeIds);
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
