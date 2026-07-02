// 表示設定ツールバー（docs/15 5.1節）。文字サイズ切替はヘッダーから常時アクセス可能にする要件のため、
// 全画面共通でルーティングの外側（App直下）に表示する。高コントラスト切替も1操作。
import { useEffect, useState, type ReactElement } from "react";
import {
  applyDisplaySettings,
  fontScaleLabel,
  loadDisplaySettings,
  nextFontScale,
  saveDisplaySettings,
  type DisplaySettings,
} from "../lib/settings.js";

export function DisplayToolbar(): ReactElement {
  const [settings, setSettings] = useState<DisplaySettings>(() => loadDisplaySettings());

  useEffect(() => {
    applyDisplaySettings(settings);
    saveDisplaySettings(settings);
  }, [settings]);

  return (
    <div className="display-toolbar" role="group" aria-label="表示設定">
      <button
        type="button"
        className="btn btn-toolbar"
        onClick={() => setSettings((s) => ({ ...s, fontScale: nextFontScale(s.fontScale) }))}
        aria-label={`文字サイズを変える（現在: ${fontScaleLabel(settings.fontScale)}）`}
      >
        Aa 文字サイズ: {fontScaleLabel(settings.fontScale)}
      </button>
      <button
        type="button"
        className="btn btn-toolbar"
        aria-pressed={settings.highContrast}
        onClick={() => setSettings((s) => ({ ...s, highContrast: !s.highContrast }))}
      >
        高コントラスト
      </button>
    </div>
  );
}
