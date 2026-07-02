// T-R-DUR-00〜03: 瑞穂町ケースの具体値（docs/13 10.1節の実測値をそのままアサーションに使う）
import { describe, expect, it } from "vitest";
import { loadShard, plan, RouterInputError } from "../src/index.js";
import { DEFAULT_ESTIMATOR_PARAMS, estimateDurationFromDistance } from "../src/flex.js";
import { internalShardOf } from "../src/load-shard.js";
import { estimateFlexDuration } from "../src/flex.js";
import { haversineMeters } from "../src/geo.js";
import { buildMizuhoShard, TUESDAY } from "./helpers/mizuho-shard.js";

describe("T-R-DUR-00: パラメータ計算の単体検証（距離2.0kmの仮想例）", () => {
  it("2000mの推定所要時間が約758.18秒（≒12.6分、約13分）になる", () => {
    const sec = estimateDurationFromDistance(DEFAULT_ESTIMATOR_PARAMS, 2000);
    // drivingDurationSec = 2000 × 1.4 / (22000/3600) ≒ 458.18秒、+300秒 = 758.18秒
    expect(sec).toBeCloseTo(758.18, 1);
    expect(Math.abs(sec / 60 - 12.636)).toBeLessThan(0.1); // 許容誤差0.1分以内
  });
});

describe("T-R-DUR-01: 殿ケ谷会館→みずほ病院の所要時間推定", () => {
  it("実測Haversine距離2005.5m・推定759.4秒（±1秒）", () => {
    const handle = loadShard(buildMizuhoShard());
    const shard = internalShardOf(handle);
    const from = 0; // stop_id=1 殿ケ谷会館
    const to = 36; // stop_id=37 みずほ病院

    const dist = haversineMeters(
      shard.stopLat[from]!,
      shard.stopLon[from]!,
      shard.stopLat[to]!,
      shard.stopLon[to]!,
    );
    expect(dist).toBeCloseTo(2005.5, 0);

    const sec = estimateFlexDuration(DEFAULT_ESTIMATOR_PARAMS, shard, from, to);
    expect(Math.abs(sec - 759.4)).toBeLessThanOrEqual(1);
  });
});

describe("T-R-DUR-02: 火曜10:00発、booking締切の複合検証", () => {
  it("時間窓通過・締切09:30・feasible=true・message完全一致", () => {
    loadShard(buildMizuhoShard());
    const itineraries = plan({
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: 36000, // 10:00
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 32400 }, // 探索基準時刻 09:00
    });

    expect(itineraries.length).toBeGreaterThan(0);
    const flexItinerary = itineraries.find((i) => i.legs.some((l) => l.kind === "flex"));
    expect(flexItinerary).toBeDefined();

    const leg = flexItinerary!.legs.find((l) => l.kind === "flex")!;
    expect(leg.kind).toBe("flex");
    if (leg.kind !== "flex") return;
    // tDropoff = 36000 + 759.4 ≒ 36759.4秒（≒10:12:39）
    expect(Math.abs(leg.arrivalTime - 36759.4)).toBeLessThanOrEqual(2);
    // deadlineSec = 36000 - 30*60 = 34200秒（09:30:00）
    expect(leg.booking.deadline).toBe(34200);
    expect(leg.booking.phoneNumber).toBe("050-2030-2630");
    // 注: docs/13 10.1節は「message列の内容（電話番号含む）」と記すが、実データのmessage列に
    // 電話番号は含まれない（phone_number列に分離されている）。docs/17 C-17に記録。
    // messageはそのまま（言い換え・要約なし）提示されることを検証する。
    expect(leg.booking.message).toBe(
      "ご利用の30分前までに予約が必要で、電話予約は8:30から16:30まで、オンライン予約は24時間受付",
    );
  });
});

describe("T-R-DUR-03: 予約締切切れ", () => {
  it("探索基準時刻9:45では締切(09:30)超過のためFlexレッグが返らない", () => {
    loadShard(buildMizuhoShard());
    const itineraries = plan({
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: 36000,
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 35100 }, // 09:45 > 09:30
    });
    expect(itineraries.filter((i) => i.legs.some((l) => l.kind === "flex"))).toHaveLength(0);
  });
});

describe("RouterInputError", () => {
  it("エクスポートされている（分類済みエラー型）", () => {
    expect(RouterInputError).toBeDefined();
  });
});
