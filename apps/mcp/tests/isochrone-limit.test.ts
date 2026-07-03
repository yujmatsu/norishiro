// 到達圏応答の段階的簡略化のテスト（T-MCP-14）。docs/14 3.5節の
// 「頂点間引き→最大cutoffのみ残す」の2段フォールバックとsimplifiedフラグを検証する。

import type { IsochroneResult } from "@norishiro/router";
import { describe, expect, it } from "vitest";
import { capIsochroneSize } from "../src/isochrone-limit.js";

function ringOf(n: number): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i < n - 1; i++) ring.push([139 + i * 1e-4, 35 + i * 1e-4]);
  ring.push(ring[0]!); // 閉環
  return ring;
}

function collection(pointsPerFeature: number[], cutoffs: number[]): IsochroneResult {
  return {
    type: "FeatureCollection",
    features: pointsPerFeature.map((n, i) => ({
      type: "Feature",
      properties: { cutoffSec: cutoffs[i]! },
      geometry: { type: "Polygon", coordinates: [ringOf(n)] },
    })),
  };
}

function totalCoords(geojson: IsochroneResult): number {
  return geojson.features.reduce(
    (sum, f) => sum + (f.geometry.coordinates as number[][][]).reduce((s, r) => s + r.length, 0),
    0,
  );
}

describe("capIsochroneSize", () => {
  it("T-MCP-14: 上限内は無加工、超過は頂点間引き、大幅超過は最大cutoffのみ残す", () => {
    const small = capIsochroneSize(collection([100, 100], [900, 1800]));
    expect(small.simplified).toBe(false);
    expect(totalCoords(small.geojson)).toBe(200);

    const large = capIsochroneSize(collection([2000, 2000], [900, 1800]));
    expect(large.simplified).toBe(true);
    expect(totalCoords(large.geojson)).toBeLessThanOrEqual(2000);
    expect(large.geojson.features).toHaveLength(2);

    // 極端に小さい上限（間引き後の最小頂点数でも超過）では最大cutoff以外は省略メタ情報のみになる
    const capped = capIsochroneSize(collection([100, 100], [900, 1800]), 5);
    expect(capped.simplified).toBe(true);
    const omitted = capped.geojson.features.find((f) => f.properties.cutoffSec === 900);
    const kept = capped.geojson.features.find((f) => f.properties.cutoffSec === 1800);
    expect((omitted?.properties as { omitted?: boolean }).omitted).toBe(true);
    expect(omitted?.geometry.coordinates).toHaveLength(0);
    expect(kept?.geometry.coordinates.length).toBeGreaterThan(0);
  });
});
