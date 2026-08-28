// 実データのGTFS-Flexフィードを parseFlexFeed() に通し、
// (a) パーサの実データ耐性 (b) 現行シャード契約で表現できるか を検分する。
//
// 目的は「企画で使える実データがどれだけあるか」の判定であり、シャードは生成しない。
// 入力は data/_work/flex/<事業者名>/ に展開済みのフィード（data/_scripts/ 側で展開）。
//
//   pnpm --filter @norishiro/pipeline run inspect:flex
//
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_FEED_FILES, parseFlexFeed, type FlexFeedFiles } from "@norishiro/gtfs";
import type { LocationRef, ParsedFlexFeed } from "@norishiro/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..", "..");
const flexRoot = path.join(repoRoot, "..", "data", "_work", "flex");

function loadFeed(dir: string): FlexFeedFiles {
  const files: FlexFeedFiles = {};
  for (const name of KNOWN_FEED_FILES) {
    const p = path.join(dir, name);
    if (existsSync(p)) files[name] = readFileSync(p); // バイト列で渡す（文字コード判定はパーサ側）
  }
  return files;
}

function refKind(r: LocationRef): string {
  return r.kind;
}

interface Verdict {
  agency: string;
  /** 現行シャード契約（flexTrips.locationGroupIdx 必須）で表現できるか */
  shardRepresentable: boolean;
  reasons: string[];
}

function inspect(agency: string, feed: ParsedFlexFeed): Verdict {
  const n = feed.normalized;
  const reasons: string[] = [];

  // ---- 警告の分類別集計
  const warnByCode = new Map<string, number>();
  for (const w of feed.warnings) warnByCode.set(w.code, (warnByCode.get(w.code) ?? 0) + 1);

  // ---- stop_times の locationRef 種別分布
  const kinds = new Map<string, number>();
  for (const st of n.stopTimes) {
    const k = refKind(st.locationRef);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }

  // ---- 予約ルールを要する行（Flexレッグの素）を抽出
  const flexRows = n.stopTimes.filter(
    (st) => st.pickupBookingRuleId !== undefined || st.dropOffBookingRuleId !== undefined,
  );
  const flexRowKinds = new Map<string, number>();
  for (const st of flexRows) {
    const k = refKind(st.locationRef);
    flexRowKinds.set(k, (flexRowKinds.get(k) ?? 0) + 1);
  }
  const withWindow = flexRows.filter((st) => st.pickupWindow !== undefined).length;

  // ---- booking_rule の方式分布
  const byType = new Map<number, number>();
  for (const r of n.bookingRules.values())
    byType.set(r.bookingType, (byType.get(r.bookingType) ?? 0) + 1);

  console.log(`\n=== ${agency} ===`);
  console.log(`  agency=${n.agencies.map((a) => a.name ?? "?").join("/")}`);
  console.log(
    `  stops=${n.stops.length} routes=${n.routes.length} trips=${n.trips.length} stopTimes=${n.stopTimes.length}`,
  );
  console.log(
    `  locationGroups=${n.locationGroups.length} flexLocations=${n.flexLocations.length} geojsonあり=${feed.locationsGeojsonPresent}`,
  );
  console.log(
    `  bookingRules=${n.bookingRules.size} 方式別=${JSON.stringify(Object.fromEntries(byType))}`,
  );
  console.log(
    `  警告 ${feed.warnings.length}件 内訳=${JSON.stringify(Object.fromEntries(warnByCode))}`,
  );
  console.log(`  stop_times の場所参照=${JSON.stringify(Object.fromEntries(kinds))}`);
  console.log(
    `  予約ルール付き行=${flexRows.length} 参照種別=${JSON.stringify(Object.fromEntries(flexRowKinds))} 時間窓あり=${withWindow}`,
  );
  for (const r of n.bookingRules.values()) {
    console.log(
      `    rule ${r.bookingRuleId}: type=${r.bookingType} durMin=${r.priorNoticeDurationMin ?? "-"} ` +
        `lastDay=${r.priorNoticeLastDay ?? "-"} lastTime=${r.priorNoticeLastTime ?? "-"} tel=${r.phoneNumber ?? "-"}`,
    );
  }

  // ---- 現行シャード契約で表現可能かの判定
  //  build-mizuho-shard.ts は flexTrips.locationGroupIdx に location_group を必須で入れる。
  //  停留所参照のFlex行は、この契約のままでは載せられない。
  const groupRows = flexRowKinds.get("locationGroup") ?? 0;
  const stopRows = flexRowKinds.get("stop") ?? 0;
  const locRows = flexRowKinds.get("location") ?? 0;
  const unresolved = flexRowKinds.get("unresolved") ?? 0;

  if (flexRows.length === 0)
    reasons.push("予約ルール付きのstop_times行が無い（Flexレッグを作れない）");
  if (stopRows > 0)
    reasons.push(`停留所参照のFlex行が${stopRows}件（現行シャードはlocation_group前提）`);
  if (locRows > 0)
    reasons.push(`locations.geojson参照のFlex行が${locRows}件（現行シャード非対応）`);
  if (unresolved > 0) reasons.push(`場所未解決のFlex行が${unresolved}件`);
  if (withWindow === 0 && flexRows.length > 0) reasons.push("時間窓(pickupWindow)が無いFlex行のみ");

  const shardRepresentable = groupRows > 0 && stopRows === 0 && locRows === 0 && unresolved === 0;
  console.log(`  → 現行シャード契約で表現可能: ${shardRepresentable ? "はい" : "いいえ"}`);
  for (const r of reasons) console.log(`     - ${r}`);

  return { agency, shardRepresentable, reasons };
}

function main(): void {
  if (!existsSync(flexRoot)) {
    console.error(
      `入力が無い: ${flexRoot}\n  data/_scripts/ 側でFlexフィードを展開してから実行する`,
    );
    process.exit(1);
  }
  const dirs = readdirSync(flexRoot).filter((d) => statSync(path.join(flexRoot, d)).isDirectory());
  console.log(`検分対象 ${dirs.length} フィード（${flexRoot}）`);

  const verdicts: Verdict[] = [];
  let totalWarnings = 0;
  for (const d of dirs.sort()) {
    const files = loadFeed(path.join(flexRoot, d));
    const feed = parseFlexFeed(files);
    totalWarnings += feed.warnings.length;
    verdicts.push(inspect(d, feed));
  }

  console.log("\n========== まとめ ==========");
  console.log(`パース時の例外: 0件（全${dirs.length}フィードが致命的エラーなく完了）`);
  console.log(`警告合計: ${totalWarnings}件`);
  const ok = verdicts.filter((v) => v.shardRepresentable);
  const ng = verdicts.filter((v) => !v.shardRepresentable);
  console.log(`現行シャード契約で表現可能: ${ok.length}件 ${ok.map((v) => v.agency).join("、")}`);
  console.log(`表現不可（要拡張）: ${ng.length}件`);
  for (const v of ng) console.log(`  ${v.agency}: ${v.reasons.join(" / ")}`);
}

main();
