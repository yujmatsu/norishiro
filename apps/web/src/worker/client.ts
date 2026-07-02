// Web WorkerへのPromiseベースRPCクライアント。UIコンポーネントはこのクラス経由で探索を呼ぶ。
import type {
  IsochroneOptions,
  IsochroneResult,
  Itinerary,
  LocationRef,
  PlanRequest,
} from "@norishiro/router";
import type { LatLon } from "../lib/geo-hull.js";
import type { StopCandidate } from "../lib/stop-search.js";
import type { StopPoint, WorkerRequest, WorkerResponse } from "./router-worker.js";

export interface ShardInfo {
  shardId: string;
  calendarWindow: { from: string; to: string };
}

export class RouterWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private readyPromise: Promise<ShardInfo>;

  constructor() {
    this.worker = new Worker(new URL("./router-worker.ts", import.meta.url), {
      type: "module",
    });
    this.readyPromise = new Promise<ShardInfo>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>): void => {
        const msg = event.data;
        if (msg.type === "ready") {
          resolve({ shardId: msg.shardId, calendarWindow: msg.calendarWindow });
        } else if (msg.type === "init-error") {
          reject(new Error(msg.error));
        } else {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            if (msg.ok) {
              entry.resolve(msg.result);
            } else {
              entry.reject(new Error(msg.error));
            }
          }
        }
      };
      this.worker.addEventListener("message", onMessage);
    });
  }

  /** シャード読み込み完了を待つ（UIのローディング表示に使う） */
  ready(): Promise<ShardInfo> {
    return this.readyPromise;
  }

  private send<T>(request: WorkerRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.worker.postMessage(request);
    });
  }

  plan(req: PlanRequest): Promise<Itinerary[]> {
    return this.send<Itinerary[]>({ id: this.nextId++, type: "plan", req });
  }

  isochrone(
    origin: LocationRef,
    departureTime: number,
    cutoffs: number[],
    options?: IsochroneOptions,
  ): Promise<IsochroneResult> {
    return this.send<IsochroneResult>({
      id: this.nextId++,
      type: "isochrone",
      origin,
      departureTime,
      cutoffs,
      options,
    });
  }

  /** 地点あいまい検索（docs/15 3.2節）。検索はシャードを保持するWorker側で行う */
  searchStops(query: string, limit = 8): Promise<StopCandidate[]> {
    return this.send<StopCandidate[]>({ id: this.nextId++, type: "searchStops", query, limit });
  }

  /** stopId→表示名・座標の解決（S4のレッグ内訳・地図描画用、docs/15 3.4節） */
  stopPoints(stopIds: string[]): Promise<Record<string, StopPoint>> {
    return this.send<Record<string, StopPoint>>({ id: this.nextId++, type: "stopPoints", stopIds });
  }

  /** Flexエリア（location_group）の停留所座標群。面表現のconvex hull入力（docs/15 3.4節） */
  flexAreaStops(locationGroupId: string): Promise<LatLon[]> {
    return this.send<LatLon[]>({ id: this.nextId++, type: "flexAreaStops", locationGroupId });
  }

  /** routeId→表示名（routeShortName優先）の解決 */
  routeNames(routeIds: string[]): Promise<Record<string, string>> {
    return this.send<Record<string, string>>({ id: this.nextId++, type: "routeNames", routeIds });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

let shared: RouterWorkerClient | undefined;

/** アプリ全体で共有する単一のWorkerクライアント（シャードの二重ロードを避ける） */
export function getRouterClient(): RouterWorkerClient {
  shared ??= new RouterWorkerClient();
  return shared;
}
