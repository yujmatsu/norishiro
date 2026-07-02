// @norishiro/router — RAPTOR＋Flex仮想レッグ拡張の経路探索コア（docs/13準拠）。
// 公開契約はdocs/13 8章のみ。内部型（RouterShard等）は公開しない。
// 環境非依存（fetch・fs・DOM APIに依存しない）。packages/gtfsに依存しない。
export type {
  FlexBookingInfo,
  FlexLeg,
  IsochroneFeatureProperties,
  IsochroneResult,
  Itinerary,
  ItinerarySummary,
  Leg,
  LegKind,
  LocationRef,
  PlanRequest,
  TransitLeg,
  WalkLeg,
} from "./public-types.js";
export { RouterInputError } from "./errors.js";
export { loadShard, type RouterShardHandle } from "./load-shard.js";
export { isochrone, plan } from "./api.js";
