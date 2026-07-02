// GTFS/GTFS-Flex Normalized層の型定義（docs/10_GTFS-Flex実装仕様.md 4.3節準拠）。
// 型変換・検証・欠損補完を経た後の型。実装コード（RAPTOR拡張等）はこの層のみを見る。

/**
 * GTFS時刻。深夜0時からの経過秒数（24:00:00超の値も許容、例: 25:30:00 = 91800）。
 */
export type GtfsTime = number;

export type PickupDropOffType = 0 | 1 | 2 | 3;

/** stop_times行の乗降場所参照（docs/10 4.3節） */
export type LocationRef =
  | { kind: "stop"; stopId: string }
  | { kind: "locationGroup"; locationGroupId: string }
  | { kind: "location"; locationId: string }
  | { kind: "unresolved" };

export interface NormalizedStopTime {
  tripId: string;
  stopSequence: number;
  locationRef: LocationRef;
  arrivalTime?: GtfsTime;
  departureTime?: GtfsTime;
  /** start/endが両方揃っている場合のみ設定。時間情報が皆無の行は終日（00:00-24:00）で補完される */
  pickupWindow?: { start: GtfsTime; end: GtfsTime };
  pickupType: PickupDropOffType;
  dropOffType: PickupDropOffType;
  pickupBookingRuleId?: string;
  dropOffBookingRuleId?: string;
  timepoint?: 0 | 1;
}

/** stop_times行の乗降役割の分類（docs/10 3.3節） */
export type RowRole = "pickup_only" | "dropoff_only" | "both" | "neither";

export type BookingType = 0 | 1 | 2;

export interface NormalizedBookingRule {
  bookingRuleId: string;
  bookingType: BookingType;
  priorNoticeDurationMin?: number;
  priorNoticeDurationMax?: number;
  priorNoticeLastDay?: number;
  priorNoticeLastTime?: GtfsTime;
  priorNoticeStartDay?: number;
  priorNoticeStartTime?: GtfsTime;
  priorNoticeServiceId?: string;
  message?: string;
  pickupMessage?: string;
  dropOffMessage?: string;
  phoneNumber?: string;
  infoUrl?: string;
  bookingUrl?: string;
}

export interface NormalizedCalendar {
  serviceId: string;
  days: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
    sunday: boolean;
  };
  /** YYYYMMDD形式の文字列のまま保持する */
  startDate?: string;
  endDate?: string;
}

export interface NormalizedCalendarDate {
  serviceId: string;
  /** YYYYMMDD */
  date: string;
  /** 1=運行日追加, 2=運休 */
  exceptionType: 1 | 2;
}

export interface NormalizedStop {
  stopId: string;
  name?: string;
  lat?: number;
  lon?: number;
  locationType?: number;
}

export interface NormalizedLocationGroup {
  locationGroupId: string;
  name?: string;
}

export interface NormalizedTrip {
  tripId: string;
  routeId?: string;
  serviceId?: string;
  headsign?: string;
  directionId?: number;
}

export interface NormalizedRoute {
  routeId: string;
  agencyId?: string;
  shortName?: string;
  longName?: string;
  routeType?: number;
  color?: string;
  textColor?: string;
}

export interface NormalizedAgency {
  agencyId?: string;
  name?: string;
  url?: string;
  timezone?: string;
  lang?: string;
  phone?: string;
}

export interface NormalizedTranslation {
  tableName?: string;
  fieldName?: string;
  language?: string;
  translation?: string;
  recordId?: string;
  recordSubId?: string;
  fieldValue?: string;
}

export interface NormalizedFeedInfo {
  publisherName?: string;
  publisherUrl?: string;
  lang?: string;
  startDate?: string;
  endDate?: string;
  version?: string;
  contactEmail?: string;
}

/** locations.geojsonの正規化済みロケーション（Polygon/MultiPolygonのみ） */
export interface NormalizedFlexLocation {
  locationId: string;
  name?: string;
  geometryType: "Polygon" | "MultiPolygon";
  /** GeoJSON標準の[lon, lat]順の座標配列（構造はgeometryTypeに従う） */
  coordinates: unknown;
}

/**
 * パース警告の分類型（docs/10 4.3節・docs/12 3章のエラー分類方針に倣う）。
 * 致命的な例外は投げず、警告として呼び出し元へ返す。
 */
export type ParseWarningCode =
  | "row_dropped" // 必須キー欠損等で行を破棄した
  | "unresolved_location" // stop_id/location_group_id/location_idが3つとも欠損
  | "foreign_key_mismatch" // 参照先レコードが存在しない
  | "invalid_value" // 型変換に失敗した値（フォールバック適用済み）
  | "spec_violation" // 仕様上の組み合わせ違反（継続可能）
  | "encoding_fallback"; // UTF-8でデコードできずShift_JISへフォールバックした

export interface ParseWarning {
  code: ParseWarningCode;
  /** 対象ファイル名（例: "stop_times.txt"） */
  file: string;
  /** 開発者向けの詳細メッセージ */
  message: string;
  /** データ行番号（ヘッダーを除く1始まり）。行に紐付かない警告では省略 */
  row?: number;
}

/** パース済みFlexフィード全体（Raw層とNormalized層の両方を保持する） */
export interface ParsedFlexFeed {
  normalized: {
    agencies: NormalizedAgency[];
    stops: NormalizedStop[];
    routes: NormalizedRoute[];
    trips: NormalizedTrip[];
    calendars: NormalizedCalendar[];
    calendarDates: NormalizedCalendarDate[];
    locationGroups: NormalizedLocationGroup[];
    /** location_group_id → 所属stop_idの集合（location_group_stops.txt由来） */
    locationGroupStops: Map<string, Set<string>>;
    stopTimes: NormalizedStopTime[];
    /** booking_rule_id → ルール */
    bookingRules: Map<string, NormalizedBookingRule>;
    translations: NormalizedTranslation[];
    feedInfo?: NormalizedFeedInfo;
    flexLocations: NormalizedFlexLocation[];
  };
  /** locations.geojsonがフィードに存在したか（不存在は警告ではなく正常系、T-P01） */
  locationsGeojsonPresent: boolean;
  /** 入力に存在しなかったファイル名の一覧（Optionalファイルの欠如は正常系） */
  missingFiles: string[];
  warnings: ParseWarning[];
}
