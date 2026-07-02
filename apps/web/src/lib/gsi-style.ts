// 地理院タイル（淡色）のMapLibreスタイル定義。S4経路地図とS7到達圏マップで共有する。
// 出典表記必須: https://maps.gsi.go.jp/development/ichiran.html（APIキー不要＝0円設計）
import type { StyleSpecification } from "maplibre-gl";

export const GSI_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "地理院タイル（出典: 国土地理院）",
    },
  },
  layers: [{ id: "gsi", type: "raster", source: "gsi" }],
};
