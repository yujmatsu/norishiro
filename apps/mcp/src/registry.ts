// シャードレジストリ: 「どの地域のシャードが存在し、どのURL・エリア名・座標範囲に対応するか」の
// 静的な対応表。docs/14 4.4節のURL構造（/shards/{shardId}.json）は最終確定前（docs/17 T-13）のため、
// v1はビルド済みシャードの実在IDをここに列挙する方式を取る。I-6（全国化）で47都道府県分へ拡張する。

export interface ShardRegistryEntry {
  shardId: string;
  /** JIS都道府県コード（"13"=東京都） */
  prefectureCode: string;
  prefectureName: string;
  /** このシャードがカバーする市区町村名（list_flex_servicesのエリア一致に使う） */
  municipalities: readonly string[];
  /** 座標→シャード解決用の外接矩形（停留所範囲＋徒歩上限を上回るマージン） */
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  /** feeds.yaml上のフィードid→提供者表示名（list_flex_servicesのproviderName） */
  providerNameByFeedId: Readonly<Record<string, string>>;
}

/** v1で配信済みのシャード一覧。13-mizuho.jsonはapps/pipelineのbuild-mizuho-shardが生成する */
export const SHARD_REGISTRY: readonly ShardRegistryEntry[] = [
  {
    shardId: "13-mizuho",
    prefectureCode: "13",
    prefectureName: "東京都",
    municipalities: ["瑞穂町", "西多摩郡瑞穂町"],
    // 停留所実測範囲 lat 35.747-35.794 / lon 139.325-139.366 に±0.03°（約3km）のマージン
    bbox: { minLat: 35.717, maxLat: 35.824, minLon: 139.295, maxLon: 139.397 },
    providerNameByFeedId: { "mizuho-flex": "瑞穂町" },
  },
];

export function shardsByCoord(lat: number, lon: number): ShardRegistryEntry[] {
  return SHARD_REGISTRY.filter(
    (e) =>
      lat >= e.bbox.minLat && lat <= e.bbox.maxLat && lon >= e.bbox.minLon && lon <= e.bbox.maxLon,
  );
}

/** エリア名（都道府県・市区町村）でのシャード解決（docs/14 3.3節）。文字列一致で解釈する */
export function shardsByArea(prefecture: string, municipality?: string): ShardRegistryEntry[] {
  const pref = prefecture.trim();
  const entries = SHARD_REGISTRY.filter((e) => e.prefectureName === pref);
  if (municipality === undefined) return entries;
  const muni = municipality.trim();
  return entries.filter((e) => e.municipalities.includes(muni));
}

export function findEntry(shardId: string): ShardRegistryEntry | undefined {
  return SHARD_REGISTRY.find((e) => e.shardId === shardId);
}
