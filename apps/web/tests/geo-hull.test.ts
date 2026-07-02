// Flexエリアの面表現用convex hullのテスト（docs/15 3.4節: location_group停留所群のconvex hull的表示。
// docs/13 7.3節のisochroneポリゴン生成（凸包）と考え方を揃える）
import { describe, expect, it } from "vitest";
import { convexHull, type LatLon } from "../src/lib/geo-hull.js";

const p = (lat: number, lon: number): LatLon => ({ lat, lon });

describe("convexHull", () => {
  it("正方形＋内部点は四隅のみを返す", () => {
    const points = [p(0, 0), p(0, 1), p(1, 1), p(1, 0), p(0.5, 0.5)];
    const hull = convexHull(points);
    expect(hull).toHaveLength(4);
    const asSet = new Set(hull.map((q) => `${q.lat},${q.lon}`));
    expect(asSet).toEqual(new Set(["0,0", "0,1", "1,1", "1,0"]));
  });

  it("重複点があっても頂点は重複しない", () => {
    const points = [p(0, 0), p(0, 0), p(0, 1), p(1, 0), p(1, 1), p(1, 1)];
    expect(convexHull(points)).toHaveLength(4);
  });

  it("2点以下はそのまま返す（面にならない縮退ケース）", () => {
    expect(convexHull([p(1, 2)])).toEqual([p(1, 2)]);
    expect(convexHull([])).toEqual([]);
  });

  it("一直線上の点は両端のみを返す", () => {
    const hull = convexHull([p(0, 0), p(0, 1), p(0, 2), p(0, 3)]);
    expect(hull).toHaveLength(2);
  });
});
