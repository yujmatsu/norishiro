// 地点あいまい検索（docs/15 3.2節）。シャードのstop名に対する正規化つき部分一致。
// 読み仮名対応はシャード契約（docs/12 4章）に読みが含まれないためv1では未対応（docs/17 D-10）。

export interface StopCandidate {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
}

/** NFKC正規化（全角英数→半角、半角カナ→全角カナ）＋小文字化＋ひらがな→カタカナ */
export function normalizeForMatch(s: string): string {
  const nfkc = s.normalize("NFKC").toLowerCase().trim();
  return nfkc.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/** 前方一致を優先し、次いで部分一致。空クエリは空配列 */
export function searchStopList(
  stops: readonly StopCandidate[],
  query: string,
  limit = 8,
): StopCandidate[] {
  const q = normalizeForMatch(query);
  if (q === "") return [];
  const prefix: StopCandidate[] = [];
  const partial: StopCandidate[] = [];
  for (const stop of stops) {
    const name = normalizeForMatch(stop.name);
    if (name.startsWith(q)) prefix.push(stop);
    else if (name.includes(q)) partial.push(stop);
  }
  return [...prefix, ...partial].slice(0, limit);
}
