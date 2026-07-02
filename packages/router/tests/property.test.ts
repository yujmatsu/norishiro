// T-PROP-01〜05: プロパティテスト（docs/13 10.4節、fast-check使用）
import fc from "fast-check";
import { describe, it } from "vitest";
import { loadShard, plan, type Itinerary } from "../src/index.js";
import { DEFAULT_ESTIMATOR_PARAMS, estimateDurationBetween } from "../src/flex.js";
import { buildShard, type TripSpec } from "./helpers/build-shard.js";

const DATE = 20260707;

/** ランダムな小規模ネットワーク（stop数5〜8、trip数3〜6）の生成器 */
const networkArb = fc
  .record({
    stopCount: fc.integer({ min: 5, max: 8 }),
    tripSeeds: fc.array(
      fc.record({
        from: fc.nat({ max: 7 }),
        to: fc.nat({ max: 7 }),
        depMin: fc.integer({ min: 0, max: 300 }), // 09:00からの分
        durMin: fc.integer({ min: 5, max: 60 }),
      }),
      { minLength: 3, maxLength: 6 },
    ),
  })
  .map(({ stopCount, tripSeeds }) => {
    const stops = Array.from({ length: stopCount }, (_, i) => ({
      id: `s${i}`,
      lat: 35 + i * 0.05,
      lon: 139,
    }));
    const trips: TripSpec[] = [];
    tripSeeds.forEach((seed, n) => {
      const from = seed.from % stopCount;
      const to = seed.to % stopCount;
      if (from === to) return;
      const dep = 32400 + seed.depMin * 60;
      trips.push({
        tripId: `t${n}`,
        routeId: `r${n}`,
        stops: [`s${from}`, `s${to}`],
        times: [dep, dep + seed.durMin * 60],
      });
    });
    return { stops, trips };
  })
  .filter((n) => n.trips.length >= 2);

function bestArrival(itineraries: Itinerary[]): number {
  return itineraries.length === 0
    ? Infinity
    : Math.min(...itineraries.map((i) => i.summary.arrivalTime));
}

function planBest(a: string, b: string, dep: number, maxTransfers: number): number {
  return bestArrival(
    plan({
      origin: { kind: "stopId", stopId: a },
      destination: { kind: "stopId", stopId: b },
      departureTime: dep,
      serviceDate: DATE,
      maxTransfers,
    }),
  );
}

describe("T-PROP-01: 三角不等式的健全性", () => {
  it("τ(A→C) <= τ(A→B)経由τ(B→C)の連結", () => {
    fc.assert(
      fc.property(
        networkArb,
        fc.nat({ max: 7 }),
        fc.nat({ max: 7 }),
        fc.nat({ max: 7 }),
        (network, ai, bi, ci) => {
          const n = network.stops.length;
          const [a, b, c] = [`s${ai % n}`, `s${bi % n}`, `s${ci % n}`];
          if (a === b || b === c || a === c) return true;
          loadShard(buildShard(network));

          const t0 = 32400;
          const viaB1 = planBest(a, b, t0, 2);
          if (!Number.isFinite(viaB1)) return true;
          const viaB2 = planBest(b, c, viaB1, 2);
          if (!Number.isFinite(viaB2)) return true;

          const direct = planBest(a, c, t0, 6);
          return direct <= viaB2;
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("T-PROP-02: Pareto集合の非支配性", () => {
  it("plan()が返す任意の2要素間に支配関係がない", () => {
    fc.assert(
      fc.property(networkArb, fc.nat({ max: 7 }), fc.nat({ max: 7 }), (network, ai, ci) => {
        const n = network.stops.length;
        const [a, c] = [`s${ai % n}`, `s${ci % n}`];
        if (a === c) return true;
        loadShard(buildShard(network));
        const result = plan({
          origin: { kind: "stopId", stopId: a },
          destination: { kind: "stopId", stopId: c },
          departureTime: 32400,
          serviceDate: DATE,
        });
        for (const x of result) {
          for (const y of result) {
            if (x === y) continue;
            const dominates =
              x.summary.transferCount <= y.summary.transferCount &&
              x.summary.arrivalTime <= y.summary.arrivalTime;
            if (dominates) return false;
          }
        }
        return true;
      }),
      { numRuns: 20 },
    );
  });
});

const coordArb = fc.record({
  lat: fc.double({ min: 34, max: 37, noNaN: true }),
  lon: fc.double({ min: 138, max: 141, noNaN: true }),
});

describe("T-PROP-03: Flex推定関数の対称性", () => {
  it("estimateDuration(A,B) == estimateDuration(B,A)", () => {
    fc.assert(
      fc.property(coordArb, coordArb, (p, q) => {
        const ab = estimateDurationBetween(DEFAULT_ESTIMATOR_PARAMS, p.lat, p.lon, q.lat, q.lon);
        const ba = estimateDurationBetween(DEFAULT_ESTIMATOR_PARAMS, q.lat, q.lon, p.lat, p.lon);
        return Math.abs(ab - ba) < 1e-9;
      }),
      { numRuns: 100 },
    );
  });
});

describe("T-PROP-04: Flex推定関数の三角不等式", () => {
  // docs/13 11.2節U-4は「バッファ加算により厳密な三角不等式は成立しない可能性」を予期したが、
  // est(A,C)=drive(A,C)+300 <= drive(A,B)+drive(B,C)+300 < est(A,B)+est(B,C) となり、
  // 定数バッファはむしろ不等式を強める（成立する）。この検証結果はdocs/17 C-17に記録した。
  it("est(A,C) <= est(A,B) + est(B,C) が成立する（バッファ定数は不等式を強める）", () => {
    fc.assert(
      fc.property(coordArb, coordArb, coordArb, (a, b, c) => {
        const p = DEFAULT_ESTIMATOR_PARAMS;
        const ac = estimateDurationBetween(p, a.lat, a.lon, c.lat, c.lon);
        const ab = estimateDurationBetween(p, a.lat, a.lon, b.lat, b.lon);
        const bc = estimateDurationBetween(p, b.lat, b.lon, c.lat, c.lon);
        return ac <= ab + bc + 1e-6;
      }),
      { numRuns: 100 },
    );
  });
});

describe("T-PROP-05: 出発時刻の単調性", () => {
  it("departureTimeを後ろにずらすと最良到着時刻は同じか後ろにしかならない", () => {
    fc.assert(
      fc.property(
        networkArb,
        fc.nat({ max: 7 }),
        fc.nat({ max: 7 }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 120 }),
        (network, ai, ci, offset1Min, deltaMin) => {
          const n = network.stops.length;
          const [a, c] = [`s${ai % n}`, `s${ci % n}`];
          if (a === c) return true;
          loadShard(buildShard(network));
          const t1 = 32400 + offset1Min * 60;
          const t2 = t1 + deltaMin * 60;
          const arr1 = planBest(a, c, t1, 6);
          const arr2 = planBest(a, c, t2, 6);
          return arr1 <= arr2;
        },
      ),
      { numRuns: 20 },
    );
  });
});
