// convex hull（monotone chain）。Flexエリアの面表現（docs/15 3.4節）に使う。
// docs/13 7.3節のisochroneポリゴン生成と同じ考え方（v1は凸包、α-shape化はA-5として不採用）。
// packages/routerの内部実装は公開契約（docs/13 8章）外のため、UI層で独立に持つ。

export interface LatLon {
  lat: number;
  lon: number;
}

function cross(o: LatLon, a: LatLon, b: LatLon): number {
  return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
}

/** 凸包の頂点列を返す（始点の繰り返しなし）。2点以下はそのまま返す */
export function convexHull(points: readonly LatLon[]): LatLon[] {
  const unique = [...new Map(points.map((p) => [`${p.lat},${p.lon}`, p])).values()];
  if (unique.length <= 2) return unique;

  const sorted = unique.sort((a, b) => a.lon - b.lon || a.lat - b.lat);

  const lower: LatLon[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: LatLon[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
