// 到達圏モード（S7）の表示ヘルパーのテスト（docs/15 3.7節）
import { describe, expect, it } from "vitest";
import type { IsochroneResult } from "@norishiro/router";
import { ISOCHRONE_CUTOFFS, pickCutoffFeature } from "../src/lib/isochrone-view.js";

const fc = (cutoffs: number[]): IsochroneResult => ({
  type: "FeatureCollection",
  features: cutoffs.map((cutoffSec) => ({
    type: "Feature",
    properties: { cutoffSec },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
  })),
});

describe("ISOCHRONE_CUTOFFS", () => {
  it("スライダーの5分刻み（5〜60分）に対応する", () => {
    expect(ISOCHRONE_CUTOFFS[0]).toBe(300);
    expect(ISOCHRONE_CUTOFFS[ISOCHRONE_CUTOFFS.length - 1]).toBe(3600);
    expect(ISOCHRONE_CUTOFFS).toHaveLength(12);
  });
});

describe("pickCutoffFeature", () => {
  it("cutoff秒が一致するfeatureを返す", () => {
    const result = pickCutoffFeature(fc([300, 600]), 600);
    expect(result?.properties.cutoffSec).toBe(600);
  });

  it("該当なし（到達点3未満でスキップされたcutoff）はnull", () => {
    expect(pickCutoffFeature(fc([300]), 600)).toBeNull();
  });
});
