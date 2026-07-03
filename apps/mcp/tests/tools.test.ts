// MCPツールのテスト（T-MCP-01〜T-MCP-10）。docs/14 3章の入出力契約・5章のエラー分類を検証する。
// 期待値は瑞穂町実データの実測値（docs/13 10.1節T-R-DUR-02: 殿ケ谷会館→みずほ病院、
// 09:00発→33159秒着、予約締切30600秒=08:30、電話050-2030-2630）をそのまま使う。

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { callTool } from "../src/server.js";
import { makeCtx, readMizuhoShard } from "./helpers.js";

function body(res: CallToolResult): Record<string, unknown> {
  const first = res.content[0];
  if (first?.type !== "text") throw new Error("textコンテンツがない");
  return JSON.parse(first.text) as Record<string, unknown>;
}

const DEP = "2026-07-07T09:00:00+09:00"; // 火曜日（east_trip運行日）

describe("plan_journey", () => {
  it("T-MCP-01: 停留所名指定でFlex経路と予約情報（締切08:30・電話番号）を返す", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "plan_journey", {
      origin: { kind: "stopName", stopName: "殿ケ谷会館" },
      destination: { kind: "stopName", stopName: "みずほ病院" },
      departureTime: DEP,
    });
    expect(res.isError).toBe(false);
    const { itineraries } = body(res) as unknown as {
      itineraries: Array<{
        legs: Array<{ kind: string; booking?: { deadline?: number; phoneNumber?: string } }>;
        summary: { arrivalTime: number; requiresBooking: boolean };
      }>;
    };
    expect(itineraries.length).toBeGreaterThanOrEqual(1);
    const first = itineraries[0]!;
    expect(first.summary.requiresBooking).toBe(true);
    // 到着33159.4秒（=09:00発＋推定所要759.4秒、docs/13 10.1節の実測値）
    expect(first.summary.arrivalTime).toBeCloseTo(33159.4, 1);
    const flexLeg = first.legs.find((l) => l.kind === "flex");
    expect(flexLeg?.booking?.deadline).toBe(30600);
    expect(flexLeg?.booking?.phoneNumber).toBe("050-2030-2630");
  });

  it("T-MCP-02: UTC表記（Z）はJST壁時計に正規化され同一結果になる", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "plan_journey", {
      origin: { kind: "stopName", stopName: "殿ケ谷会館" },
      destination: { kind: "stopName", stopName: "みずほ病院" },
      departureTime: "2026-07-07T00:00:00Z", // = 09:00 JST
    });
    expect(res.isError).toBe(false);
    const { itineraries } = body(res) as unknown as {
      itineraries: Array<{ summary: { arrivalTime: number } }>;
    };
    expect(itineraries[0]?.summary.arrivalTime).toBeCloseTo(33159.4, 1);
  });

  it("T-MCP-03: オフセット無し・不正形式のdepartureTimeはINVALID_INPUT", async () => {
    const ctx = makeCtx();
    for (const departureTime of ["2026-07-07T09:00:00", "not-a-date"]) {
      const res = await callTool(ctx, "plan_journey", {
        origin: { kind: "stopId", stopId: "1" },
        destination: { kind: "stopId", stopId: "37" },
        departureTime,
      });
      expect(res.isError).toBe(true);
      const err = body(res);
      expect(err.errorCode).toBe("INVALID_INPUT");
      expect(err.retryable).toBe(false);
    }
  });

  it("T-MCP-04: 未知の停留所名は解決失敗、曖昧な名称は候補つきでINVALID_INPUT", async () => {
    const ctx = makeCtx();
    const notFound = await callTool(ctx, "plan_journey", {
      origin: { kind: "stopName", stopName: "存在しない停留所XYZ" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: DEP,
    });
    expect(notFound.isError).toBe(true);
    expect(body(notFound).errorCode).toBe("INVALID_INPUT");
    expect(String(body(notFound).message)).toContain("search_stops");

    // 「病院」はみずほ病院・福生病院の2件に一致し一意に決まらない
    const ambiguous = await callTool(ctx, "plan_journey", {
      origin: { kind: "stopName", stopName: "病院" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: DEP,
    });
    expect(ambiguous.isError).toBe(true);
    expect(String(body(ambiguous).message)).toContain("一意に決まりません");
  });

  it("T-MCP-05: 未整備地域の座標はDATA_NOT_AVAILABLE（retryable: false）", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "plan_journey", {
      origin: { kind: "coord", lat: 36.6983, lon: 137.8621 }, // 白馬村（未整備）
      destination: { kind: "stopId", stopId: "37" },
      departureTime: DEP,
    });
    expect(res.isError).toBe(true);
    const err = body(res);
    expect(err.errorCode).toBe("DATA_NOT_AVAILABLE");
    expect(err.retryable).toBe(false);
  });

  it("T-MCP-06: zodスキーマ違反（maxTransfers=7）は日本語要約つきINVALID_INPUT", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "plan_journey", {
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: DEP,
      options: { maxTransfers: 7 },
    });
    expect(res.isError).toBe(true);
    const err = body(res);
    expect(err.errorCode).toBe("INVALID_INPUT");
    expect(String(err.message)).toContain("入力の形式が正しくありません");
    expect(String(err.detail)).toContain("maxTransfers");
  });
});

