// T-RAPTOR-06〜10: pickup_type / drop_off_type の扱い（docs/10 2.5.1節、docs/17 T-26）
//
// 背景: routerは pickup_type / drop_off_type を一切読んでいなかった（docs/17 T-26）。
//   - 値1（乗車不可／降車不可）を無視していたのは正しさの問題
//   - 値2（要電話予約）を無視していたのは「予約が必要な移動手段を案内する」という
//     中核主張と正面から矛盾する機能欠落（実データで27フィード・962便が該当、T-27）
import { describe, expect, it } from "vitest";
import { loadShard, plan } from "../src/index.js";
import { buildShard } from "./helpers/build-shard.js";

const DATE = 20260707; // DEFAULT_DATE(2026-07-07)のYYYYMMDD表現

// 座標は徒歩圏（800m）に入らない程度に離す（緯度0.05度≒5.5km）
const S = (id: string, i: number) => ({ id, lat: 35.0 + i * 0.05, lon: 139.0 });

/** A(10:00) → B(10:10) → C(10:20) の1便のみを持つシャード */
function lineShard(opts: { pickupTypes?: number[]; dropOffTypes?: number[] }) {
  return buildShard({
    stops: [S("A", 0), S("B", 1), S("C", 2)],
    trips: [
      {
        tripId: "t1",
        routeId: "r1",
        stops: ["A", "B", "C"],
        times: [36000, 36600, 37200],
        ...(opts.pickupTypes ? { pickupTypes: opts.pickupTypes } : {}),
        ...(opts.dropOffTypes ? { dropOffTypes: opts.dropOffTypes } : {}),
      },
    ],
  });
}

function planAtoC() {
  return plan({
    origin: { kind: "stopId", stopId: "A" },
    destination: { kind: "stopId", stopId: "C" },
    departureTime: 35000,
    serviceDate: DATE,
  });
}

describe("T-RAPTOR-06: pickup_type=1 の停留所では乗車できない", () => {
  it("Aがpickup_type=1のとき、A発の経路は成立しない", () => {
    loadShard(lineShard({ pickupTypes: [1, 0, 0] }));
    expect(planAtoC()).toHaveLength(0);
  });

  it("Bがpickup_type=1でも、A発C着は影響を受けない", () => {
    loadShard(lineShard({ pickupTypes: [0, 1, 0] }));
    const r = planAtoC();
    expect(r).toHaveLength(1);
    expect(r[0]!.summary.arrivalTime).toBe(37200);
  });
});

describe("T-RAPTOR-07: drop_off_type=1 の停留所では降車できない", () => {
  it("Cがdrop_off_type=1のとき、C着の経路は成立しない", () => {
    loadShard(lineShard({ dropOffTypes: [0, 0, 1] }));
    expect(planAtoC()).toHaveLength(0);
  });

  it("Bがdrop_off_type=1でも、C着は成立する（Bで降りないため）", () => {
    loadShard(lineShard({ dropOffTypes: [0, 1, 0] }));
    const r = planAtoC();
    expect(r).toHaveLength(1);
    expect(r[0]!.summary.arrivalTime).toBe(37200);
  });
});

describe("T-RAPTOR-08: pickup_type=2 は乗車可能だが要電話予約として示す", () => {
  it("経路は成立し、乗車レッグにboardingRequirement=phone_agencyが付く", () => {
    loadShard(lineShard({ pickupTypes: [2, 0, 0] }));
    const r = planAtoC();
    expect(r).toHaveLength(1);
    const leg = r[0]!.legs.find((l) => l.kind === "transit");
    expect(leg).toBeDefined();
    if (leg?.kind !== "transit") throw new Error("transit legが無い");
    expect(leg.boardingRequirement).toBe("phone_agency");
    expect(leg.alightingRequirement).toBeUndefined();
  });

  it("要電話予約を含む行程は requiresBooking=true になる", () => {
    loadShard(lineShard({ pickupTypes: [2, 0, 0] }));
    expect(planAtoC()[0]!.summary.requiresBooking).toBe(true);
  });
});

describe("T-RAPTOR-09: pickup_type=3 は運転手との調整として示す（予約ではない）", () => {
  it("boardingRequirement=coordinate_with_driver、requiresBookingは立たない", () => {
    loadShard(lineShard({ pickupTypes: [3, 0, 0] }));
    const r = planAtoC();
    expect(r).toHaveLength(1);
    const leg = r[0]!.legs.find((l) => l.kind === "transit");
    if (leg?.kind !== "transit") throw new Error("transit legが無い");
    expect(leg.boardingRequirement).toBe("coordinate_with_driver");
    expect(r[0]!.summary.requiresBooking).toBe(false);
  });
});

describe("T-RAPTOR-10: drop_off_type=2/3 は降車側の手続きとして示す", () => {
  it("drop_off_type=2 で alightingRequirement=phone_agency・requiresBooking=true", () => {
    loadShard(lineShard({ dropOffTypes: [0, 0, 2] }));
    const r = planAtoC();
    expect(r).toHaveLength(1);
    const leg = r[0]!.legs.find((l) => l.kind === "transit");
    if (leg?.kind !== "transit") throw new Error("transit legが無い");
    expect(leg.alightingRequirement).toBe("phone_agency");
    expect(leg.boardingRequirement).toBeUndefined();
    expect(r[0]!.summary.requiresBooking).toBe(true);
  });

  it("drop_off_type=3 は coordinate_with_driver で requiresBookingは立たない", () => {
    loadShard(lineShard({ dropOffTypes: [0, 0, 3] }));
    const r = planAtoC();
    const leg = r[0]!.legs.find((l) => l.kind === "transit");
    if (leg?.kind !== "transit") throw new Error("transit legが無い");
    expect(leg.alightingRequirement).toBe("coordinate_with_driver");
    expect(r[0]!.summary.requiresBooking).toBe(false);
  });

  it("pickup_type=0/空 のときは何のフラグも付かない（既存挙動の非回帰）", () => {
    loadShard(lineShard({}));
    const r = planAtoC();
    const leg = r[0]!.legs.find((l) => l.kind === "transit");
    if (leg?.kind !== "transit") throw new Error("transit legが無い");
    expect(leg.boardingRequirement).toBeUndefined();
    expect(leg.alightingRequirement).toBeUndefined();
    expect(r[0]!.summary.requiresBooking).toBe(false);
  });
});
