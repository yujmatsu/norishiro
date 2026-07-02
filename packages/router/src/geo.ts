// 距離・徒歩時間の共通関数（docs/13 5.1節、確定済み設計判断3）。
// Flex推定（flex.ts）と徒歩計算で同一のHaversine実装を共有する（9.1節）。

export const WALK_DETOUR_FACTOR = 1.3;
export const WALK_SPEED_MPS = (4.8 * 1000) / 3600;
export const WALK_LIMIT_METERS_DEFAULT = 800;

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function walkDurationSec(distanceMeters: number): number {
  return (distanceMeters * WALK_DETOUR_FACTOR) / WALK_SPEED_MPS;
}
