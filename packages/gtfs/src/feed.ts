// フィード全体のパース統合（docs/10 4.4節: ファイル読み込み全体の堅牢性）
// Optionalファイルの欠如・空ファイルは正常系。読み込み失敗＝空配列として扱う。
import type { ParsedFlexFeed, ParseWarning, RawLocationsGeojson } from "@norishiro/types";
import { decodeBytes, parseCsv } from "./csv.js";
import {
  buildLocationGroupStops,
  normalizeAgencies,
  normalizeBookingRules,
  normalizeCalendarDates,
  normalizeCalendars,
  normalizeFeedInfo,
  normalizeFlexLocations,
  normalizeLocationGroups,
  normalizeRoutes,
  normalizeStops,
  normalizeStopTimes,
  normalizeTranslations,
  normalizeTrips,
} from "./normalize.js";

/**
 * フィードの入力ファイル群。ファイル名 → 内容（テキストまたはバイト列）。
 * 存在しないファイルはキー自体を省略する（欠如は正常系として扱われる）。
 */
export type FlexFeedFiles = Partial<Record<string, string | Uint8Array>>;

/** パーサが認識するフィード構成ファイル一覧（docs/10 4.4節の12ファイル＋GeoJSON） */
export const KNOWN_FEED_FILES = [
  "agency.txt",
  "stops.txt",
  "routes.txt",
  "trips.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "location_groups.txt",
  "location_group_stops.txt",
  "stop_times.txt",
  "booking_rules.txt",
  "translations.txt",
  "feed_info.txt",
  "locations.geojson",
] as const;

/**
 * GTFS/GTFS-Flexフィードをパースする。
 * 致命的な例外を投げず、逸脱・欠損はParsedFlexFeed.warningsに分類して返す。
 */
export function parseFlexFeed(files: FlexFeedFiles): ParsedFlexFeed {
  const warnings: ParseWarning[] = [];
  const missingFiles = KNOWN_FEED_FILES.filter((name) => files[name] === undefined);

  const csv = (name: string) => {
    const content = files[name];
    return content === undefined ? [] : parseCsv(content, name, warnings);
  };

  // booking_rulesを先に構築し、stop_timesの外部キー検証（フォールバックルール5）に使う
  const bookingRules = normalizeBookingRules(csv("booking_rules.txt"), warnings);

  // locations.geojson（Optional）。不存在は正常系フラグで表現し、警告は出さない（T-P01）
  const rawGeojson = files["locations.geojson"];
  const locationsGeojsonPresent = rawGeojson !== undefined;
  let flexLocations: ParsedFlexFeed["normalized"]["flexLocations"] = [];
  if (rawGeojson !== undefined) {
    const text =
      typeof rawGeojson === "string"
        ? rawGeojson
        : decodeBytes(rawGeojson, "locations.geojson", warnings);
    try {
      const parsed = JSON.parse(text) as RawLocationsGeojson;
      flexLocations = normalizeFlexLocations(parsed, warnings);
    } catch {
      warnings.push({
        code: "invalid_value",
        file: "locations.geojson",
        message: "JSONとして解釈できないため無視した",
      });
    }
  }

  return {
    normalized: {
      agencies: normalizeAgencies(csv("agency.txt")),
      stops: normalizeStops(csv("stops.txt"), warnings),
      routes: normalizeRoutes(csv("routes.txt"), warnings),
      trips: normalizeTrips(csv("trips.txt"), warnings),
      calendars: normalizeCalendars(csv("calendar.txt"), warnings),
      calendarDates: normalizeCalendarDates(csv("calendar_dates.txt"), warnings),
      locationGroups: normalizeLocationGroups(csv("location_groups.txt"), warnings),
      locationGroupStops: buildLocationGroupStops(csv("location_group_stops.txt"), warnings),
      stopTimes: normalizeStopTimes(csv("stop_times.txt"), new Set(bookingRules.keys()), warnings),
      bookingRules,
      translations: normalizeTranslations(csv("translations.txt")),
      feedInfo: normalizeFeedInfo(csv("feed_info.txt")),
      flexLocations,
    },
    locationsGeojsonPresent,
    missingFiles,
    warnings,
  };
}
