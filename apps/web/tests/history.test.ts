// 検索履歴（localStorage）のテスト（docs/15 3.1節・3.2節: 最近の検索地点。全てローカル保存、
// サーバー送信なし＝docs/15 8章の計測方針）
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadHistory,
  recentStopPlaces,
  saveSearch,
  type SearchRecord,
} from "../src/lib/history.js";

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const record = (fromId: string, toId: string, savedAt: number): SearchRecord => ({
  from: { kind: "stop", stopId: fromId, name: `stop${fromId}` },
  to: { kind: "stop", stopId: toId, name: `stop${toId}` },
  when: { type: "now" },
  savedAt,
});

describe("saveSearch / loadHistory", () => {
  let storage: Pick<Storage, "getItem" | "setItem">;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it("新しい順に保存される", () => {
    saveSearch(record("1", "37", 100), storage);
    saveSearch(record("2", "37", 200), storage);
    const history = loadHistory(storage);
    expect(history.map((r) => r.savedAt)).toEqual([200, 100]);
  });

  it("同一条件（出発地・目的地・いつの種別）は重複させず最新のみ残す", () => {
    saveSearch(record("1", "37", 100), storage);
    saveSearch(record("1", "37", 200), storage);
    const history = loadHistory(storage);
    expect(history).toHaveLength(1);
    expect(history[0]!.savedAt).toBe(200);
  });

  it("最大20件で古いものから切り捨てる", () => {
    for (let i = 0; i < 25; i++) {
      saveSearch(record(String(i), "37", i), storage);
    }
    const history = loadHistory(storage);
    expect(history).toHaveLength(20);
    expect(history[0]!.savedAt).toBe(24);
  });

  it("壊れたJSONが保存されていても例外を投げず空扱いにする（寛容方針）", () => {
    storage.setItem("norishiro.searchHistory.v1", "{broken");
    expect(loadHistory(storage)).toEqual([]);
  });
});

describe("recentStopPlaces", () => {
  it("履歴の出発地・目的地からstop地点を重複なく新しい順に返す", () => {
    const storage = fakeStorage();
    saveSearch(record("1", "37", 100), storage);
    saveSearch(record("2", "37", 200), storage);
    const places = recentStopPlaces(storage);
    expect(places.map((p) => p.stopId)).toEqual(["2", "37", "1"]);
  });

  it("coord地点（現在地）は候補に含めない", () => {
    const storage = fakeStorage();
    saveSearch(
      {
        from: { kind: "coord", lat: 35.77, lon: 139.35, label: "現在地" },
        to: { kind: "stop", stopId: "37", name: "みずほ病院" },
        when: { type: "now" },
        savedAt: 100,
      },
      storage,
    );
    expect(recentStopPlaces(storage).map((p) => p.stopId)).toEqual(["37"]);
  });

  it("limitで件数を制限する", () => {
    const storage = fakeStorage();
    saveSearch(record("1", "2", 100), storage);
    saveSearch(record("3", "4", 200), storage);
    expect(recentStopPlaces(storage, 3)).toHaveLength(3);
  });
});
