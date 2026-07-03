// 表示設定（docs/15 5.1節: 文字サイズ標準／大／特大の3段階、高コントラストモード）。
// localStorageのみに保存しサーバー送信しない（docs/15 8章）。

export type FontScale = "standard" | "large" | "xlarge";

export interface DisplaySettings {
  fontScale: FontScale;
  highContrast: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  fontScale: "standard",
  highContrast: false,
};

const STORAGE_KEY = "norishiro.displaySettings.v1";
const FONT_SCALES: FontScale[] = ["standard", "large", "xlarge"];

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isFontScale(value: unknown): value is FontScale {
  return typeof value === "string" && (FONT_SCALES as string[]).includes(value);
}

/** 未保存・壊れたデータ・不正値は既定値に補正する（寛容方針） */
export function loadDisplaySettings(
  storage: SettingsStorage | null = defaultStorage(),
): DisplaySettings {
  if (storage === null) return DEFAULT_DISPLAY_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_DISPLAY_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_DISPLAY_SETTINGS;
    const p = parsed as Record<string, unknown>;
    if (!isFontScale(p["fontScale"]) || typeof p["highContrast"] !== "boolean") {
      return DEFAULT_DISPLAY_SETTINGS;
    }
    return { fontScale: p["fontScale"], highContrast: p["highContrast"] };
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

export function saveDisplaySettings(
  settings: DisplaySettings,
  storage: SettingsStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 保存失敗は致命ではない（次回起動時に既定値へ戻るだけ）
  }
}

/** 文字サイズを標準→大→特大→標準と循環させる（1ボタンで切替できるようにする） */
export function nextFontScale(scale: FontScale): FontScale {
  const i = FONT_SCALES.indexOf(scale);
  return FONT_SCALES[(i + 1) % FONT_SCALES.length]!;
}

export function fontScaleLabel(scale: FontScale): string {
  switch (scale) {
    case "standard":
      return "標準";
    case "large":
      return "大";
    case "xlarge":
      return "特大";
  }
}

/** 設定をdocumentへ反映する（CSSは html[data-font-scale] / html[data-contrast] を参照する） */
export function applyDisplaySettings(settings: DisplaySettings): void {
  const el = document.documentElement;
  el.dataset["fontScale"] = settings.fontScale;
  el.dataset["contrast"] = settings.highContrast ? "high" : "normal";
}
