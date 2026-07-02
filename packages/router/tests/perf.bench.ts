// 性能ベースライン計測（docs/16 6.3節・docs/13 9章）。
// 実行: pnpm --filter @norishiro/router exec vitest bench --run
// 結果はpackages/router/PERF.mdに記録する（I-6でのシャード実測サイズ確定後に都道府県実データで再計測する）。
import { bench, describe } from "vitest";
import type { Shard } from "@norishiro/types";
import { isochrone, loadShard, plan } from "../src/index.js";
import { buildShard, type StopSpec, type TripSpec } from "./helpers/build-shard.js";
import { buildMizuhoShard, TUESDAY } from "./helpers/mizuho-shard.js";

const DATE = 20260707;

// --- 瑞穂町規模（stop数120、Flexグループ1、固定路線なし） ---
const mizuhoShard = buildMizuhoShard();

describe("瑞穂町規模", () => {
  bench("loadShard(瑞穂町)", () => {
    loadShard(mizuhoShard);
  });

  bench("loadShard+plan() stopId→stopId（Flexレッグ1本）", () => {
    loadShard(mizuhoShard);
    plan({
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: 36000,
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 32400 },
    });
  });

  bench("loadShard+plan() 座標→座標（アクセス解決込み）", () => {
    loadShard(mizuhoShard);
    plan({
      origin: { kind: "coord", lat: 35.76512, lon: 139.36366 },
      destination: { kind: "coord", lat: 35.77551, lon: 139.34549 },
      departureTime: 36000,
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 32400 },
    });
  });

  bench("loadShard+isochrone() cutoffs=[900,1800,3600]", () => {
    loadShard(mizuhoShard);
    isochrone({ kind: "stopId", stopId: "1" }, 36000, [900, 1800, 3600]);
  });
});

// --- 都道府県規模の合成シャード（docs/13 9.2節の想定値: stop数1万・trip数5万・平均trip長10） ---
// 100×100グリッド（間隔約550m）に停留所を置き、行・列方向の系統が交差点で接続するネットワーク。
function buildPrefectureScaleShard(): Shard {
  const GRID = 100;
  const stops: StopSpec[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      stops.push({ id: `s${y}_${x}`, lat: 35 + y * 0.005, lon: 139 + x * 0.005 });
    }
  }

  const trips: TripSpec[] = [];
  let tripNo = 0;
  // 各行・各列を10停留所区間ごとに区切った系統（100行+100列 × 10区間 = 2000系統相当）
  // 各系統に25本のtrip（10分間隔）→ 約5万trip・stop_times 50万行
  for (let line = 0; line < GRID; line++) {
    for (let seg = 0; seg < GRID; seg += 10) {
      const rowStops = Array.from({ length: 10 }, (_, i) => `s${line}_${seg + i}`);
      const colStops = Array.from({ length: 10 }, (_, i) => `s${seg + i}_${line}`);
      for (let n = 0; n < 25; n++) {
        const dep = 6 * 3600 + n * 600; // 06:00から10分間隔
        const mk = (stopIds: string[], routeId: string): TripSpec => ({
          tripId: `t${tripNo++}`,
          routeId,
          stops: stopIds,
          times: stopIds.map((_, i) => dep + i * 120), // 停留所間2分
        });
        trips.push(mk(rowStops, `row${line}_${seg}`));
        trips.push(mk(colStops, `col${line}_${seg}`));
      }
    }
  }
  return buildShard({ stops, trips });
}

const prefShard = buildPrefectureScaleShard();
const prefHandle = loadShard(prefShard); // ロードは1回のみ（キャッシュ済み前提の計測、確定済み設計判断6）

describe("都道府県規模（合成: stop 1万・trip 5万・stop_times 50万）", () => {
  bench(
    "loadShard(合成シャード)",
    () => {
      loadShard(prefShard);
    },
    { iterations: 3, warmupIterations: 1 },
  );

  bench("plan() 対角横断（セグメント制で到達不可＝6ラウンド全展開の負荷計測）", () => {
    void prefHandle;
    plan({
      origin: { kind: "stopId", stopId: "s0_0" },
      destination: { kind: "stopId", stopId: "s99_99" },
      departureTime: 6 * 3600 + 600,
      serviceDate: DATE,
      maxTransfers: 6,
    });
  });

  bench("plan() 近距離（同一系統内）", () => {
    plan({
      origin: { kind: "stopId", stopId: "s10_10" },
      destination: { kind: "stopId", stopId: "s10_19" },
      departureTime: 6 * 3600 + 600,
      serviceDate: DATE,
    });
  });
});
