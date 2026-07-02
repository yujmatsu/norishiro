// T-FLEX-01〜05: Flex統合のテスト（docs/13 10.3節）
import { describe, expect, it } from "vitest";
import { loadShard, plan } from "../src/index.js";
import { internalShardOf } from "../src/load-shard.js";
import { ensureRound, initialize } from "../src/raptor.js";
import { isFlexServiceActive, scanFlexLegs } from "../src/flex.js";
import { buildShard } from "./helpers/build-shard.js";
import { buildMizuhoShard, THURSDAY, TUESDAY, WEDNESDAY } from "./helpers/mizuho-shard.js";

describe("T-FLEX-01: 中間地点無視の直接レッグ化（構造レベル検証）", () => {
  it("グループ分割フィクスチャでも各グループの停留所集合に中間経由の概念が入らない", () => {
    const handle = loadShard(
      buildShard({
        stops: [
          { id: "z1a", lat: 35.0, lon: 139.0 },
          { id: "z1b", lat: 35.001, lon: 139.0 },
          { id: "z2a", lat: 35.1, lon: 139.0 },
          { id: "z3a", lat: 35.2, lon: 139.0 },
          { id: "z3b", lat: 35.201, lon: 139.0 },
        ],
        flexGroups: [
          { groupId: "g1", memberStops: ["z1a", "z1b"] },
          { groupId: "g2", memberStops: ["z2a"] },
          { groupId: "g3", memberStops: ["z3a", "z3b"] },
        ],
        flexTrips: [
          {
            tripId: "f1",
            routeId: "rf",
            groupId: "g1",
            windowStartSec: 28800,
            windowEndSec: 64800,
          },
          {
            tripId: "f2",
            routeId: "rf",
            groupId: "g2",
            windowStartSec: 28800,
            windowEndSec: 50400,
          },
          {
            tripId: "f3",
            routeId: "rf",
            groupId: "g3",
            windowStartSec: 36000,
            windowEndSec: 64800,
          },
        ],
      }),
    );
    const shard = internalShardOf(handle);
    const flex = shard.flex!;
    // g1の停留所集合は{z1a, z1b}のみ（stopIdx 0,1）。他グループの停留所が混入しない
    const g1Stops = Array.from(
      flex.groupStops.slice(flex.groupStopsStart[0]!, flex.groupStopsStart[1]!),
    );
    expect(g1Stops.sort()).toEqual([0, 1]);
    const g3Stops = Array.from(
      flex.groupStops.slice(flex.groupStopsStart[2]!, flex.groupStopsStart[3]!),
    );
    expect(g3Stops.sort()).toEqual([3, 4]);
  });
});

describe("T-FLEX-02: 時間窓外での不採用", () => {
  it("18:00発ではwindowEnd=17:00を超えるためFlexレッグが返らない", () => {
    loadShard(buildMizuhoShard());
    const result = plan({
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: 64800, // 18:00
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 60000 },
    });
    expect(result.filter((i) => i.legs.some((l) => l.kind === "flex"))).toHaveLength(0);
  });
});

describe("T-FLEX-03: 運行日外", () => {
  it("水曜はeast_tripが非アクティブ（west_tripはアクティブ）", () => {
    const handle = loadShard(buildMizuhoShard());
    const shard = internalShardOf(handle);
    expect(isFlexServiceActive(shard, 0, WEDNESDAY)).toBe(false); // east_trip（火金土）
    expect(isFlexServiceActive(shard, 1, WEDNESDAY)).toBe(true); // west_trip（月水土）
  });

  it("木曜（両サービス非運行）はFlexレッグが1件も返らない", () => {
    loadShard(buildMizuhoShard());
    const result = plan({
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: 36000,
      serviceDate: THURSDAY,
      searchTime: { serviceDate: THURSDAY, nowSec: 32400 },
    });
    expect(result).toHaveLength(0);
  });
});

describe("T-FLEX-04: グループ内総当たりの網羅性", () => {
  it("120停留所グループで到達可能な119停留所全てが評価・更新される", () => {
    const handle = loadShard(buildMizuhoShard());
    const shard = internalShardOf(handle);
    const state = initialize(
      shard,
      { reachableStops: [{ stopIdx: 0, walkSec: 0, distanceM: 0 }] },
      36000,
    );
    ensureRound(state, 1, shard.stopCount);
    const outMarked = new Set<number>();
    scanFlexLegs(
      shard,
      [0],
      state,
      1,
      { serviceDate: TUESDAY, searchTime: { serviceDate: TUESDAY, nowSec: 32400 } },
      outMarked,
      Infinity,
    );
    // 起点(stopIdx=0)以外の119停留所全てに到達時刻が書き込まれる
    expect(outMarked.size).toBe(119);
    for (const stopIdx of outMarked) {
      expect(state.tauRounds[1]![stopIdx]).toBeLessThan(Infinity);
    }
  });
});

describe("T-FLEX-05: Flexレッグの乗換回数消費", () => {
  it("maxTransfers=0ではFlexレッグが返らず、1以上で返る（roundを1つ消費する）", () => {
    loadShard(buildMizuhoShard());
    const base = {
      origin: { kind: "stopId", stopId: "1" } as const,
      destination: { kind: "stopId", stopId: "37" } as const,
      departureTime: 36000,
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 32400 },
    };
    const withZeroRounds = plan({ ...base, maxTransfers: 0 });
    expect(withZeroRounds.filter((i) => i.legs.some((l) => l.kind === "flex"))).toHaveLength(0);

    const withOneRound = plan({ ...base, maxTransfers: 1 });
    expect(withOneRound.filter((i) => i.legs.some((l) => l.kind === "flex"))).toHaveLength(1);
  });
});
