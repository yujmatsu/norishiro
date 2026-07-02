// 検索条件URLクエリの往復変換テスト
import { describe, expect, it } from "vitest";
import { buildResultSearch, parseResultQuery } from "../src/lib/result-query.js";
import type { PlaceSelection, WhenSelection } from "../src/lib/history.js";

const stopPlace: PlaceSelection = { kind: "stop", stopId: "1", name: "殿ケ谷会館" };
const coordPlace: PlaceSelection = {
  kind: "coord",
  lat: 35.77123,
  lon: 139.35456,
  label: "現在地",
};

describe("buildResultSearch / parseResultQuery", () => {
  it("stop地点・今すぐの条件を往復できる", () => {
    const search = buildResultSearch(
      stopPlace,
      { kind: "stop", stopId: "37", name: "みずほ病院" },
      { type: "now" },
    );
    const parsed = parseResultQuery(new URLSearchParams(search));
    expect(parsed).toEqual({
      from: stopPlace,
      to: { kind: "stop", stopId: "37", name: "みずほ病院" },
      when: { type: "now" },
    });
  });

  it("coord地点・日時指定の条件を往復できる", () => {
    const when: WhenSelection = { type: "datetime", serviceDate: 20260707, timeSec: 36000 };
    const search = buildResultSearch(coordPlace, stopPlace, when);
    const parsed = parseResultQuery(new URLSearchParams(search));
    expect(parsed?.from).toEqual({ kind: "coord", lat: 35.77123, lon: 139.35456, label: "現在地" });
    expect(parsed?.when).toEqual(when);
  });

  it("欠損・不正な条件はnullを返す", () => {
    expect(parseResultQuery(new URLSearchParams(""))).toBeNull();
    expect(parseResultQuery(new URLSearchParams("?from=stop:1&to=stop:2&when=xxx"))).toBeNull();
    expect(parseResultQuery(new URLSearchParams("?from=coord:abc&to=stop:2&when=now"))).toBeNull();
  });
});
