// 表示整形ユーティリティのテスト（docs/15 3.3節・7.4節: 所要・乗換数・徒歩量の3指標表示）
import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDurationMin,
  totalWalkMeters,
  walkAmountLabel,
} from "../src/lib/format.js";
import type { Leg } from "@norishiro/router";

describe("formatClock", () => {
  it("サービス日内の秒をHH:MMで表示する", () => {
    expect(formatClock(32400)).toBe("09:00");
    expect(formatClock(34200)).toBe("09:30");
    expect(formatClock(0)).toBe("00:00");
  });

  it("24時超え（GTFS方式）は翌HH:MMで表示する", () => {
    expect(formatClock(90000)).toBe("翌01:00");
  });
});

describe("formatDurationMin", () => {
  it("分単位で表示する（docs/13の実測値759.4秒→13分）", () => {
    expect(formatDurationMin(759.4)).toBe("13分");
  });

  it("60分以上は時間+分で表示する", () => {
    expect(formatDurationMin(3900)).toBe("1時間5分");
    expect(formatDurationMin(3600)).toBe("1時間");
  });

  it("1分未満は1分に切り上げる（0分と表示しない）", () => {
    expect(formatDurationMin(30)).toBe("1分");
  });
});

describe("walkAmountLabel / totalWalkMeters", () => {
  const walkLeg = (m: number): Leg => ({
    kind: "walk",
    from: { kind: "coord", lat: 0, lon: 0 },
    to: { kind: "stopId", stopId: "1" },
    departureTime: 0,
    arrivalTime: 0,
    distanceMeters: m,
  });

  it("徒歩合計距離をレッグから集計する（walk以外は無視）", () => {
    const legs: Leg[] = [
      walkLeg(120),
      {
        kind: "flex",
        locationGroupId: "g",
        tripId: "t",
        fromStopId: "1",
        toStopId: "37",
        departureTime: 0,
        arrivalTime: 759,
        booking: {},
      },
      walkLeg(80),
    ];
    expect(totalWalkMeters(legs)).toBeCloseTo(200);
  });

  it("閾値: 300m以下=少 / 800m以下=中 / それ超=多", () => {
    expect(walkAmountLabel(0)).toBe("少");
    expect(walkAmountLabel(300)).toBe("少");
    expect(walkAmountLabel(301)).toBe("中");
    expect(walkAmountLabel(800)).toBe("中");
    expect(walkAmountLabel(801)).toBe("多");
  });
});
