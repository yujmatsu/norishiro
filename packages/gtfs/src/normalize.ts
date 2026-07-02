// Raw層 → Normalized層への変換（docs/10 4.3節のフォールバックルール1〜5を実装）
// 致命的な例外を投げず、逸脱は警告として呼び出し元に返す。
import type {
  BookingType,
  LocationRef,
  NormalizedAgency,
  NormalizedBookingRule,
  NormalizedCalendar,
  NormalizedCalendarDate,
  NormalizedFeedInfo,
  NormalizedFlexLocation,
  NormalizedLocationGroup,
  NormalizedRoute,
  NormalizedStop,
  NormalizedStopTime,
  NormalizedTranslation,
  NormalizedTrip,
  ParseWarning,
  PickupDropOffType,
  RawLocationsGeojson,
  RawRow,
} from "@norishiro/types";
import { parseGtfsTime, SECONDS_PER_DAY } from "./time.js";

/** 空文字・空白のみの値をundefinedに落とす（Raw層の"列は存在するが値が空"を欠損として扱う） */
function str(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function num(value: string | undefined): number | undefined {
  const s = str(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function flag(value: string | undefined): boolean {
  return str(value) === "1";
}

export function normalizeAgencies(rows: RawRow[]): NormalizedAgency[] {
  return rows.map((r) => ({
    agencyId: str(r.agency_id),
    name: str(r.agency_name),
    url: str(r.agency_url),
    timezone: str(r.agency_timezone),
    lang: str(r.agency_lang),
    phone: str(r.agency_phone),
  }));
}

export function normalizeStops(rows: RawRow[], warnings: ParseWarning[]): NormalizedStop[] {
  const stops: NormalizedStop[] = [];
  rows.forEach((r, i) => {
    const stopId = str(r.stop_id);
    if (stopId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "stops.txt",
        message: "stop_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    const lat = num(r.stop_lat);
    const lon = num(r.stop_lon);
    if (str(r.stop_lat) !== undefined && lat === undefined) {
      warnings.push({
        code: "invalid_value",
        file: "stops.txt",
        message: `stop_lat"${r.stop_lat}"を数値として解釈できない`,
        row: i + 1,
      });
    }
    stops.push({
      stopId,
      name: str(r.stop_name),
      lat,
      lon,
      locationType: num(r.location_type),
    });
  });
  return stops;
}

export function normalizeRoutes(rows: RawRow[], warnings: ParseWarning[]): NormalizedRoute[] {
  const routes: NormalizedRoute[] = [];
  rows.forEach((r, i) => {
    const routeId = str(r.route_id);
    if (routeId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "routes.txt",
        message: "route_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    routes.push({
      routeId,
      agencyId: str(r.agency_id),
      shortName: str(r.route_short_name),
      longName: str(r.route_long_name),
      routeType: num(r.route_type),
      color: str(r.route_color),
      textColor: str(r.route_text_color),
    });
  });
  return routes;
}

export function normalizeTrips(rows: RawRow[], warnings: ParseWarning[]): NormalizedTrip[] {
  const trips: NormalizedTrip[] = [];
  rows.forEach((r, i) => {
    const tripId = str(r.trip_id);
    if (tripId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "trips.txt",
        message: "trip_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    trips.push({
      tripId,
      routeId: str(r.route_id),
      serviceId: str(r.service_id),
      headsign: str(r.trip_headsign),
      directionId: num(r.direction_id),
    });
  });
  return trips;
}

export function normalizeCalendars(rows: RawRow[], warnings: ParseWarning[]): NormalizedCalendar[] {
  const calendars: NormalizedCalendar[] = [];
  rows.forEach((r, i) => {
    const serviceId = str(r.service_id);
    if (serviceId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "calendar.txt",
        message: "service_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    calendars.push({
      serviceId,
      days: {
        monday: flag(r.monday),
        tuesday: flag(r.tuesday),
        wednesday: flag(r.wednesday),
        thursday: flag(r.thursday),
        friday: flag(r.friday),
        saturday: flag(r.saturday),
        sunday: flag(r.sunday),
      },
      startDate: str(r.start_date),
      endDate: str(r.end_date),
    });
  });
  return calendars;
}

export function normalizeCalendarDates(
  rows: RawRow[],
  warnings: ParseWarning[],
): NormalizedCalendarDate[] {
  const dates: NormalizedCalendarDate[] = [];
  rows.forEach((r, i) => {
    const serviceId = str(r.service_id);
    const date = str(r.date);
    const exceptionType = num(r.exception_type);
    if (serviceId === undefined || date === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "calendar_dates.txt",
        message: "service_idまたはdateが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    if (exceptionType !== 1 && exceptionType !== 2) {
      warnings.push({
        code: "row_dropped",
        file: "calendar_dates.txt",
        message: `exception_type"${r.exception_type}"が1/2のいずれでもないため行を破棄した`,
        row: i + 1,
      });
      return;
    }
    dates.push({ serviceId, date, exceptionType });
  });
  return dates;
}

export function normalizeLocationGroups(
  rows: RawRow[],
  warnings: ParseWarning[],
): NormalizedLocationGroup[] {
  const groups: NormalizedLocationGroup[] = [];
  rows.forEach((r, i) => {
    const locationGroupId = str(r.location_group_id);
    if (locationGroupId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "location_groups.txt",
        message: "location_group_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    groups.push({ locationGroupId, name: str(r.location_group_name) });
  });
  return groups;
}

export function buildLocationGroupStops(
  rows: RawRow[],
  warnings: ParseWarning[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  rows.forEach((r, i) => {
    const groupId = str(r.location_group_id);
    const stopId = str(r.stop_id);
    if (groupId === undefined || stopId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "location_group_stops.txt",
        message: "location_group_idまたはstop_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    let set = map.get(groupId);
    if (set === undefined) {
      set = new Set<string>();
      map.set(groupId, set);
    }
    set.add(stopId);
  });
  return map;
}

export function normalizeBookingRules(
  rows: RawRow[],
  warnings: ParseWarning[],
): Map<string, NormalizedBookingRule> {
  const rules = new Map<string, NormalizedBookingRule>();
  rows.forEach((r, i) => {
    const bookingRuleId = str(r.booking_rule_id);
    if (bookingRuleId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "booking_rules.txt",
        message: "booking_rule_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }
    const bookingType = num(r.booking_type);
    if (bookingType !== 0 && bookingType !== 1 && bookingType !== 2) {
      warnings.push({
        code: "row_dropped",
        file: "booking_rules.txt",
        message: `booking_type"${r.booking_type}"が0/1/2のいずれでもないため行を破棄した`,
        row: i + 1,
      });
      return;
    }
    const rule: NormalizedBookingRule = {
      bookingRuleId,
      bookingType: bookingType as BookingType,
      priorNoticeDurationMin: num(r.prior_notice_duration_min),
      priorNoticeDurationMax: num(r.prior_notice_duration_max),
      priorNoticeLastDay: num(r.prior_notice_last_day),
      priorNoticeLastTime: parseGtfsTime(str(r.prior_notice_last_time)),
      priorNoticeStartDay: num(r.prior_notice_start_day),
      priorNoticeStartTime: parseGtfsTime(str(r.prior_notice_start_time)),
      priorNoticeServiceId: str(r.prior_notice_service_id),
      message: str(r.message),
      pickupMessage: str(r.pickup_message),
      dropOffMessage: str(r.drop_off_message),
      phoneNumber: str(r.phone_number),
      infoUrl: str(r.info_url),
      bookingUrl: str(r.booking_url),
    };
    // 2.4.1節: booking_type=1にはprior_notice_duration_minが必須。
    // 欠損時は警告のみで継続し「締切不明」として扱う（寛容パーサ方針）
    if (rule.bookingType === 1 && rule.priorNoticeDurationMin === undefined) {
      warnings.push({
        code: "spec_violation",
        file: "booking_rules.txt",
        message: `booking_type=1のルール"${bookingRuleId}"にprior_notice_duration_minが無い（締切不明として扱う）`,
        row: i + 1,
      });
    }
    rules.set(bookingRuleId, rule);
  });
  return rules;
}

/** stop_times 1行の乗降場所参照を解決する（フォールバックルール2） */
function resolveLocationRef(r: RawRow, rowIndex: number, warnings: ParseWarning[]): LocationRef {
  const stopId = str(r.stop_id);
  const locationGroupId = str(r.location_group_id);
  const locationId = str(r.location_id);

  const definedCount = [stopId, locationGroupId, locationId].filter((v) => v !== undefined).length;
  if (definedCount > 1) {
    warnings.push({
      code: "spec_violation",
      file: "stop_times.txt",
      message:
        "stop_id/location_group_id/location_idが同時に複数定義されている（優先順で1つを採用）",
      row: rowIndex + 1,
    });
  }
  if (stopId !== undefined) return { kind: "stop", stopId };
  if (locationGroupId !== undefined) return { kind: "locationGroup", locationGroupId };
  if (locationId !== undefined) return { kind: "location", locationId };

  warnings.push({
    code: "unresolved_location",
    file: "stop_times.txt",
    message: "stop_id/location_group_id/location_idが3つとも欠損している（探索対象から除外）",
    row: rowIndex + 1,
  });
  return { kind: "unresolved" };
}

function parsePickupDropOffType(
  value: string | undefined,
  column: "pickup_type" | "drop_off_type",
  isWindowRow: boolean,
  rowIndex: number,
  warnings: ParseWarning[],
): PickupDropOffType {
  const s = str(value);
  if (s !== undefined) {
    const n = Number(s);
    if (n === 0 || n === 1 || n === 2 || n === 3) {
      // 2.5.1節の制約: 時間窓方式の行でpickup_type=0/3・drop_off_type=0は仕様違反。
      // 明示値は書き換えず警告のみ（バリデーションT-V01の対象）
      const forbidden = column === "pickup_type" ? n === 0 || n === 3 : n === 0;
      if (isWindowRow && forbidden) {
        warnings.push({
          code: "spec_violation",
          file: "stop_times.txt",
          message: `時間窓方式の行で${column}=${n}は仕様上禁止されている`,
          row: rowIndex + 1,
        });
      }
      return n as PickupDropOffType;
    }
    warnings.push({
      code: "invalid_value",
      file: "stop_times.txt",
      message: `${column}"${s}"を0-3として解釈できない（デフォルト値にフォールバック）`,
      row: rowIndex + 1,
    });
  }
  // フォールバックルール4: 欠損時は公式デフォルト0。ただし時間窓方式の行では
  // 0が仕様上禁止のため、安全側（要予約=2）にフォールバックする
  return isWindowRow ? 2 : 0;
}

export function normalizeStopTimes(
  rows: RawRow[],
  bookingRuleIds: ReadonlySet<string>,
  warnings: ParseWarning[],
): NormalizedStopTime[] {
  const stopTimes: NormalizedStopTime[] = [];
  const sequenceFallbackByTrip = new Map<string, number>();

  rows.forEach((r, i) => {
    // フォールバックルール1: trip_id欠損は行を破棄（例外は投げない）
    const tripId = str(r.trip_id);
    if (tripId === undefined) {
      warnings.push({
        code: "row_dropped",
        file: "stop_times.txt",
        message: "trip_idが欠損しているため行を破棄した",
        row: i + 1,
      });
      return;
    }

    const locationRef = resolveLocationRef(r, i, warnings);

    // stop_sequence欠損は行の出現順（トリップ内）で補完
    const occurrence = (sequenceFallbackByTrip.get(tripId) ?? 0) + 1;
    sequenceFallbackByTrip.set(tripId, occurrence);
    let stopSequence = num(r.stop_sequence);
    if (stopSequence === undefined) {
      warnings.push({
        code: "invalid_value",
        file: "stop_times.txt",
        message: `stop_sequenceが欠損しているため出現順(${occurrence})で補完した`,
        row: i + 1,
      });
      stopSequence = occurrence;
    }

    const arrivalTime = parseGtfsTime(str(r.arrival_time));
    const departureTime = parseGtfsTime(str(r.departure_time));
    const windowStart = parseGtfsTime(str(r.start_pickup_drop_off_window));
    const windowEnd = parseGtfsTime(str(r.end_pickup_drop_off_window));

    let pickupWindow: { start: number; end: number } | undefined;
    if (windowStart !== undefined && windowEnd !== undefined) {
      pickupWindow = { start: windowStart, end: windowEnd };
    } else if (windowStart !== undefined || windowEnd !== undefined) {
      warnings.push({
        code: "spec_violation",
        file: "stop_times.txt",
        message: "時間窓のstart/endの片方だけが定義されている（時間窓として扱わない）",
        row: i + 1,
      });
    }

    // フォールバックルール3: 時刻情報が皆無の行は終日利用可能（00:00-24:00）として扱う
    if (arrivalTime === undefined && departureTime === undefined && pickupWindow === undefined) {
      pickupWindow = { start: 0, end: SECONDS_PER_DAY };
    }

    const isWindowRow = pickupWindow !== undefined && arrivalTime === undefined;
    const pickupType = parsePickupDropOffType(
      r.pickup_type,
      "pickup_type",
      isWindowRow,
      i,
      warnings,
    );
    const dropOffType = parsePickupDropOffType(
      r.drop_off_type,
      "drop_off_type",
      isWindowRow,
      i,
      warnings,
    );

    // フォールバックルール5: 参照先booking_ruleが無い場合は予約制約なしとして扱う
    const resolveBookingRuleId = (
      value: string | undefined,
      column: string,
    ): string | undefined => {
      const id = str(value);
      if (id === undefined) return undefined;
      if (!bookingRuleIds.has(id)) {
        warnings.push({
          code: "foreign_key_mismatch",
          file: "stop_times.txt",
          message: `${column}"${id}"がbooking_rules.txtに存在しない（予約制約なしとして扱う）`,
          row: i + 1,
        });
        return undefined;
      }
      return id;
    };

    const timepointNum = num(r.timepoint);

    stopTimes.push({
      tripId,
      stopSequence,
      locationRef,
      arrivalTime,
      departureTime,
      pickupWindow,
      pickupType,
      dropOffType,
      pickupBookingRuleId: resolveBookingRuleId(r.pickup_booking_rule_id, "pickup_booking_rule_id"),
      dropOffBookingRuleId: resolveBookingRuleId(
        r.drop_off_booking_rule_id,
        "drop_off_booking_rule_id",
      ),
      timepoint: timepointNum === 0 || timepointNum === 1 ? timepointNum : undefined,
    });
  });
  return stopTimes;
}

export function normalizeTranslations(rows: RawRow[]): NormalizedTranslation[] {
  return rows.map((r) => ({
    tableName: str(r.table_name),
    fieldName: str(r.field_name),
    language: str(r.language),
    translation: str(r.translation),
    recordId: str(r.record_id),
    recordSubId: str(r.record_sub_id),
    fieldValue: str(r.field_value),
  }));
}

export function normalizeFeedInfo(rows: RawRow[]): NormalizedFeedInfo | undefined {
  const r = rows[0];
  if (r === undefined) return undefined;
  return {
    publisherName: str(r.feed_publisher_name),
    publisherUrl: str(r.feed_publisher_url),
    lang: str(r.feed_lang),
    startDate: str(r.feed_start_date),
    endDate: str(r.feed_end_date),
    version: str(r.feed_version),
    contactEmail: str(r.feed_contact_email),
  };
}

/** locations.geojsonの正規化（docs/10 2.1節。Polygon/MultiPolygonのみ許可） */
export function normalizeFlexLocations(
  geojson: RawLocationsGeojson,
  warnings: ParseWarning[],
): NormalizedFlexLocation[] {
  const file = "locations.geojson";
  const locations: NormalizedFlexLocation[] = [];
  if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    warnings.push({
      code: "invalid_value",
      file,
      message: "FeatureCollectionとして解釈できないため無視した",
    });
    return locations;
  }
  geojson.features.forEach((feature, i) => {
    const locationId = feature.id === undefined ? undefined : String(feature.id);
    const geometryType = feature.geometry?.type;
    if (locationId === undefined) {
      warnings.push({
        code: "row_dropped",
        file,
        message: "feature.idが欠損しているためロケーションを破棄した",
        row: i + 1,
      });
      return;
    }
    if (geometryType !== "Polygon" && geometryType !== "MultiPolygon") {
      warnings.push({
        code: "invalid_value",
        file,
        message: `geometry.type"${String(geometryType)}"はPolygon/MultiPolygon以外のため破棄した`,
        row: i + 1,
      });
      return;
    }
    locations.push({
      locationId,
      name: feature.properties?.stop_name,
      geometryType,
      coordinates: feature.geometry?.coordinates,
    });
  });
  return locations;
}
