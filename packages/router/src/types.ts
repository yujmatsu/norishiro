// packages/router の内部型（docs/13 2章のランタイム表現）。モジュール外部には公開しない。

export interface DurationEstimatorParams {
  detourFactor: number;
  averageSpeedMps: number;
  boardingBufferSec: number;
}

export interface BookingRuleTable {
  bookingRuleIds: string[];
  bookingType: Uint8Array;
  /** 未設定は-1 */
  priorNoticeDurationMin: Int32Array;
  priorNoticeDurationMax: Int32Array;
  priorNoticeLastDayOffset: Int32Array;
  priorNoticeLastTimeSec: Int32Array;
  // 表示用文字列はホットパスで参照しないため通常配列で保持（docs/13 2.5節）
  messages: (string | undefined)[];
  phoneNumbers: (string | undefined)[];
  infoUrls: (string | undefined)[];
  bookingUrls: (string | undefined)[];
}

export interface FlexGroupTable {
  flexGroupIds: string[];
  /** FlexGroupIdx -> 所属StopIdx（CSR） */
  groupStopsStart: Uint32Array;
  groupStops: Uint32Array;
  /** StopIdx -> 所属FlexGroupIdx（逆引きCSR） */
  stopGroupsStart: Uint32Array;
  stopGroups: Uint32Array;
  /** FlexGroupIdx -> FlexTripIdx（逆引きCSR、docs/13 2.5節のflexTripsForGroup） */
  groupFlexTripsStart: Uint32Array;
  groupFlexTrips: Uint32Array;
  /** FlexTripIdx -> FlexGroupIdx（多対一） */
  flexTripGroup: Uint32Array;
  flexTripIds: string[];
  /** FlexTripIdx -> 運行日（YYYYMMDD数値）リスト */
  flexTripServiceDates: number[][];
  // v1シャード（docs/12 4.4節）はFlexTripごとに単一時間窓のため、
  // docs/13 2.5節のpickupRows CSRは「1 FlexTrip = pickup行1・dropoff行1」に退化した形で保持する
  pickupWindowStart: Int32Array;
  pickupWindowEnd: Int32Array;
  /** BookingRuleTableへの添字。未設定は-1 */
  pickupBookingRuleIdx: Int32Array;
  dropoffWindowStart: Int32Array;
  dropoffWindowEnd: Int32Array;
  dropoffBookingRuleIdx: Int32Array;
  bookingRules: BookingRuleTable;
  durationEstimatorParams: DurationEstimatorParams;
}

export interface GridIndex {
  cellSizeDeg: number;
  cells: Map<string, number[]>;
}

/** loadShard()がシャードJSONから構築するランタイム内部表現（docs/13 2.2節） */
export interface RouterShard {
  stopIds: string[];
  stopNames: string[];
  stopLat: Float64Array;
  stopLon: Float64Array;
  stopCount: number;
  stopIdxOf: Map<string, number>;

  // 内部route（停留所列パターンで分割済み。1 RouteIdx = 1停留所列パターン）
  routeCount: number;
  routeTripsStart: Uint32Array;
  routeTrips: Uint32Array;
  routeStopsStart: Uint32Array;
  routeStops: Uint32Array;

  // 内部trip（固定路線のみ。Flexは含まない）
  tripCount: number;
  tripIds: string[];
  tripRouteIds: string[];
  tripRoute: Uint32Array;
  tripStopTimesOffset: Uint32Array;
  stopTimesArrival: Int32Array;
  stopTimesDeparture: Int32Array;
  tripServiceDates: number[][];

  stopRoutesStart: Uint32Array;
  stopRoutes: Uint32Array;

  transfersStart: Uint32Array;
  transfersTo: Uint32Array;
  transfersDurationSec: Int32Array;
  transfersDistanceM: Float64Array;

  /** meta.calendarWindow.from のYYYYMMDD表現（serviceDate未指定時の既定） */
  defaultServiceDate: number;
  /** serviceDate -> 固定tripのアクティブビット（遅延構築キャッシュ） */
  activeTripBitsCache: Map<number, Uint8Array>;
  /** serviceDate -> Flex tripのアクティブビット */
  activeFlexBitsCache: Map<number, Uint8Array>;

  flex: FlexGroupTable | null;
  grid: GridIndex;
}

export type LegRecord =
  | {
      kind: "walk";
      /** access徒歩（originから）の場合true。fromStopIdx=-1 */
      access: boolean;
      fromStopIdx: number;
      toStopIdx: number;
      walkSec: number;
      distanceM: number;
      round: number;
    }
  | {
      kind: "transit";
      tripIdx: number;
      routeIdx: number;
      boardStopIdx: number;
      alightStopIdx: number;
      boardSeqIdx: number;
      alightSeqIdx: number;
      departSec: number;
      arriveSec: number;
      round: number;
    }
  | {
      kind: "flex";
      flexTripIdx: number;
      groupIdx: number;
      fromStopIdx: number;
      toStopIdx: number;
      departSec: number;
      arriveSec: number;
      pickupBookingRuleIdx: number;
      dropoffBookingRuleIdx: number;
      bookingDeadlineSec?: number;
      round: number;
    };

export interface AccessLegSet {
  reachableStops: { stopIdx: number; walkSec: number; distanceM: number }[];
}

/** 予約締切判定の基準時刻（docs/13 4.4節のSearchTimeContext） */
export interface SearchTimeContext {
  serviceDate: number;
  nowSec: number;
}

export interface RaptorState {
  /** 全ラウンド共通の最良到着時刻 */
  tauBest: Float64Array;
  /** tauRounds[k] = ラウンドk終了時点の到着時刻（k=0はaccess直後） */
  tauRounds: Float64Array[];
  /** legs[k][stopIdx] = ラウンドk以内でそのstopへの最良到達を実現した直前レッグ */
  legs: (LegRecord | undefined)[][];
  /** 直前ラウンドで改善されたstop */
  marked: Set<number>;
}
