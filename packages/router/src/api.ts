// 公開関数 plan() / isochrone()（docs/13 8章の契約）。
// シャード参照はloadShard()が設定するアクティブシャードを使う（docs/13 11.2節U-3の暫定方式）。
import { RouterInputError } from "./errors.js";
import { haversineMeters, walkDurationSec, WALK_LIMIT_METERS_DEFAULT } from "./geo.js";
import { buildIsochronePolygons } from "./isochrone.js";
import { getActiveShard, gridQuery } from "./load-shard.js";
import type { IsochroneResult, Itinerary, LocationRef, PlanRequest } from "./public-types.js";
import { DEFAULT_MAX_TRANSFERS, runRaptor, type EgressTarget } from "./raptor.js";
import { reconstructItineraries } from "./reconstruct.js";
import type { AccessLegSet, RouterShard, SearchTimeContext } from "./types.js";

/** 座標 or stopIdの地点参照を徒歩到達可能なstop集合へ解決する（docs/13 5.2節・5.4節） */
function resolveLocation(shard: RouterShard, ref: LocationRef, walkLimit: number): AccessLegSet {
  if (ref.kind === "stopId") {
    const stopIdx = shard.stopIdxOf.get(ref.stopId);
    if (stopIdx === undefined) {
      throw new RouterInputError(`stopId"${ref.stopId}"がシャードに存在しない`);
    }
    return { reachableStops: [{ stopIdx, walkSec: 0, distanceM: 0 }] };
  }

  const reachableStops: AccessLegSet["reachableStops"] = [];
  for (const stopIdx of gridQuery(shard, ref.lat, ref.lon, walkLimit)) {
    const d = haversineMeters(ref.lat, ref.lon, shard.stopLat[stopIdx]!, shard.stopLon[stopIdx]!);
    if (d <= walkLimit) {
      reachableStops.push({ stopIdx, walkSec: walkDurationSec(d), distanceM: d });
    }
  }
  return { reachableStops };
}

function requireActiveShard(): RouterShard {
  const shard = getActiveShard();
  if (shard === null) {
    throw new RouterInputError("シャードが未ロード。先にloadShard()を呼ぶこと");
  }
  return shard;
}

/** 探索基準時刻の既定値（実装側の現在時刻、docs/13 8章PlanRequest.searchTime） */
function currentSearchTime(): SearchTimeContext {
  const now = new Date();
  return {
    serviceDate: now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate(),
    nowSec: now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds(),
  };
}

/**
 * 出発時刻指定での経路探索。Pareto最適な(乗換回数, 到着時刻)の組を全て返す（docs/13 8章）。
 */
export function plan(req: PlanRequest): Itinerary[] {
  if (typeof req.departureTime !== "number" || !Number.isFinite(req.departureTime)) {
    throw new RouterInputError(
      "departureTimeは必須（v1は出発時刻指定のみ対応。到着時刻指定は非スコープNS-1）",
    );
  }
  if (!req.origin || !req.destination) {
    throw new RouterInputError("originとdestinationは必須");
  }
  const shard = requireActiveShard();
  const walkLimit = req.walkLimit ?? WALK_LIMIT_METERS_DEFAULT;
  const serviceDate = req.serviceDate ?? shard.defaultServiceDate;
  const searchTime = req.searchTime ?? currentSearchTime();

  const access = resolveLocation(shard, req.origin, walkLimit);
  const egressSet = resolveLocation(shard, req.destination, walkLimit);
  if (access.reachableStops.length === 0 || egressSet.reachableStops.length === 0) {
    return [];
  }
  const egress: EgressTarget[] = egressSet.reachableStops;

  const { state } = runRaptor(shard, {
    access,
    departureTime: req.departureTime,
    serviceDate,
    maxTransfers: req.maxTransfers ?? DEFAULT_MAX_TRANSFERS,
    searchTime,
    targetPruneInit: Infinity,
    egress,
  });

  return reconstructItineraries(
    shard,
    state,
    req.departureTime,
    req.origin,
    req.destination,
    egress,
  );
}

/**
 * 到達圏算出（docs/13 7章）。cutoffsで指定した秒数ごとの到達可能領域をGeoJSONで返す。
 */
export function isochrone(
  origin: LocationRef,
  departureTime: number,
  cutoffs: number[],
): IsochroneResult {
  if (typeof departureTime !== "number" || !Number.isFinite(departureTime)) {
    throw new RouterInputError("departureTimeは必須");
  }
  if (!Array.isArray(cutoffs) || cutoffs.length === 0) {
    throw new RouterInputError("cutoffsは1つ以上必要");
  }
  const shard = requireActiveShard();
  const serviceDate = shard.defaultServiceDate;

  const access = resolveLocation(shard, origin, WALK_LIMIT_METERS_DEFAULT);
  if (access.reachableStops.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const { state } = runRaptor(shard, {
    access,
    departureTime,
    serviceDate,
    maxTransfers: DEFAULT_MAX_TRANSFERS,
    // 目的地が無いためmaxCutoffを枝刈り上限に使う（docs/13 7.2節）
    targetPruneInit: departureTime + Math.max(...cutoffs),
    // isochroneは到達可能性の俯瞰が目的のため、予約締切は実行可能性に反映しない
    // （締切情報のみ扱い。当日判定を発火させないserviceDate=-1を使う）
    searchTime: { serviceDate: -1, nowSec: 0 },
  });

  return buildIsochronePolygons(shard, state, departureTime, cutoffs);
}
