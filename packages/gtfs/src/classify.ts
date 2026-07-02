// stop_times行の乗降役割の分類（docs/10 3.3節のロジックをそのまま実装）
import type { NormalizedStopTime, RowRole } from "@norishiro/types";

export function classifyStopTimeRow(
  row: Pick<NormalizedStopTime, "pickupType" | "dropOffType">,
): RowRole {
  const noPickup = row.pickupType === 1;
  const noDropoff = row.dropOffType === 1;

  if (noDropoff && !noPickup) return "pickup_only";
  if (noPickup && !noDropoff) return "dropoff_only";
  if (!noPickup && !noDropoff) return "both";
  // pickupType=1 かつ dropOffType=1 は通過のみ（乗降不可）の異常系
  return "neither";
}
