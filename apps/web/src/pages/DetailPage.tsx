// S4: 経路詳細画面（docs/15 3.4節）。地図＋レッグ単位の内訳。Flexレッグがあれば
// 予約案内パネル（S5、docs/15 3.5節）へ接続する。
// レッグのテキスト情報が主・地図は従（地図の成否に関係なくテキストは表示され続ける）。
// 経路データはS3からlocation stateで受け取る。直接アクセス・リロード時は結果一覧へ戻す。
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { FlexLeg, Itinerary, Leg, LocationRef } from "@norishiro/router";
import { BookingPanel } from "../components/BookingPanel.js";
import type { MapFlexArea, MapLineSegment } from "../components/RouteMap.js";
import { formatClock, formatDurationMin } from "../lib/format.js";
import { convexHull, type LatLon } from "../lib/geo-hull.js";
import { parseResultQuery } from "../lib/result-query.js";
import { currentNow, type SearchNow } from "../lib/time.js";
import { getRouterClient } from "../worker/client.js";
import type { StopPoint } from "../worker/router-worker.js";

// MapLibre（約240KB gzip）は詳細画面でのみ必要なため遅延読み込みする
const RouteMap = lazy(() =>
  import("../components/RouteMap.js").then((m) => ({ default: m.RouteMap })),
);

interface DetailNavState {
  itinerary: Itinerary;
  serviceDate: number;
}

function isDetailNavState(value: unknown): value is DetailNavState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["serviceDate"] === "number" && typeof v["itinerary"] === "object";
}

interface ResolvedDetail {
  points: Record<string, StopPoint>;
  routeNames: Record<string, string>;
  areas: MapFlexArea[];
}

function collectIds(legs: readonly Leg[]): {
  stopIds: string[];
  routeIds: string[];
  groupIds: string[];
} {
  const stopIds = new Set<string>();
  const routeIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const leg of legs) {
    if (leg.kind === "walk") {
      for (const ref of [leg.from, leg.to]) {
        if (ref.kind === "stopId") stopIds.add(ref.stopId);
      }
    } else {
      stopIds.add(leg.fromStopId);
      stopIds.add(leg.toStopId);
      if (leg.kind === "transit") {
        routeIds.add(leg.routeId);
        leg.intermediateStopIds?.forEach((id) => stopIds.add(id));
      } else {
        groupIds.add(leg.locationGroupId);
      }
    }
  }
  return { stopIds: [...stopIds], routeIds: [...routeIds], groupIds: [...groupIds] };
}

function refCoord(ref: LocationRef, points: Record<string, StopPoint>): LatLon | null {
  if (ref.kind === "coord") return { lat: ref.lat, lon: ref.lon };
  const p = points[ref.stopId];
  return p === undefined ? null : { lat: p.lat, lon: p.lon };
}

function stopName(stopId: string, points: Record<string, StopPoint>): string {
  return points[stopId]?.name ?? stopId;
}

/** レッグの出発側の地点ラベル。coord地点は検索条件のラベル（現在地等）で補う */
function legFromLabel(leg: Leg, points: Record<string, StopPoint>, coordFallback: string): string {
  if (leg.kind === "walk") {
    return leg.from.kind === "stopId" ? stopName(leg.from.stopId, points) : coordFallback;
  }
  return stopName(leg.fromStopId, points);
}

function legToLabel(leg: Leg, points: Record<string, StopPoint>, coordFallback: string): string {
  if (leg.kind === "walk") {
    return leg.to.kind === "stopId" ? stopName(leg.to.stopId, points) : coordFallback;
  }
  return stopName(leg.toStopId, points);
}

function legModeText(leg: Leg, routeNames: Record<string, string>): string {
  const duration = formatDurationMin(leg.arrivalTime - leg.departureTime);
  if (leg.kind === "walk") {
    return `🚶 徒歩 約${duration}（約${Math.round(leg.distanceMeters)}m）`;
  }
  if (leg.kind === "transit") {
    return `🚌 ${routeNames[leg.routeId] ?? leg.routeId} 約${duration}`;
  }
  return `🚐 デマンド交通（要予約） 約${duration}（目安）`;
}

function buildMapLines(legs: readonly Leg[], points: Record<string, StopPoint>): MapLineSegment[] {
  const lines: MapLineSegment[] = [];
  for (const leg of legs) {
    if (leg.kind === "walk") {
      const a = refCoord(leg.from, points);
      const b = refCoord(leg.to, points);
      if (a !== null && b !== null) lines.push({ kind: "walk", path: [a, b] });
      continue;
    }
    const from = refCoord({ kind: "stopId", stopId: leg.fromStopId }, points);
    const to = refCoord({ kind: "stopId", stopId: leg.toStopId }, points);
    if (from === null || to === null) continue;
    if (leg.kind === "transit") {
      const mids = (leg.intermediateStopIds ?? [])
        .map((id) => refCoord({ kind: "stopId", stopId: id }, points))
        .filter((p): p is LatLon => p !== null);
      lines.push({ kind: "transit", path: [from, ...mids, to] });
    } else {
      lines.push({ kind: "flexPath", path: [from, to] });
    }
  }
  return lines;
}