describe("search_stops", () => {
  it("T-MCP-07: 名称検索はflex_member種別とlocation_group所属を返す", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "search_stops", {
      query: { mode: "name", text: "みずほ病院" },
    });
    expect(res.isError).toBe(false);
    const { stops } = body(res) as unknown as {
      stops: Array<{ stopId: string; kind: string; flexGroupIds?: string[] }>;
    };
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      stopId: "37",
      kind: "flex_member",
      flexGroupIds: ["mizuhomachi_group"],
    });

    const two = await callTool(ctx, "search_stops", { query: { mode: "name", text: "病院" } });
    expect((body(two) as unknown as { stops: unknown[] }).stops).toHaveLength(2);
  });

  it("T-MCP-08: 半径検索は距離昇順、5000m超は切り詰めて正常応答、未整備地域はエラー", async () => {
    const ctx = makeCtx();
    const shard = readMizuhoShard();
    const i = shard.stops.stopId.indexOf("1"); // 殿ケ谷会館
    const [lat, lon] = [shard.stops.lat[i]!, shard.stops.lon[i]!];

    const res = await callTool(ctx, "search_stops", {
      query: { mode: "radius", lat, lon, radiusMeters: 300 },
      limit: 10,
    });
    expect(res.isError).toBe(false);
    const { stops } = body(res) as unknown as {
      stops: Array<{ stopId: string; distanceMeters: number }>;
    };
    expect(stops[0]?.stopId).toBe("1");
    expect(stops[0]?.distanceMeters).toBe(0);
    const dists = stops.map((s) => s.distanceMeters);
    expect([...dists].sort((a, b) => a - b)).toEqual(dists);

    // 半径10000m→5000mに切り詰め（拒否しない、docs/14 6.1節S-2）
    const clamped = await callTool(ctx, "search_stops", {
      query: { mode: "radius", lat, lon, radiusMeters: 10000 },
    });
    expect(clamped.isError).toBe(false);

    const noCoverage = await callTool(ctx, "search_stops", {
      query: { mode: "radius", lat: 36.6983, lon: 137.8621, radiusMeters: 1000 },
    });
    expect(noCoverage.isError).toBe(true);
    expect(body(noCoverage).errorCode).toBe("DATA_NOT_AVAILABLE");
  });
});

