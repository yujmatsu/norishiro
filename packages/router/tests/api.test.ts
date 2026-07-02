// T-API-01〜05: API契約テスト（docs/13 10.5節、T-API-05はdocs/17 C-18の契約拡張分）
// ＋依存方向のアーキテクチャテスト
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isochrone,
  loadShard,
  plan,
  RouterInputError,
  type IsochroneResult,
  type PlanRequest,
} from "../src/index.js";
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

describe("T-API-05: isochroneのオプション（includeFlex / serviceDate。docs/15 3.7節のBefore/After用、docs/17 C-18）", () => {
  /** featureのPolygon面積合計（度座標のshoelace。大小比較にのみ使う） */
  function totalArea(result: IsochroneResult): number {
    let total = 0;
    for (const feature of result.features) {
      if (feature.geometry.type !== "Polygon") continue;
      const ring = (feature.geometry.coordinates as number[][][])[0]!;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
      }
      total += Math.abs(area) / 2;
    }
    return total;
  }

  it("includeFlex:false はFlexレッグを除いた到達圏を返す（面積が小さくなる）", () => {
    loadShard(buildMizuhoShard());
    const withFlex = isochrone({ kind: "stopId", stopId: "1" }, 36000, [3600]);
    const withoutFlex = isochrone({ kind: "stopId", stopId: "1" }, 36000, [3600], {
      includeFlex: false,
    });
    expect(withFlex.features.length).toBeGreaterThan(0);
    expect(totalArea(withoutFlex)).toBeLessThan(totalArea(withFlex));
  });

  it("オプション省略時は includeFlex:true・シャード既定サービス日と同じ結果", () => {
    loadShard(buildMizuhoShard());
    const implicit = isochrone({ kind: "stopId", stopId: "1" }, 36000, [3600]);
    const explicit = isochrone({ kind: "stopId", stopId: "1" }, 36000, [3600], {
      includeFlex: true,
      serviceDate: 20260706, // helperのカレンダー先頭日（既定サービス日）
    });
    expect(explicit).toEqual(implicit);
  });

  it("serviceDate指定は運行日判定に反映される（運行の無い日はFlex分の到達圏が消える）", () => {
    loadShard(buildMizuhoShard());
    const activeDay = isochrone({ kind: "stopId", stopId: "1" }, 36000, [3600]);
    const inactiveDay = isochrone({ kind: "stopId", stopId: "1" }, 36000, [3600], {
      serviceDate: 20250101, // カレンダー窓の外＝全trip運行なし
    });
    expect(totalArea(inactiveDay)).toBeLessThan(totalArea(activeDay));
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