export function DetailPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const navState: unknown = location.state;
  const query = useMemo(
    () => parseResultQuery(new URLSearchParams(location.search)),
    [location.search],
  );

  const state = isDetailNavState(navState) ? navState : null;
  const [resolved, setResolved] = useState<ResolvedDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  // 締切カウントダウンの周期更新（S3と同じ15秒）
  const [nowTick, setNowTick] = useState<SearchNow>(() => currentNow());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(currentNow()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state === null) return;
    let cancelled = false;
    void (async () => {
      const client = getRouterClient();
      try {
        await client.ready();
        const { stopIds, routeIds, groupIds } = collectIds(state.itinerary.legs);
        const [points, routeNames, ...groupStops] = await Promise.all([
          client.stopPoints(stopIds),
          client.routeNames(routeIds),
          ...groupIds.map((id) => client.flexAreaStops(id)),
        ]);
        const areas: MapFlexArea[] = groupStops.map((pts) => ({ hull: convexHull(pts) }));
        if (!cancelled) setResolved({ points, routeNames, areas });
      } catch {
        // 名称解決に失敗してもstopIdフォールバックでテキスト表示は継続できる
        if (!cancelled) setResolved({ points: {}, routeNames: {}, areas: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  // パネル展開時は電話ボタンが見える位置まで移動し、フォーカスも移す（docs/15 3.4節・5.3節）
  useEffect(() => {
    if (panelOpen && panelRef.current !== null) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      panelRef.current.focus({ preventScroll: true });
    }
  }, [panelOpen, resolved]);

  if (state === null) {
    // 直接アクセス・リロード時は同条件の結果一覧へ（経路データはstate渡しのため）
    return <Navigate to={query === null ? "/" : `/result${location.search}`} replace />;
  }

  const { itinerary, serviceDate } = state;
  const legs = itinerary.legs;
  const points = resolved?.points ?? {};
  const routeNames = resolved?.routeNames ?? {};
  const fromFallback = query === null ? "出発地" : placeLabelOf(query.from);
  const toFallback = query === null ? "目的地" : placeLabelOf(query.to);

  const flexLeg = legs.find((leg): leg is FlexLeg => leg.kind === "flex");
  const lastLeg = legs[legs.length - 1];

  const mapLines = resolved === null ? [] : buildMapLines(legs, points);
  const origin = legs.length > 0 ? legOriginCoord(legs[0]!, points) : null;
  const destination = lastLeg !== undefined ? legDestCoord(lastLeg, points) : null;

  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={() => void navigate(-1)}>
          ‹ 戻る
        </button>
        <h1 className="heading">経路の詳細</h1>
      </header>

      {resolved !== null && (
        <Suspense fallback={<div className="route-map map-fallback">地図を読み込み中…</div>}>
          <RouteMap
            lines={mapLines}
            areas={resolved.areas}
            origin={origin ?? undefined}
            destination={destination ?? undefined}
          />
        </Suspense>
      )}

      <ol className="leg-list" aria-label="経路の内訳">
        {legs.map((leg, i) => (
          <li key={i}>
            <p className="leg-point">
              <span className="leg-time">{formatClock(leg.departureTime)}</span>
              <span>{legFromLabel(leg, points, fromFallback)}</span>
            </p>
            <p className="leg-mode">{legModeText(leg, routeNames)}</p>
          </li>
        ))}
        {lastLeg !== undefined && (
          <li>
            <p className="leg-point">
              <span className="leg-time">{formatClock(lastLeg.arrivalTime)}</span>
              <span>{legToLabel(lastLeg, points, toFallback)}</span>
            </p>
          </li>
        )}
      </ol>

      {flexLeg !== undefined && !panelOpen && (
        <button type="button" className="btn btn-primary" onClick={() => setPanelOpen(true)}>
          ▼ 予約について見る
        </button>
      )}
      {flexLeg !== undefined && panelOpen && (
        <BookingPanel
          ref={panelRef}
          leg={flexLeg}
          fromName={stopName(flexLeg.fromStopId, points)}
          toName={stopName(flexLeg.toStopId, points)}
          serviceDate={serviceDate}
          now={nowTick}
        />
      )}
    </main>
  );
}

function placeLabelOf(
  place: { kind: "stop"; name: string } | { kind: "coord"; label: string },
): string {
  return place.kind === "stop" ? place.name : place.label;
}

function legOriginCoord(leg: Leg, points: Record<string, StopPoint>): LatLon | null {
  return leg.kind === "walk"
    ? refCoord(leg.from, points)
    : refCoord({ kind: "stopId", stopId: leg.fromStopId }, points);
}

function legDestCoord(leg: Leg, points: Record<string, StopPoint>): LatLon | null {
  return leg.kind === "walk"
    ? refCoord(leg.to, points)
    : refCoord({ kind: "stopId", stopId: leg.toStopId }, points);
}
