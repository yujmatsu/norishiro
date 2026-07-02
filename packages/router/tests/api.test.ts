// T-API-01〜04: API契約テスト（docs/13 10.5節）＋依存方向のアーキテクチャテスト
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isochrone, loadShard, plan, RouterInputError, type PlanRequest } from "../src/index.js";
import { buildMizuhoShard, TUESDAY } from "./helpers/mizuho-shard.js";

describe("T-API-01: departureTime未指定はエラー", () => {
  it("RouterInputErrorを投げる（NS-1: 到着時刻指定はv1未対応）", () => {
    loadShard(buildMizuhoShard());
    const req = {
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
    } as unknown as PlanRequest;
    expect(() => plan(req)).toThrow(RouterInputError);
  });
});

describe("T-API-02: requiresBookingフラグ", () => {
  it("Flexレッグを含むItineraryはrequiresBooking=true", () => {
    loadShard(buildMizuhoShard());
    const result = plan({
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: 36000,
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 32400 },
    });
    const flexItinerary = result.find((i) => i.legs.some((l) => l.kind === "flex"));
    expect(flexItinerary).toBeDefined();
    expect(flexItinerary!.summary.requiresBooking).toBe(true);
  });
});

describe("T-API-03: booking.messageの完全性", () => {
  it("booking_rules.txtのmessage列とバイト一致する（言い換え・要約をしない）", () => {
    loadShard(buildMizuhoShard());
    const result = plan({
      origin: { kind: "stopId", stopId: "1" },
      destination: { kind: "stopId", stopId: "37" },
      departureTime: 36000,
      serviceDate: TUESDAY,
      searchTime: { serviceDate: TUESDAY, nowSec: 32400 },
    });
    const leg = result.flatMap((i) => i.legs).find((l) => l.kind === "flex");
    expect(leg).toBeDefined();
    if (leg?.kind !== "flex") return;
    expect(leg.booking.message).toBe(
      "ご利用の30分前までに予約が必要で、電話予約は8:30から16:30まで、オンライン予約は24時間受付",
    );
  });
});

describe("T-API-04: isochroneのGeoJSON妥当性", () => {
  it("FeatureCollectionでPolygon/MultiPolygonのみを含む", () => {
    loadShard(buildMizuhoShard());
    // defaultServiceDate=2026-07-06（月曜、west_service運行日）
    const result = isochrone({ kind: "stopId", stopId: "1" }, 36000, [1800, 7200]);
    expect(result.type).toBe("FeatureCollection");
    expect(Array.isArray(result.features)).toBe(true);
    expect(result.features.length).toBeGreaterThan(0);
    for (const feature of result.features) {
      expect(feature.type).toBe("Feature");
      expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry.type);
      expect(typeof feature.properties.cutoffSec).toBe("number");
    }
  });
});

describe("アーキテクチャテスト: 依存方向ルール（docs/11 2章）", () => {
  const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

  it("packages/routerのsrcは@norishiro/gtfsをimportしない", () => {
    for (const file of readdirSync(srcDir)) {
      const content = readFileSync(path.join(srcDir, file), "utf-8");
      expect(content, `${file}が@norishiro/gtfsをimportしている`).not.toContain("@norishiro/gtfs");
    }
  });

  it("package.jsonの依存に@norishiro/gtfsが含まれない", () => {
    const pkg = JSON.parse(readFileSync(path.join(srcDir, "..", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@norishiro/gtfs");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("@norishiro/gtfs");
  });
});
