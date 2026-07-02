// T-RAPTOR-01〜05: RAPTOR本体のテスト（docs/13 10.2節）
import { describe, expect, it } from "vitest";
import { loadShard, plan } from "../src/index.js";
import { internalShardOf } from "../src/load-shard.js";
import { initialize, runRaptor } from "../src/raptor.js";
import { buildShard, DEFAULT_DATE } from "./helpers/build-shard.js";

const DATE = 20260707; // DEFAULT_DATE(2026-07-07)のYYYYMMDD表現

// 座標は徒歩圏（800m）に入らない程度に離す（緯度0.05度≒5.5km）
const S = (id: string, i: number) => ({ id, lat: 35.0 + i * 0.05, lon: 139.0 });

describe("T-RAPTOR-01: 初期化", () => {
  it("origin指定のstopはτ=departureTime、他は+Infinity", () => {
    const handle = loadShard(
      buildShard({
        stops: [S("A", 0), S("B", 1)],
        trips: [{ tripId: "t1", routeId: "r1", stops: ["A", "B"], times: [36000, 36600] }],
      }),
    );
    const shard = internalShardOf(handle);
    const state = initialize(
      shard,
      { reachableStops: [{ stopIdx: 0, walkSec: 0, distanceM: 0 }] },
      35000,
    );
    expect(state.tauRounds[0]![0]).toBe(35000);
    expect(state.tauRounds[0]![1]).toBe(Infinity);
  });
});

describe("T-RAPTOR-02: 単一ラウンドでの改善", () => {
  it("1trip・2停留所で正しい到着時刻が反映される", () => {
    loadShard(
      buildShard({
        stops: [S("A", 0), S("B", 1)],
        trips: [{ tripId: "t1", routeId: "r1", stops: ["A", "B"], times: [36000, 36600] }],
      }),
    );
    const result = plan({
      origin: { kind: "stopId", stopId: "A" },
      destination: { kind: "stopId", stopId: "B" },
      departureTime: 35000,
      serviceDate: DATE,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.summary.arrivalTime).toBe(36600);
    expect(result[0]!.summary.transferCount).toBe(0);
    expect(result[0]!.legs.filter((l) => l.kind === "transit")).toHaveLength(1);
  });
});

describe("T-RAPTOR-03: 乗換回数のPareto性", () => {
  it("乗換0回・遅い経路と乗換1回・速い経路の両方を返す", () => {
    loadShard(
      buildShard({
        stops: [S("A", 0), S("B", 1), S("C", 2)],
        trips: [
          // 直通（遅い）: 36000発 37800着（30分）
          { tripId: "slow", routeId: "rDirect", stops: ["A", "C"], times: [36000, 37800] },
          // 乗換あり（速い）: A→B 36300着、B→C 36600発 37200着（20分）
          { tripId: "leg1", routeId: "r1", stops: ["A", "B"], times: [36000, 36300] },
          { tripId: "leg2", routeId: "r2", stops: ["B", "C"], times: [36600, 37200] },
        ],
      }),
    );
    const result = plan({
      origin: { kind: "stopId", stopId: "A" },
      destination: { kind: "stopId", stopId: "C" },
      departureTime: 36000,
      serviceDate: DATE,
    });
    expect(result).toHaveLength(2);
    const byTransfers = new Map(
      result.map((i) => [i.summary.transferCount, i.summary.arrivalTime]),
    );
    expect(byTransfers.get(0)).toBe(37800);
    expect(byTransfers.get(1)).toBe(37200);
  });
});

describe("T-RAPTOR-04: 打ち切り", () => {
  it("markedStopsが空になったらmaxTransfers未満でもループを終える", () => {
    const handle = loadShard(
      buildShard({
        stops: [S("A", 0), S("B", 1)],
        trips: [{ tripId: "t1", routeId: "r1", stops: ["A", "B"], times: [36000, 36600] }],
      }),
    );
    const shard = internalShardOf(handle);
    const { roundsExecuted } = runRaptor(shard, {
      access: { reachableStops: [{ stopIdx: 0, walkSec: 0, distanceM: 0 }] },
      departureTime: 35000,
      serviceDate: DATE,
      maxTransfers: 6,
      searchTime: { serviceDate: -1, nowSec: 0 },
      targetPruneInit: Infinity,
    });
    // ラウンド1で改善、ラウンド2は改善なし→ラウンド3の冒頭で打ち切り
    expect(roundsExecuted).toBeLessThan(6);
  });
});

describe("T-RAPTOR-05: target pruningの健全性", () => {
  it("目的地に寄与しない高速な枝があっても最短経路の正しさに影響しない", () => {
    loadShard(
      buildShard({
        stops: [S("A", 0), S("B", 1), S("C", 2), S("D", 3)],
        trips: [
          // 目的地Cへの正解経路
          { tripId: "main", routeId: "rMain", stops: ["A", "C"], times: [36000, 37800] },
          // Cに寄与しない超高速の枝 A→D
          { tripId: "side", routeId: "rSide", stops: ["A", "D"], times: [36000, 36060] },
          // Dからさらに先へ行けるが決してCへは戻らない
          { tripId: "side2", routeId: "rSide2", stops: ["D", "B"], times: [36120, 36180] },
        ],
      }),
    );
    const result = plan({
      origin: { kind: "stopId", stopId: "A" },
      destination: { kind: "stopId", stopId: "C" },
      departureTime: 36000,
      serviceDate: DATE,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.summary.arrivalTime).toBe(37800);
  });
});

describe("補助: buildShardのデフォルト日付", () => {
  it("DEFAULT_DATEはDATE定数と整合している", () => {
    expect(DEFAULT_DATE).toBe("2026-07-07");
  });
});
