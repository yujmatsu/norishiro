// get_isochroneの応答サイズ上限と段階的簡略化（docs/14 3.5節）。
// 上限値2000座標点はdocs/14の例示値をv1の実装定数として採用する（docs/17 T-14）。

import type { IsochroneResult } from "@norishiro/router";

export const MAX_TOTAL_COORDS = 2000;

type Feature = IsochroneResult["features"][number];

function countCoords(features: readonly Feature[]): number {
  let total = 0;
  for (const f of features) {
    for (const ring of f.geometry.coordinates) {
      total += Array.isArray(ring[0]?.[0])
        ? (ring as number[][][]).reduce((n, r) => n + r.length, 0)
        : (ring as number[][]).length;
    }
  }
  return total;
}

/** 環の頂点をおおよそtarget点まで間引く（先頭・末尾＝閉環点は維持、最低4点） */
function thinRing(ring: number[][], target: number): number[][] {
  if (ring.length <= Math.max(4, target)) return ring;
  const step = Math.ceil((ring.length - 1) / Math.max(3, target - 1));
  const out: number[][] = [];
  for (let i = 0; i < ring.length - 1; i += step) out.push(ring[i]!);
  out.push(ring[ring.length - 1]!);
  return out;
}

/**
 * 座標点数が上限を超える場合の段階的簡略化。
 *   1. 各ポリゴン環の頂点を按分間引き
 *   2. なお超過する場合、最大cutoffのfeatureのみ残し、他はproperties注記＋空ジオメトリ
 * 適用有無をsimplifiedフラグで返す（LLMが「近似の簡略版」と利用者に伝えられるように）。
 */
export function capIsochroneSize(
  result: IsochroneResult,
  maxCoords: number = MAX_TOTAL_COORDS,
): { geojson: IsochroneResult; simplified: boolean } {
  if (countCoords(result.features) <= maxCoords) {
    return { geojson: result, simplified: false };
  }

  const perFeature = Math.max(4, Math.floor(maxCoords / Math.max(1, result.features.length)));
  const thinned: Feature[] = result.features.map((f) => {
    const coords = f.geometry.coordinates;
    const isMulti = Array.isArray(coords[0]?.[0]?.[0]);
    const newCoords = isMulti
      ? (coords as number[][][][]).map((poly) => poly.map((ring) => thinRing(ring, perFeature)))
      : (coords as number[][][]).map((ring) => thinRing(ring, perFeature));
    return {
      type: "Feature",
      properties: f.properties,
      geometry: { type: f.geometry.type, coordinates: newCoords } as Feature["geometry"],
    };
  });
  if (countCoords(thinned) <= maxCoords) {
    return { geojson: { type: "FeatureCollection", features: thinned }, simplified: true };
  }

  const maxCutoff = Math.max(...result.features.map((f) => f.properties.cutoffSec));
  const features: Feature[] = thinned.map((f) => {
    if (f.properties.cutoffSec === maxCutoff) return f;
    const omittedProps = {
      ...f.properties,
      omitted: true,
      note: "応答サイズ上限のため簡略化により省略",
    } as Feature["properties"];
    return {
      type: "Feature",
      properties: omittedProps,
      geometry: { type: "Polygon", coordinates: [] },
    };
  });
  return { geojson: { type: "FeatureCollection", features }, simplified: true };
}