describe("list_flex_services / get_booking_rules", () => {
  it("T-MCP-09: 瑞穂町のFlexサービス2件（運行曜日・時間窓・予約概要つき）を返す", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "list_flex_services", {
      area: { prefecture: "東京都", municipality: "瑞穂町" },
    });
    expect(res.isError).toBe(false);
    const { services } = body(res) as unknown as {
      services: Array<Record<string, unknown>>;
    };
    expect(services).toHaveLength(2);
    const east = services.find((s) => s.serviceId === "mizuhomachi_group:east_trip");
    expect(east).toMatchObject({
      locationGroupId: "mizuhomachi_group",
      serviceName: "チョイソコみずほまち",
      providerName: "瑞穂町",
      operatingDaysSummary: "火・金・土",
      timeWindowSummary: "09:00-17:00",
      bookingSummary: "乗車30分前までに予約が必要",
      memberStopCount: 120,
    });

    // 市区町村の表記不一致は0件の正常応答（docs/14 3.3節）
    const zero = await callTool(ctx, "list_flex_services", {
      area: { prefecture: "東京都", municipality: "瑞穂" },
    });
    expect(zero.isError).toBe(false);
    expect((body(zero) as unknown as { services: unknown[] }).services).toHaveLength(0);

    // シャード自体が無い都道府県はDATA_NOT_AVAILABLE（docs/14 9.2節U-6）
    const nagano = await callTool(ctx, "list_flex_services", {
      area: { prefecture: "長野県" },
    });
    expect(nagano.isError).toBe(true);
    expect(body(nagano).errorCode).toBe("DATA_NOT_AVAILABLE");
  });

  it("T-MCP-10: 予約ルール詳細はmessage列をそのままspokenGuidanceとして返す", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "get_booking_rules", {
      serviceId: "mizuhomachi_group:east_trip",
    });
    expect(res.isError).toBe(false);
    expect(body(res)).toMatchObject({
      serviceId: "mizuhomachi_group:east_trip",
      bookingType: 1,
      phoneNumber: "050-2030-2630",
      priorNoticeRule: { kind: "same_day_minutes_before", minutesBefore: 30 },
      infoUrl: "https://www.town.mizuho.tokyo.jp/",
      bookingUrl: null,
      // 言い換え・要約をしない（docs/14 3.4節、CLAUDE.md Don't）
      spokenGuidance:
        "ご利用の30分前までに予約が必要で、電話予約は8:30から16:30まで、オンライン予約は24時間受付",
    });

    const unknown = await callTool(ctx, "get_booking_rules", {
      serviceId: "mizuhomachi_group:no_such_trip",
    });
    expect(unknown.isError).toBe(true);
    expect(body(unknown).errorCode).toBe("INVALID_INPUT");
  });
});

describe("get_isochrone / list_data_sources", () => {
  it("T-MCP-11: 到達圏はcutoffごとのGeoJSON Featureを返す（簡略化なし）", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "get_isochrone", {
      origin: { kind: "stopName", stopName: "殿ケ谷会館" },
      departureTime: DEP,
      cutoffsMinutes: [15, 30],
    });
    expect(res.isError).toBe(false);
    const out = body(res) as unknown as {
      geojson: { type: string; features: Array<{ properties: { cutoffSec: number } }> };
      simplified: boolean;
    };
    expect(out.simplified).toBe(false);
    expect(out.geojson.type).toBe("FeatureCollection");
    expect(out.geojson.features.map((f) => f.properties.cutoffSec)).toEqual([900, 1800]);

    // 入力ガード: 180分超・6要素以上はINVALID_INPUT（docs/14 6.2節）
    const tooLong = await callTool(ctx, "get_isochrone", {
      origin: { kind: "stopId", stopId: "1" },
      departureTime: DEP,
      cutoffsMinutes: [200],
    });
    expect(tooLong.isError).toBe(true);
    expect(body(tooLong).errorCode).toBe("INVALID_INPUT");
  });

  it("T-MCP-12: データ出典一覧は瑞穂町CC BY 4.0クレジットを含む", async () => {
    const ctx = makeCtx();
    const res = await callTool(ctx, "list_data_sources", {});
    expect(res.isError).toBe(false);
    const manifest = body(res) as unknown as {
      generatedAt: string;
      entries: Array<Record<string, unknown>>;
    };
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({
      feedId: "mizuho-flex",
      providerName: "瑞穂町",
      licenseId: "CC BY 4.0",
      challengeLimited: false,
    });
  });
});
