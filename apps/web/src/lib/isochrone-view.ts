// 到達圏モード（S7、docs/15 3.7節）の表示ヘルパー。
// スライダー操作のたびに再計算せず、全cutoffを1回のisochrone呼び出しで取得して切り替える。

import type { IsochroneResult } from "@norishiro/router";

export type IsochroneFeature = IsochroneResult["features"][number];

/** 時間スライダーの刻み: 5分〜60分の5分刻み（docs/15 3.7節「0〜60分程度」） */
export const ISOCHRONE_CUTOFFS: number[] = Array.from({ length: 12 }, (_, i) => (i + 1) * 300);

/** 指定cutoff秒のfeatureを返す。到達点3未満でポリゴン化されなかったcutoffはnull */
export function pickCutoffFeature(
  result: IsochroneResult,
  cutoffSec: number,
): IsochroneFeature | null {
  return result.features.find((f) => f.properties.cutoffSec === cutoffSec) ?? null;
}
