// GTFS/GTFS-Flex Raw層の型定義（docs/10_GTFS-Flex実装仕様.md 4.3節準拠）。
// 公式仕様上「必須」の列も実データでは欠落しうるため、全フィールドをoptional・値は文字列のままとする。
// 未知の列も許容する（インデックスシグネチャ）。

/** CSVから読み取った直後の任意の1行 */
export type RawRow = Record<string, string | undefined>;

export interface RawAgencyRow extends RawRow {
  agency_id?: string;
  agency_name?: string;
  agency_url?: string;
  agency_timezone?: string;
  agency_lang?: string;
  agency_phone?: string;
}

export interface RawStopRow extends RawRow {
  stop_id?: string;
  stop_name?: string;
  stop_lat?: string;
  stop_lon?: string;
  location_type?: string;
  zone_id?: string;
}

export interface RawRouteRow extends RawRow {
  route_id?: string;
  agency_id?: string;
  route_short_name?: string;
  route_long_name?: string;
  route_type?: string;
  route_desc?: string;
  route_color?: string;
  route_text_color?: string;
}

export interface RawTripRow extends RawRow {
  route_id?: string;
  service_id?: string;
  trip_id?: string;
  trip_headsign?: string;
  direction_id?: string;
}

export interface RawCalendarRow extends RawRow {
  service_id?: string;
  monday?: string;
  tuesday?: string;
  wednesday?: string;
  thursday?: string;
  friday?: string;
  saturday?: string;
  sunday?: string;
  start_date?: string;
  end_date?: string;
}

export interface RawCalendarDateRow extends RawRow {
  service_id?: string;
  date?: string;
  exception_type?: string;
}

export interface RawLocationGroupRow extends RawRow {
  location_group_id?: string;
  location_group_name?: string;
}

export interface RawLocationGroupStopRow extends RawRow {
  location_group_id?: string;
  stop_id?: string;
}

export interface RawStopTimeRow extends RawRow {
  trip_id?: string;
  stop_id?: string;
  location_group_id?: string;
  location_id?: string;
  stop_sequence?: string;
  arrival_time?: string;
  departure_time?: string;
  start_pickup_drop_off_window?: string;
  end_pickup_drop_off_window?: string;
  pickup_type?: string;
  drop_off_type?: string;
  pickup_booking_rule_id?: string;
  drop_off_booking_rule_id?: string;
  timepoint?: string;
  mean_duration_factor?: string;
  mean_duration_offset?: string;
  safe_duration_factor?: string;
  safe_duration_offset?: string;
}

export interface RawBookingRuleRow extends RawRow {
  booking_rule_id?: string;
  booking_type?: string;
  prior_notice_duration_min?: string;
  prior_notice_duration_max?: string;
  prior_notice_last_day?: string;
  prior_notice_last_time?: string;
  prior_notice_start_day?: string;
  prior_notice_start_time?: string;
  prior_notice_service_id?: string;
  message?: string;
  pickup_message?: string;
  drop_off_message?: string;
  phone_number?: string;
  info_url?: string;
  booking_url?: string;
}

export interface RawTranslationRow extends RawRow {
  table_name?: string;
  field_name?: string;
  language?: string;
  translation?: string;
  record_id?: string;
  record_sub_id?: string;
  field_value?: string;
}

export interface RawFeedInfoRow extends RawRow {
  feed_publisher_name?: string;
  feed_publisher_url?: string;
  feed_lang?: string;
  feed_start_date?: string;
  feed_end_date?: string;
  feed_version?: string;
  feed_contact_email?: string;
}

/**
 * locations.geojson のRaw構造（docs/10 2.1節）。
 * JSON.parse直後の値を最小限の形で受け止める（検証はNormalized層で行う）。
 */
export interface RawLocationsGeojson {
  type?: string;
  features?: RawLocationFeature[];
}

export interface RawLocationFeature {
  type?: string;
  id?: string | number;
  properties?: {
    stop_name?: string;
    stop_desc?: string;
    zone_id?: string;
    stop_url?: string;
  } | null;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
}
