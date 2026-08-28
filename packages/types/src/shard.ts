// シャードJSON形式の契約型（docs/12_データパイプライン設計.md 4章が正）。
// packages/router の loadShard() が読み込む入力であり、apps/pipeline が生成する出力。
// v1は圧縮JSON（列指向・配列インデックス参照方式）。破壊的変更時はschemaVersionを上げる。

export interface ShardMeta {
  /** 例: "13"(東京都) / "backbone" */
  shardId: string;
  shardKind: "prefecture" | "backbone";
  /**
   * 本形式のスキーマバージョン。routerは未知バージョンのロードを拒否する。
   * v2で`bookingRules`をトップレベルへ移動した（予約制の定時便を扱うため、docs/17 C-24）。
   */
  schemaVersion: 2;
  /** ISO 8601。ビルド実行日時 */
  generatedAt: string;
  /** カレンダー展開範囲（YYYY-MM-DD） */
  calendarWindow: { from: string; to: string };
  /** 本シャードに含まれるfeeds.yaml上のフィードid一覧 */
  sourceFeedIds: string[];
  feedStatus: Record<string, "ok" | "ok_with_warnings" | "stale" | "skipped">;
}

/** 列指向表現: 同じインデックスiの各配列要素が「stop[i]」を構成する */
export interface CompressedStops {
  stopId: string[];
  stopName: string[];
  lat: number[];
  lon: number[];
  sourceFeedId: string[];
  mergedFrom?: (string[] | null)[];
}

export interface CompressedRoutes {
  routeId: string[];
  routeShortName: string[];
  routeLongName: string[];
  routeType: number[];
  sourceFeedId: string[];
}

export interface CompressedTrips {
  tripId: string[];
  /** CompressedRoutes配列内のインデックス参照 */
  routeIdx: number[];
  /** カレンダー展開結果。運行するYYYY-MM-DDの配列 */
  serviceDates: string[][];
  headsign: (string | null)[];
}

export interface CompressedStopTimes {
  /** CompressedTrips配列内のインデックス参照 */
  tripIdx: number[];
  stopSequence: number[];
  /** CompressedStops配列内のインデックス参照。Flexのlocation_group行は-1 */
  stopIdx: number[];
  /** 当日0時からの秒数。nullは時間窓方式(Flex)のため個別時刻を持たない行 */
  arrivalSec: (number | null)[];
  departureSec: (number | null)[];
  pickupType: number[];
  dropOffType: number[];
  /**
   * 乗車側の予約ルール参照（`CompressedBookingRules`配列内インデックス）。参照なしはnull。
   * 予約が必要な便を1件も含まないシャードでは列自体を省略できる（省略時は全行参照なし扱い）。
   */
  pickupBookingRuleIdx?: (number | null)[];
  /** 降車側の予約ルール参照。仕様は`pickupBookingRuleIdx`と同じ */
  dropOffBookingRuleIdx?: (number | null)[];
}

export interface CompressedLocationGroups {
  locationGroupId: string[];
  locationGroupName: (string | null)[];
  /** CompressedStops配列内インデックスの配列 */
  memberStopIdx: number[][];
}

export interface CompressedFlexTrips {
  /** CompressedTrips配列内インデックス参照 */
  tripIdx: number[];
  /** CompressedLocationGroups配列内インデックス参照 */
  locationGroupIdx: number[];
  /** start_pickup_drop_off_window、当日0時からの秒数 */
  windowStartSec: number[];
  windowEndSec: number[];
  pickupBookingRuleIdx: (number | null)[];
  dropOffBookingRuleIdx: (number | null)[];
  meanDurationFactor: (number | null)[];
  meanDurationOffset: (number | null)[];
}

export interface CompressedBookingRules {
  bookingRuleId: string[];
  bookingType: number[];
  priorNoticeDurationMin: (number | null)[];
  priorNoticeDurationMax: (number | null)[];
  priorNoticeLastDay: (number | null)[];
  /** "HH:MM:SS" */
  priorNoticeLastTime: (string | null)[];
  message: (string | null)[];
  phoneNumber: (string | null)[];
  infoUrl: (string | null)[];
}

/**
 * Flex（エリア型デマンド交通）固有のデータ。予約ルールは`Shard.bookingRules`が持つ
 * （停留所ベースの予約制定時便も同じテーブルを参照するため、v2でここから外した）。
 */
export interface FlexData {
  locationGroups: CompressedLocationGroups;
  flexTrips: CompressedFlexTrips;
}

export interface CompressedTransfers {
  fromStopIdx: number[];
  toStopIdx: number[];
  /** Haversine直線距離（メートル） */
  distanceM: number[];
  /** 事前計算済み徒歩時間（秒） */
  walkSec: number[];
}

export interface Shard {
  meta: ShardMeta;
  stops: CompressedStops;
  routes: CompressedRoutes;
  trips: CompressedTrips;
  stopTimes: CompressedStopTimes;
  /**
   * 予約ルールの正本。Flexレッグ（`FlexData.flexTrips`）と
   * 予約制の定時便（`CompressedStopTimes.pickupBookingRuleIdx`）の両方がここを参照する。
   * 予約ルールを持つフィードが1つも無ければnull。
   */
  bookingRules: CompressedBookingRules | null;
  /** 鉄道バックボーンでは常にnull */
  flex: FlexData | null;
  transfers: CompressedTransfers;
}
