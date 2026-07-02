// @norishiro/gtfs — GTFS/GTFS-Flexパーサ（docs/10_GTFS-Flex実装仕様.md準拠）
// Raw層（全列optional・文字列のまま）とNormalized層（型変換・検証・欠損補完済み）の2層構成。
// 環境非依存の純粋TypeScript（fs等のNode固有APIに依存しない。ファイル内容は呼び出し元が渡す）。
export { decodeBytes, parseCsv } from "./csv.js";
export { parseGtfsTime, SECONDS_PER_DAY } from "./time.js";
export { classifyStopTimeRow } from "./classify.js";
export {
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
export { KNOWN_FEED_FILES, parseFlexFeed, type FlexFeedFiles } from "./feed.js";
