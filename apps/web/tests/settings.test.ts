// 表示設定（文字サイズ3段階・高コントラスト、docs/15 5.1節）のテスト。
// 設定はlocalStorageのみに保存しサーバー送信しない（docs/15 8章）。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_SETTINGS,
  fontScaleLabel,
  loadDisplaySettings,
  nextFontScale,
  saveDisplaySettings,
} from "../src/lib/settings.js";

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("loadDisplaySettings / saveDisplaySettings", () => {
  it("保存した設定を読み戻せる", () => {
    const storage = fakeStorage();
    saveDisplaySettings({ fontScale: "large", highContrast: true }, storage);
    expect(loadDisplaySettings(storage)).toEqual({ fontScale: "large", highContrast: true });
  });

  it("未保存・壊れたデータは既定値（標準・高コントラストOFF）", () => {
    const storage = fakeStorage();
    expect(loadDisplaySettings(storage)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    storage.setItem("norishiro.displaySettings.v1", "{broken");
    expect(loadDisplaySettings(storage)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("不正な値は既定値に補正する（寛容方針）", () => {
    const storage = fakeStorage();
    storage.setItem(
      "norishiro.displaySettings.v1",
      JSON.stringify({ fontScale: "huge", highContrast: "yes" }),
    );
    expect(loadDisplaySettings(storage)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });
});

describe("nextFontScale / fontScaleLabel", () => {
  it("標準→大→特大→標準と循環する", () => {
    expect(nextFontScale("standard")).toBe("large");
    expect(nextFontScale("large")).toBe("xlarge");
    expect(nextFontScale("xlarge")).toBe("standard");
  });

  it("日本語ラベル（docs/15 5.1節の標準／大／特大）", () => {
    expect(fontScaleLabel("standard")).toBe("標準");
    expect(fontScaleLabel("large")).toBe("大");
    expect(fontScaleLabel("xlarge")).toBe("特大");
  });
});
