// packages/router の公開契約（docs/13 8章をそのまま記述）。
// 内部型（RouterShard等）はこのモジュールの外部には公開しない。

/** 座標指定 or 停留所ID指定の地点参照 */
export type LocationRef =
  { kind: "coord"; lat: number; lon: number } | { kind: "stopId"; stopId: string };

export interface PlanRequest {
  origin: LocationRef;
  destination: LocationRef;
  /** 出発時刻（サービス日の0時からの秒。24:00超え表現可）。v1では必須 */
  departureTime: number;
  /** 対象サービス日（YYYYMMDD）。省略時はシャードの既定サービス日 */
  serviceDate?: number;
  /** ラウンド数上限。省略時は6 */
  maxTransfers?: number;
  /** 徒歩距離上限（メートル）。省略時は800m */
  walkLimit?: number;
  /** 予約締切判定の基準となる「今」。省略時は実装側の現在時刻 */
  searchTime?: { serviceDate: number; nowSec: number };
}

export type LegKind = "walk" | "transit" | "flex";

export interface WalkLeg {
  kind: "walk";
  from: LocationRef;
  to: LocationRef;
  departureTime: number;
  arrivalTime: number;
  distanceMeters: number;
}

export interface TransitLeg {
  kind: "transit";
  routeId: string;
  tripId: string;
  fromStopId: string;
  toStopId: string;
  departureTime: number;
  arrivalTime: number;
  /** 経由する中間停留所のstopId列（表示用、任意） */
  intermediateStopIds?: string[];
}

export interface FlexBookingInfo {
  phoneNumber?: string;
  /** 案内文（booking_rules.message、そのまま提示。言い換え・要約をしない） */
  message?: string;
  /** 予約締切時刻（サービス日の秒）。未定義=締切不明 */
  deadline?: number;
  infoUrl?: string;
  bookingUrl?: string;
}

export interface FlexLeg {
  kind: "flex";
  locationGroupId: string;
  tripId: string;
  fromStopId: string;
  toStopId: string;
  /** 乗車推定時刻（=前レッグの到着時刻） */
  departureTime: number;
  /** 降車推定時刻（Haversine推定。あくまで目安） */
  arrivalTime: number;
  booking: FlexBookingInfo;
}

export type Leg = WalkLeg | TransitLeg | FlexLeg;

export interface ItinerarySummary {
  departureTime: number;
  arrivalTime: number;
  durationSec: number;
  transferCount: number;
  /** legsのいずれかがFlexを含む場合true */
  requiresBooking: boolean;
}

export interface Itinerary {
  legs: Leg[];
  summary: ItinerarySummary;
}

export interface IsochroneFeatureProperties {
  cutoffSec: number;
}

/** GeoJSON FeatureCollection（Polygon/MultiPolygon） */
export type IsochroneResult = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: IsochroneFeatureProperties;
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
  }>;
};
