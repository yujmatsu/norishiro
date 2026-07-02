// 検索履歴のlocalStorage保存（docs/15 3.1節・3.2節・3.6節）。
// 全てローカル保存のみでサーバー送信しない（docs/15 8章の計測方針、docs/11 5章）。

export type PlaceSelection =
  | { kind: "stop"; stopId: string; name: string }
  | { kind: "coord"; lat: number; lon: number; label: string };

export type WhenSelection =
  { type: "now" } | { type: "datetime"; serviceDate: number; timeSec: number };

export interface SearchRecord {
  from: PlaceSelection;
  to: PlaceSelection;
  when: WhenSelection;
  /** epoch ms（保存時刻、新しい順の並びに使う） */
  savedAt: number;
}

const STORAGE_KEY = "norishiro.searchHistory.v1";
const MAX_RECORDS = 20;

type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): HistoryStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null; // プライベートモード等でlocalStorage不可の場合は履歴なしで動作継続
  }
}

function isPlaceSelection(value: unknown): value is PlaceSelection {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (p["kind"] === "stop") return typeof p["stopId"] === "string" && typeof p["name"] === "string";
  if (p["kind"] === "coord") {
    return (
      typeof p["lat"] === "number" && typeof p["lon"] === "number" && typeof p["label"] === "string"
    );
  }
  return false;
}

function isSearchRecord(value: unknown): value is SearchRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isPlaceSelection(r["from"]) &&
    isPlaceSelection(r["to"]) &&
    typeof r["when"] === "object" &&
    r["when"] !== null &&
    typeof r["savedAt"] === "number"
  );
}

function placeKey(p: PlaceSelection): string {
  return p.kind === "stop" ? `stop:${p.stopId}` : `coord:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

function recordKey(r: SearchRecord): string {
  return `${placeKey(r.from)}→${placeKey(r.to)}@${r.when.type}`;
}

/** 履歴を新しい順で返す。壊れたデータは例外を投げず空扱い（寛容方針） */
export function loadHistory(storage: HistoryStorage | null = defaultStorage()): SearchRecord[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSearchRecord);
  } catch {
    return [];
  }
}

/** 同一条件（出発地・目的地・いつの種別）は重複させず最新のみ残す。最大20件 */
export function saveSearch(
  record: SearchRecord,
  storage: HistoryStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  const key = recordKey(record);
  const rest = loadHistory(storage).filter((r) => recordKey(r) !== key);
  const next = [record, ...rest].slice(0, MAX_RECORDS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 容量超過等の保存失敗は致命ではないため無視する（履歴は補助機能）
  }
}

/** 「最近の検索地点」候補（docs/15 3.2節）。stop地点のみ、重複なく新しい順 */
export function recentStopPlaces(
  storage: HistoryStorage | null = defaultStorage(),
  limit = 5,
): Array<{ stopId: string; name: string }> {
  const seen = new Set<string>();
  const result: Array<{ stopId: string; name: string }> = [];
  for (const record of loadHistory(storage)) {
    for (const place of [record.from, record.to]) {
      if (place.kind !== "stop" || seen.has(place.stopId)) continue;
      seen.add(place.stopId);
      result.push({ stopId: place.stopId, name: place.name });
      if (result.length >= limit) return result;
    }
  }
  return result;
}
