// 探索オーケストレーションのテスト（docs/15 4.2節・4.4節: 締切超過の検出と代替候補の提示）。
// routerは当日探索で締切超過のFlexレッグを結果から除外する（packages/router/src/flex.ts）ため、
// 「この便は予約締切を過ぎています」の検出はUI層が予約制約無視の再探索（searchTime.serviceDate=-1、
// packages/router/src/api.ts のisochroneと同じ扱い）との差分で行う。
import { describe, expect, it } from "vitest";
import type { Itinerary, PlanRequest } from "@norishiro/router";
import { runSearch, type PlanClient } from "../src/lib/search-runner.js";

const flexItinerary = (dep: number, arr: number, deadline: number | undefined): Itinerary => ({
  legs: [
    {
      kind: "flex",
      locationGroupId: "area_east",
      tripId: "t_east",
      fromStopId: "1",
      toStopId: "37",
      departureTime: dep,
      arrivalTime: arr,
      booking: { deadline, phoneNumber: "050-2030-2630" },
    },
  ],
  summary: {
    departureTime: dep,
    arrivalTime: arr,
    durationSec: arr - dep,
    transferCount: 0,
    requiresBooking: true,
  },
});

const transitItinerary = (dep: number, arr: number, transfers: number): Itinerary => ({
  legs: [
    {
      kind: "transit",
      routeId: "bus1",
      tripId: "trip1",
      fromStopId: "1",
      toStopId: "37",
      departureTime: dep,
      arrivalTime: arr,
    },
  ],
  summary: {
    departureTime: dep,
    arrivalTime: arr,
    durationSec: arr - dep,
    transferCount: transfers,
    requiresBooking: false,
  },
});

/** 呼び出しを記録し、判定関数で応答を返すフェイクPlanClient */
function fakeClient(respond: (req: PlanRequest) => Itinerary[]): PlanClient & {
  calls: PlanRequest[];
} {
  const calls: PlanRequest[] = [];
  return {
    calls,
    plan: (req) => {
      calls.push(req);
      return Promise.resolve(respond(req));
    },
  };
}

const base = {
  origin: { kind: "stopId", stopId: "1" } as const,
  destination: { kind: "stopId", stopId: "37" } as const,
  serviceDate: 20260707,
};

describe("runSearch（未来日の探索）", () => {
  it("厳密探索1回のみで締切情報つき結果を返す", async () => {
    const it1 = flexItinerary(36000, 36760, 34200);
    const client = fakeClient(() => [it1]);
    const outcome = await runSearch(client, {
      ...base,
      departureTime: 36000,
      now: { serviceDate: 20260706, nowSec: 32400 }, // 前日に検索
    });
    expect(client.calls).toHaveLength(1);
    expect(outcome.itineraries).toEqual([it1]);
    expect(outcome.missedFlex).toBeUndefined();
    expect(outcome.shiftedFlex).toBeUndefined();
  });
});

describe("runSearch（当日・Flexが予約可能）", () => {
  it("厳密探索にFlexが含まれれば追加探索しない", async () => {
    const it1 = flexItinerary(36000, 36760, 34200);
    const client = fakeClient(() => [it1]);
    const outcome = await runSearch(client, {
      ...base,
      departureTime: 36000,
      now: { serviceDate: 20260707, nowSec: 32400 }, // 9:00に当日検索
    });
    expect(client.calls).toHaveLength(1);
    expect(outcome.itineraries).toEqual([it1]);
    expect(outcome.missedFlex).toBeUndefined();
  });
});

describe("runSearch（当日・Flexが締切超過で除外されている）", () => {
  // 9:45に「今すぐ」検索。乗車9:45の便の締切は9:15（30分前）で超過済み。
  const NOW = { serviceDate: 20260707, nowSec: 35100 }; // 9:45

  it("予約制約無視の再探索で超過便を検出し、出発をずらした代替を探す", async () => {
    const missed = flexItinerary(35100, 35860, 33300); // 乗車9:45、締切9:15
    const shifted = flexItinerary(37800, 38560, 36000); // 乗車10:30、締切10:00
    const client = fakeClient((req) => {
      if (req.searchTime?.serviceDate === -1) return [missed]; // 予約制約無視
      if (req.departureTime === 35100) return []; // 厳密: Flexなし
      return [shifted]; // シフト探索
    });
    const outcome = await runSearch(client, { ...base, departureTime: 35100, now: NOW });

    expect(client.calls).toHaveLength(3);
    // シフト探索の出発時刻 = now + 事前通知時間(1800) + 余裕15分(900) を5分単位に切り上げ = 10:30
    expect(client.calls[2]!.departureTime).toBe(37800);
    expect(client.calls[2]!.searchTime).toEqual(NOW); // シフト探索は厳密（予約制約あり）
    expect(outcome.missedFlex).toEqual({ departureTime: 35100, deadlineSec: 33300 });
    expect(outcome.shiftedFlex?.itinerary).toEqual(shifted);
  });

  it("固定路線の代替はそのまま結果一覧に残る（docs/15 4.4節「次の候補」）", async () => {
    const bus = transitItinerary(36000, 38520, 1);
    const missed = flexItinerary(35100, 35860, 33300);
    const client = fakeClient((req) => {
      if (req.searchTime?.serviceDate === -1) return [missed, bus];
      if (req.departureTime === 35100) return [bus];
      return [];
    });
    const outcome = await runSearch(client, { ...base, departureTime: 35100, now: NOW });
    expect(outcome.itineraries).toEqual([bus]);
    expect(outcome.missedFlex).toBeDefined();
    expect(outcome.shiftedFlex).toBeUndefined(); // シフト先にもFlexが無ければ提示しない
  });

  it("予約制約無視でもFlexが無い（本当に手段がない）場合は追加探索しない", async () => {
    const client = fakeClient(() => []);
    const outcome = await runSearch(client, { ...base, departureTime: 35100, now: NOW });
    expect(client.calls).toHaveLength(2); // 厳密＋制約無視のみ
    expect(outcome.itineraries).toEqual([]);
    expect(outcome.missedFlex).toBeUndefined();
  });

  it("締切不明（deadline未定義）のFlexは超過扱いにしない", async () => {
    const unknownDeadline = flexItinerary(35100, 35860, undefined);
    const client = fakeClient((req) => {
      if (req.searchTime?.serviceDate === -1) return [unknownDeadline];
      return [];
    });
    const outcome = await runSearch(client, { ...base, departureTime: 35100, now: NOW });
    expect(outcome.missedFlex).toBeUndefined();
  });
});

describe("runSearch（結果の並び）", () => {
  it("所要時間昇順で返す（docs/15 3.3節の既定ソート）", async () => {
    const slow = transitItinerary(36000, 40000, 1);
    const fast = flexItinerary(36000, 36760, 34200);
    const client = fakeClient(() => [slow, fast]);
    const outcome = await runSearch(client, {
      ...base,
      departureTime: 36000,
      now: { serviceDate: 20260707, nowSec: 32400 },
    });
    expect(outcome.itineraries.map((i) => i.summary.durationSec)).toEqual([760, 4000]);
  });
});
