// 経路地図（docs/15 3.4節）: MapLibre GL JS＋地理院タイル（淡色）。
// 固定路線・徒歩レッグはポリライン、Flexレッグは「エリア内どこでも乗降可」を示す面表現（凸包）。
// 地図の取得・描画に失敗してもテキスト情報が主であるため、グレー縮退表示に留める（地図が主にならない）。
import { useEffect, useRef, useState, type ReactElement } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLon } from "../lib/geo-hull.js";

export interface MapLineSegment {
  kind: "walk" | "transit" | "flexPath";
  path: LatLon[];
}

export interface MapFlexArea {
  /** convex hull済みの頂点列（始点の繰り返しなし） */
  hull: LatLon[];
}

export interface RouteMapProps {
  lines: MapLineSegment[];
  areas: MapFlexArea[];
  /** 出発・到着マーカー */
  origin?: LatLon;
  destination?: LatLon;
}

/** 地理院タイル（淡色）。出典表記必須: https://maps.gsi.go.jp/development/ichiran.html */
const GSI_STYLE: StyleSpecification = {
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

const toLngLat = (p: LatLon): [number, number] => [p.lon, p.lat];

export function RouteMap({ lines, areas, origin, destination }: RouteMapProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || failed) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({ container, style: GSI_STYLE });
    } catch {
      setFailed(true); // WebGL非対応等。テキスト情報での案内に縮退
      return;
    }

    let loaded = false;
    map.on("error", () => {
      // スタイル読込前の失敗のみ縮退扱い（個別タイルの取得失敗はグレー地のまま続行）
      if (!loaded) setFailed(true);
    });

    map.on("load", () => {
      loaded = true;

      // Flexエリアの面表現（docs/15 3.4節・確定判断4）。色だけに依存せず破線の輪郭を併用（5.1節）
      map.addSource("flex-areas", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: areas
            .filter((a) => a.hull.length >= 3)
            .map((a) => ({
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "Polygon" as const,
                coordinates: [[...a.hull.map(toLngLat), toLngLat(a.hull[0]!)]],
              },
            })),
        },
      });
      map.addLayer({
        id: "flex-area-fill",
        type: "fill",
        source: "flex-areas",
        paint: { "fill-color": "#e8863a", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "flex-area-outline",
        type: "line",
        source: "flex-areas",
        paint: { "line-color": "#9a4b00", "line-width": 2, "line-dasharray": [2, 1.5] },
      });

      map.addSource("legs", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: lines
            .filter((l) => l.path.length >= 2)
            .map((l) => ({
              type: "Feature" as const,
              properties: { kind: l.kind },
              geometry: { type: "LineString" as const, coordinates: l.path.map(toLngLat) },
            })),
        },
      });
      map.addLayer({
        id: "transit-lines",
        type: "line",
        source: "legs",
        filter: ["==", ["get", "kind"], "transit"],
        paint: { "line-color": "#2e6e4e", "line-width": 4 },
      });
      map.addLayer({
        id: "flex-path-lines",
        type: "line",
        source: "legs",
        filter: ["==", ["get", "kind"], "flexPath"],
        paint: { "line-color": "#9a4b00", "line-width": 3, "line-dasharray": [1.5, 1.5] },
      });
      map.addLayer({
        id: "walk-lines",
        type: "line",
        source: "legs",
        filter: ["==", ["get", "kind"], "walk"],
        paint: { "line-color": "#4c5a53", "line-width": 3, "line-dasharray": [0.5, 1.5] },
      });

      if (origin !== undefined) {
        new maplibregl.Marker({ color: "#2e6e4e" }).setLngLat(toLngLat(origin)).addTo(map);
      }
      if (destination !== undefined) {
        new maplibregl.Marker({ color: "#b3261e" }).setLngLat(toLngLat(destination)).addTo(map);
      }

      // 経路全体（レッグ＋出発着地点）が収まる範囲へ。Flexエリア全体は含めない（町全域に広がるため）
      const focusPoints: LatLon[] = [
        ...lines.flatMap((l) => l.path),
        ...(origin !== undefined ? [origin] : []),
        ...(destination !== undefined ? [destination] : []),
      ];
      if (focusPoints.length >= 1) {
        const bounds = focusPoints.reduce(
          (b, pt) => b.extend(toLngLat(pt)),
          new maplibregl.LngLatBounds(toLngLat(focusPoints[0]!), toLngLat(focusPoints[0]!)),
        );
        map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
      }
    });

    return () => {
      map.remove();
    };
  }, [lines, areas, origin, destination, failed]);

  if (failed) {
    return (
      <div className="route-map map-fallback" role="status">
        地図を表示できません（経路の内容は下の一覧でご確認いただけます）
      </div>
    );
  }
  // 地図はテキスト情報の補助のためスクリーンリーダーからは隠す（docs/15 5.2節: 代替情報を並置）
  return <div ref={containerRef} className="route-map" aria-hidden="true" />;
}
