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

/**
 * 乗降にあたって利用者が取る必要のある手続き（docs/10 2.5.1節の
 * `pickup_type`/`drop_off_type` の値2・3に対応）。
 * - `phone_agency`: 事業者への電話連絡が必要（値2）
 * - `coordinate_with_driver`: 運転手との調整が必要（値3）
 * 値1（乗車不可／降車不可）は経路として成立しないため、ここには現れない。
 */
export type BoardingRequirement = "phone_agency" | "coordinate_with_driver";

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
  /** 乗車に手続きが必要な場合のみ設定（pickup_type=2/3）。通常の乗車では未定義 */
  boardingRequirement?: BoardingRequirement;
  /** 降車に手続きが必要な場合のみ設定（drop_off_type=2/3）。通常の降車では未定義 */
  alightingRequirement?: BoardingRequirement;
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
  /**
   * 事前の予約・連絡が必要な行程か。
   * Flexレッグを含む場合、または固定路線レッグの乗降に事業者への電話連絡が必要
   * （`pickup_type`/`drop_off_type`=2）な場合にtrue。
   * 運転手との調整のみ（値3）は事前予約ではないためtrueにしない。
   */
  requiresBooking: boolean;
}

export interface Itinerary {
  legs: Leg[];
  summary: ItinerarySummary;
}

/**
 * isochroneのオプション（docs/13 8章への追加的拡張、経緯はdocs/17 C-18）。
 * docs/15 3.7節の到達圏モード（デマンド交通あり/なしのBefore/After・日付指定）が必要とする。
 */
export interface IsochroneOptions {
  /** falseでFlexレッグを除いた到達圏を計算する。既定true */
  includeFlex?: boolean;
  /** 対象サービス日（YYYYMMDD）。省略時はシャードの既定サービス日 */
  serviceDate?: number;
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
