// 地点あいまい検索のテスト（docs/15 3.2節: 部分一致。読み仮名対応はシャードに読みが無いため
// v1では かな正規化＋部分一致 まで。docs/17 D-10参照）
import { describe, expect, it } from "vitest";
import { normalizeForMatch, searchStopList, type StopCandidate } from "../src/lib/stop-search.js";

const stops: StopCandidate[] = [
  { stopId: "1", name: "殿ケ谷会館", lat: 35.78, lon: 139.35 },
  { stopId: "22", name: "石畑診療所", lat: 35.77, lon: 139.35 },
  { stopId: "16", name: "石畑会館", lat: 35.77, lon: 139.35 },
  { stopId: "26", name: "スカイホール", lat: 35.77, lon: 139.35 },
  { stopId: "37", name: "みずほ病院", lat: 35.77, lon: 139.34 },
];

describe("normalizeForMatch", () => {
  it("ひらがな・カタカナ・全角半角・大文字小文字を同一視する", () => {
    expect(normalizeForMatch("みずほ")).toBe(normalizeForMatch("ミズホ"));
    expect(normalizeForMatch("ｽｶｲ")).toBe(normalizeForMatch("スカイ"));
    expect(normalizeForMatch("ＧＲ")).toBe(normalizeForMatch("gr"));
  });
});

describe("searchStopList", () => {
  it("部分一致で候補を返す", () => {
    const result = searchStopList(stops, "病院");
    expect(result.map((s) => s.stopId)).toEqual(["37"]);
  });

  it("カタカナの問い合わせでひらがな名にヒットする", () => {
    const result = searchStopList(stops, "ミズホ");
    expect(result.map((s) => s.stopId)).toEqual(["37"]);
  });

  it("前方一致を部分一致より優先して並べる", () => {
    const result = searchStopList(stops, "石畑");
    expect(result.map((s) => s.name)).toEqual(["石畑診療所", "石畑会館"]);
    const partial = searchStopList(stops, "会館");
    expect(partial.map((s) => s.name)).toEqual(["殿ケ谷会館", "石畑会館"]);
  });

  it("空クエリ・空白のみは空配列を返す", () => {
    expect(searchStopList(stops, "")).toEqual([]);
    expect(searchStopList(stops, "  ")).toEqual([]);
  });

  it("limitで件数を制限する", () => {
    expect(searchStopList(stops, "石畑", 1)).toHaveLength(1);
  });
});
