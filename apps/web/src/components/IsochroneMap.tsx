// 到達圏マップ（S7、docs/15 3.7節・9.1節）。
// 「デマンド交通なし」（灰色・破線輪郭）の上に「あり」（オレンジ）を重ね、差分がひと目で分かるようにする。
// 色だけに依存しない（輪郭の実線/破線の差を併用、docs/15 5.1節）。
// スライダー・トグル操作ではマップを作り直さず、GeoJSONソースのデータ差し替えのみ行う（滑らかな更新）。
import { useEffect, useRef, useState, type ReactElement } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLon } from "../lib/geo-hull.js";
import { GSI_STYLE } from "../lib/gsi-style.js";
import type { IsochroneFeature } from "../lib/isochrone-view.js";

export interface IsochroneMapProps {
  center: LatLon;
  /** 固定路線・徒歩のみの到達圏（常に表示） */
  offFeature: IsochroneFeature | null;
  /** デマンド交通ありの到達圏（トグルOFF時はnullで非表示） */
  onFeature: IsochroneFeature | null;
  /** 視野合わせに使う最大範囲のfeature（データ読込時のみ変わる） */
  boundsFeature: IsochroneFeature | null;
}

// GeoJSONグローバル名前空間に依存せず、setDataの引数型から導出する
type GeoJsonData = Parameters<maplibregl.GeoJSONSource["setData"]>[0];

const emptyFc = (feature: IsochroneFeature | null): GeoJsonData =>
  ({
    type: "FeatureCollection",
    features: feature === null ? [] : [feature],
  }) as unknown as GeoJsonData;

export function IsochroneMap({
  center,
  offFeature,
  onFeature,
  boundsFeature,
}: IsochroneMapProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // 初期化は1回のみ
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({ container, style: GSI_STYLE, center: [139.35, 35.77], zoom: 12 });
    } catch {
      setFailed(true);
      return;
    }
    let disposed = false;
    map.on("error", () => {
      if (!disposed && mapRef.current === null) setFailed(true);
    });
    map.on("load", () => {
      if (disposed) return; // StrictMode二重マウントで先に破棄されたインスタンスは無視
      // 「あり」を下、「なし」を上に置く: 内側の灰色＝固定路線のみ、外側のオレンジ＝デマンド交通で広がる範囲
      map.addSource("iso-on", { type: "geojson", data: emptyFc(null) });
      map.addLayer({
        id: "iso-on-fill",
        type: "fill",
        source: "iso-on",
        paint: { "fill-color": "#e8863a", "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "iso-on-outline",
        type: "line",
        source: "iso-on",
        paint: { "line-color": "#9a4b00", "line-width": 2.5 },
      });
      map.addSource("iso-off", { type: "geojson", data: emptyFc(null) });
      map.addLayer({
        id: "iso-off-fill",
        type: "fill",
        source: "iso-off",
        paint: { "fill-color": "#6b7570", "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "iso-off-outline",
        type: "line",
        source: "iso-off",
        paint: { "line-color": "#33413a", "line-width": 2, "line-dasharray": [2, 1.5] },
      });
      mapRef.current = map;
      setLoaded(true);
    });
    return () => {
      disposed = true;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // 到達圏ポリゴンの差し替え（スライダー・トグル追従）
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !loaded) return;
    const onSource = map.getSource("iso-on") as maplibregl.GeoJSONSource | undefined;
    const offSource = map.getSource("iso-off") as maplibregl.GeoJSONSource | undefined;
    if (onSource === undefined || offSource === undefined) return; // 破棄済みマップへの操作を避ける
    onSource.setData(emptyFc(onFeature));
    offSource.setData(emptyFc(offFeature));
  }, [onFeature, offFeature, loaded]);

  // 基準地点マーカーと視野合わせ（地点変更・データ読込時のみ）
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !loaded) return;
    // MarkerはsetLngLatを先に呼んでからaddToする（座標未設定でaddToすると内部で座標参照に失敗する）
    if (markerRef.current === null) {
      markerRef.current = new maplibregl.Marker({ color: "#2e6e4e" })
        .setLngLat([center.lon, center.lat])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([center.lon, center.lat]);
    }

    if (boundsFeature !== null && boundsFeature.geometry.type === "Polygon") {
      const ring = (boundsFeature.geometry.coordinates as number[][][])[0]!;
      const bounds = ring.reduce(
        (b, pt) => b.extend([pt[0]!, pt[1]!]),
        new maplibregl.LngLatBounds([center.lon, center.lat], [center.lon, center.lat]),
      );
      map.fitBounds(bounds, { padding: 40, duration: 300 });
    } else {
      map.flyTo({ center: [center.lon, center.lat], zoom: 13, duration: 300 });
    }
  }, [center, boundsFeature, loaded]);

  if (failed) {
    return (
      <div className="route-map map-fallback" role="status">
        地図を表示できません
      </div>
    );
  }
  return <div ref={containerRef} className="route-map" aria-hidden="true" />;
}
