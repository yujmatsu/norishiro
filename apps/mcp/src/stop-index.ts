// 停留所インデックス: シャードJSONから検索用の前処理済み構造を作る。
// リクエストごとの全件文字列比較を避けるため、正規化済み名称をロード時に事前計算する
// （docs/14 6.1節S-4対策）。正規化ロジックはapps/webのstop-search.tsと同一仕様
// （NFKC＋小文字化＋ひらがな→カタカナ。apps間のimportは依存方向ルール上不可のため同実装を保持）。

import type { Shard } from "@norishiro/types";
import { ToolError } from "./errors.js";
import { haversineMeters } from "./geo.js";

export interface StopRecord {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  /** 所属するlocation_groupId（未所属はundefined） */
  flexGroupIds?: string[];
}

export interface StopIndex {
  records: StopRecord[];
  /** records[i]に対応する正規化済み名称 */
  normalized: string[];
  byStopId: Map<string, number>;
}

/** NFKC正規化（全角英数→半角、半角カナ→全角カナ）＋小文字化＋ひらがな→カタカナ */
export function normalizeForMatch(s: string): string {
  const nfkc = s.normalize("NFKC").toLowerCase().trim();
  return nfkc.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

export function buildStopIndex(shard: Shard): StopIndex {
  const flexGroupsByStop = new Map<number, string[]>();
  const flex = shard.flex;
  if (flex !== null) {
    for (let g = 0; g < flex.locationGroups.locationGroupId.length; g++) {
      const groupId = flex.locationGroups.locationGroupId[g]!;
      for (const stopIdx of flex.locationGroups.memberStopIdx[g] ?? []) {
        let list = flexGroupsByStop.get(stopIdx);
        if (list === undefined) {
          list = [];
          flexGroupsByStop.set(stopIdx, list);
        }
        list.push(groupId);
      }
    }
  }

  const records: StopRecord[] = [];
  const normalized: string[] = [];
  const byStopId = new Map<string, number>();
  for (let i = 0; i < shard.stops.stopId.length; i++) {
    const rec: StopRecord = {
      stopId: shard.stops.stopId[i]!,
      stopName: shard.stops.stopName[i]!,
      lat: shard.stops.lat[i]!,
      lon: shard.stops.lon[i]!,
    };
    const groups = flexGroupsByStop.get(i);
    if (groups !== undefined) rec.flexGroupIds = groups;
    byStopId.set(rec.stopId, records.length);
    records.push(rec);
    normalized.push(normalizeForMatch(rec.stopName));
  }
  return { records, normalized, byStopId };
}

/** 名称部分一致検索。前方一致を優先し、次いで部分一致（apps/webと同一の並び規則） */
export function searchByName(index: StopIndex, query: string, limit: number): StopRecord[] {
  const q = normalizeForMatch(query);
  if (q === "") return [];
  const prefix: StopRecord[] = [];
  const partial: StopRecord[] = [];
  for (let i = 0; i < index.records.length; i++) {
    const name = index.normalized[i]!;
    if (name.startsWith(q)) prefix.push(index.records[i]!);
    else if (name.includes(q)) partial.push(index.records[i]!);
  }
  return [...prefix, ...partial].slice(0, limit);
}

/** 半径検索。距離昇順で返す */
export function searchByRadius(
  index: StopIndex,
  lat: number,
  lon: number,
  radiusMeters: number,
  limit: number,
): Array<StopRecord & { distanceMeters: number }> {
  const hits: Array<StopRecord & { distanceMeters: number }> = [];
  for (const rec of index.records) {
    const d = haversineMeters(lat, lon, rec.lat, rec.lon);
    if (d <= radiusMeters) hits.push({ ...rec, distanceMeters: Math.round(d) });
  }
  hits.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return hits.slice(0, limit);
}

/**
 * stopName→stopIdの一意解決（docs/14 3.1節「入力の解決順序」）。
 * 判定規則（docs/17 T-12の暫定確定値）:
 *   1. 正規化完全一致がちょうど1件 → その1件に解決
 *   2. 完全一致が複数 → 曖昧としてINVALID_INPUT
 *   3. 完全一致0件で部分一致がちょうど1件 → その1件に解決
 *   4. それ以外（0件 or 複数） → INVALID_INPUT（候補一覧を付し、search_stopsでの確認を促す）
 */
export function resolveStopName(index: StopIndex, stopName: string): StopRecord {
  const q = normalizeForMatch(stopName);
  const exact: StopRecord[] = [];
  for (let i = 0; i < index.records.length; i++) {
    if (index.normalized[i] === q) exact.push(index.records[i]!);
  }
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new ToolError(
      "INVALID_INPUT",
      `停留所名「${stopName}」は同名の停留所が${exact.length}件あり一意に決まりません。search_stopsで候補を確認し、stopIdで指定してください。`,
    );
  }
  const matches = searchByName(index, stopName, 6);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new ToolError(
      "INVALID_INPUT",
      `停留所名「${stopName}」に該当する停留所が見つかりません。search_stopsで名称を変えて検索してください。`,
    );
  }
  const candidates = matches
    .slice(0, 5)
    .map((m) => m.stopName)
    .join("、");
  throw new ToolError(
    "INVALID_INPUT",
    `停留所名「${stopName}」が複数該当し一意に決まりません（候補: ${candidates}）。search_stopsで候補を確認し、stopIdで指定してください。`,
  );
}
