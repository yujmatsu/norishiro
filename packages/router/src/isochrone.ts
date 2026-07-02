// 到達圏算出（docs/13 7章）。plan()と同じRAPTORエンジンを目的地なしで実行し、凸包でポリゴン化する。
import type { IsochroneResult } from "./public-types.js";
import type { RaptorState, RouterShard } from "./types.js";

type Point = [number, number]; // [lon, lat]

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrewのmonotone chainによる凸包。3点未満はnullを返す */
export function convexHull(points: Point[]): Point[] | null {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter(
    (p, i) => i === 0 || p[0] !== sorted[i - 1]![0] || p[1] !== sorted[i - 1]![1],
  );
  if (unique.length < 3) return null;

  const lower: Point[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return null;
  return hull;
}

/** 全stopの最終到達時刻(bestArrival)からcutoffごとにポリゴンを生成する（docs/13 7.3節） */
export function buildIsochronePolygons(
  shard: RouterShard,
  state: RaptorState,
  departureTime: number,
  cutoffs: number[],
): IsochroneResult {
  const features: IsochroneResult["features"] = [];
  for (const cutoffSec of [...cutoffs].sort((a, b) => a - b)) {
    const points: Point[] = [];
    for (let stopIdx = 0; stopIdx < shard.stopCount; stopIdx++) {
      if (state.tauBest[stopIdx]! - departureTime <= cutoffSec) {
        points.push([shard.stopLon[stopIdx]!, shard.stopLat[stopIdx]!]);
      }
    }
    // v1は実装単純性を優先し凸包を既定とする（実際の到達圏より広めに出る、docs/13 7.3節）
    const hull = convexHull(points);
    if (hull === null) continue; // 3点未満はポリゴン化できないためスキップ
    features.push({
      type: "Feature",
      properties: { cutoffSec },
      geometry: { type: "Polygon", coordinates: [[...hull, hull[0]!]] },
    });
  }
  return { type: "FeatureCollection", features };
}
