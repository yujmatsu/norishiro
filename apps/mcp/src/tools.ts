// MCPツール定義（docs/14 3章）。入出力スキーマはpackages/routerの型（docs/13 8章）への
// 薄いラッパーであり、探索ロジックを二重実装しない（docs/14 1.2節「router再利用」原則）。
// 各descriptionはLLMがツールを選択する際の契約文書であり、docs/14 3章の文面を正とする。

import {
  isochrone,
  plan,
  RouterInputError,
  type Itinerary,
  type LocationRef as RouterLocationRef,
} from "@norishiro/router";
import { z } from "zod";
import { ToolError } from "./errors.js";
import { getBookingRules, listFlexServices, type FlexServiceSummary } from "./flex-info.js";
import { capIsochroneSize } from "./isochrone-limit.js";
import { SHARD_REGISTRY, shardsByArea, shardsByCoord } from "./registry.js";
import type { LoadedShard, ShardCache } from "./shard-cache.js";
import type { ShardSource } from "./shard-source.js";
import { resolveStopName, searchByName, searchByRadius, type StopRecord } from "./stop-index.js";
import { parseDepartureTime } from "./time.js";

export interface ToolContext {
  cache: ShardCache;
  source: ShardSource;
}

// ---- 共通スキーマ ----

const CoordRefSchema = z.object({
  kind: z.literal("coord"),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
const StopIdRefSchema = z.object({ kind: z.literal("stopId"), stopId: z.string().min(1) });
const StopNameRefSchema = z.object({
  kind: z.literal("stopName"),
  stopName: z.string().min(1).max(100),
});
const LocationRefSchema = z.discriminatedUnion("kind", [
  CoordRefSchema,
  StopIdRefSchema,
  StopNameRefSchema,
]);
type LocationRefInput = z.infer<typeof LocationRefSchema>;

const DepartureTimeSchema = z
  .string()
  .describe(
    "出発日時。ISO 8601形式（例: 2026-07-07T09:00:00+09:00）。タイムゾーンオフセットを含めること。",
  );

const NO_COVERAGE_MESSAGE =
  "この地域のデータは現在整備されていません。対応地域は現時点で東京都瑞穂町周辺に限定されています。";

// ---- 地点→シャード解決 ----

function refLabel(ref: LocationRefInput): string {
  if (ref.kind === "coord") return `座標(${String(ref.lat)}, ${String(ref.lon)})`;
  if (ref.kind === "stopId") return `stopId「${ref.stopId}」`;
  return `停留所名「${ref.stopName}」`;
}

/** 地点参照が属するシャードを解決してロードする（docs/14 4.5節のシャード解決フロー） */
async function resolveShardForRef(ctx: ToolContext, ref: LocationRefInput): Promise<LoadedShard> {
  if (ref.kind === "coord") {
    const entries = shardsByCoord(ref.lat, ref.lon);
    const entry = entries[0];
    if (entry === undefined) {
      throw new ToolError("DATA_NOT_AVAILABLE", `${refLabel(ref)}: ${NO_COVERAGE_MESSAGE}`);
    }
    return ctx.cache.get(entry);
  }
  let lastAmbiguity: ToolError | undefined;
  for (const entry of SHARD_REGISTRY) {
    const loaded = await ctx.cache.get(entry);
    if (ref.kind === "stopId") {
      if (loaded.index.byStopId.has(ref.stopId)) return loaded;
    } else {
      try {
        resolveStopName(loaded.index, ref.stopName);
        return loaded;
      } catch (e) {
        // 「複数該当」の曖昧性エラーは他シャードに該当が無ければそのまま返す
        if (e instanceof ToolError && e.message.includes("一意に決まりません")) lastAmbiguity = e;
      }
    }
  }
  if (lastAmbiguity !== undefined) throw lastAmbiguity;
  throw new ToolError(
    "INVALID_INPUT",
    `${refLabel(ref)}が解決できません。search_stopsで停留所を検索し、stopIdで指定してください。`,
  );
}

/** MCP入力のLocationRefをrouterのLocationRef（coord/stopIdのみ）へ変換する */
function toRouterRef(loaded: LoadedShard, ref: LocationRefInput): RouterLocationRef {
  if (ref.kind === "coord") return { kind: "coord", lat: ref.lat, lon: ref.lon };
  if (ref.kind === "stopId") return { kind: "stopId", stopId: ref.stopId };
  return { kind: "stopId", stopId: resolveStopName(loaded.index, ref.stopName).stopId };
}

function rethrowRouterError(e: unknown): never {
  if (e instanceof RouterInputError) {
    throw new ToolError("INVALID_INPUT", `入力を処理できません: ${e.message}`);
  }
  throw e;
}

// ---- plan_journey（docs/14 3.1節） ----

const PlanJourneyInputSchema = z.object({
  origin: LocationRefSchema.describe(
    "出発地。座標(kind:coord)、停留所ID(kind:stopId)、停留所名の部分一致(kind:stopName)のいずれかで指定する。",
  ),
  destination: LocationRefSchema.describe("目的地。originと同じ形式で指定する。"),
  departureTime: DepartureTimeSchema,
  options: z
    .object({
      maxTransfers: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe("最大乗換回数。省略時はサーバー既定値（6）。"),
      walkLimitMeters: z
        .number()
        .int()
        .min(50)
        .max(2000)
        .optional()
        .describe("徒歩移動の距離上限（メートル）。省略時はサーバー既定値（800m）。"),
    })
    .optional()
    .describe("検索オプション。省略時は全て既定値を使う。"),
});

async function handlePlanJourney(
  ctx: ToolContext,
  input: z.infer<typeof PlanJourneyInputSchema>,
): Promise<{ itineraries: Itinerary[] }> {
  const { serviceDate, secOfDay } = parseDepartureTime(input.departureTime);
  const originShard = await resolveShardForRef(ctx, input.origin);
  const destShard = await resolveShardForRef(ctx, input.destination);
  if (originShard.entry.shardId !== destShard.entry.shardId) {
    throw new ToolError(
      "DATA_NOT_AVAILABLE",
      "出発地と目的地が異なる地域データに属しています。現バージョンでは単一地域内の経路検索のみ対応しています。",
    );
  }
  const itineraries = ctx.cache.runWithActive(originShard, () => {
    try {
      const req: Parameters<typeof plan>[0] = {
        origin: toRouterRef(originShard, input.origin),
        destination: toRouterRef(originShard, input.destination),
        departureTime: secOfDay,
        serviceDate,
      };
      if (input.options?.maxTransfers !== undefined) req.maxTransfers = input.options.maxTransfers;
      if (input.options?.walkLimitMeters !== undefined)
        req.walkLimit = input.options.walkLimitMeters;
      return plan(req);
    } catch (e) {
      rethrowRouterError(e);
    }
  });
  return { itineraries };
}

// ---- search_stops（docs/14 3.2節） ----

const SearchStopsInputSchema = z.object({
  query: z
    .discriminatedUnion("mode", [
      z.object({
        mode: z.literal("name"),
        text: z
          .string()
          .min(1)
          .max(100)
          .describe("停留所名・location_group名の検索文字列（部分一致）。"),
      }),
      z.object({
        mode: z.literal("radius"),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusMeters: z
          .number()
          .positive()
          .describe("検索半径（メートル）。上限5000m（超過時は5000mに切り詰める）。"),
      }),
    ])
    .describe("検索条件。名称検索(mode:name)または座標+半径検索(mode:radius)のいずれか一方。"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("最大返却件数。省略時は50。上限100。"),
});

interface StopSearchResult {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  kind: "fixed" | "flex_member";
  flexGroupIds?: string[];
  distanceMeters?: number;
}

function toSearchResult(rec: StopRecord & { distanceMeters?: number }): StopSearchResult {
  const result: StopSearchResult = {
    stopId: rec.stopId,
    stopName: rec.stopName,
    lat: rec.lat,
    lon: rec.lon,
    kind: rec.flexGroupIds !== undefined ? "flex_member" : "fixed",
  };
  if (rec.flexGroupIds !== undefined) result.flexGroupIds = rec.flexGroupIds;
  if (rec.distanceMeters !== undefined) result.distanceMeters = rec.distanceMeters;
  return result;
}

const RADIUS_CAP_METERS = 5000;

async function handleSearchStops(
  ctx: ToolContext,
  input: z.infer<typeof SearchStopsInputSchema>,
): Promise<{ stops: StopSearchResult[] }> {
  const limit = input.limit ?? 50;
  if (input.query.mode === "name") {
    const stops: StopSearchResult[] = [];
    for (const entry of SHARD_REGISTRY) {
      const loaded = await ctx.cache.get(entry);
      stops.push(...searchByName(loaded.index, input.query.text, limit).map(toSearchResult));
    }
    return { stops: stops.slice(0, limit) };
  }
  const { lat, lon } = input.query;
  const radius = Math.min(input.query.radiusMeters, RADIUS_CAP_METERS); // 拒否ではなく切り詰め（6.1節S-2）
  const entries = shardsByCoord(lat, lon);
  if (entries.length === 0) {
    throw new ToolError(
      "DATA_NOT_AVAILABLE",
      `座標(${String(lat)}, ${String(lon)}): ${NO_COVERAGE_MESSAGE}`,
    );
  }
  const stops: StopSearchResult[] = [];
  for (const entry of entries) {
    const loaded = await ctx.cache.get(entry);
    stops.push(...searchByRadius(loaded.index, lat, lon, radius, limit).map(toSearchResult));
  }
  stops.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  return { stops: stops.slice(0, limit) };
}

// ---- list_flex_services（docs/14 3.3節） ----

const ListFlexServicesInputSchema = z.object({
  area: z
    .object({
      prefecture: z.string().min(1).describe("都道府県名（例: 東京都）。"),
      municipality: z
        .string()
        .optional()
        .describe("市区町村名（例: 瑞穂町）。省略時は都道府県全域が対象。"),
    })
    .describe("検索対象エリア。"),
});

async function handleListFlexServices(
  ctx: ToolContext,
  input: z.infer<typeof ListFlexServicesInputSchema>,
): Promise<{ services: FlexServiceSummary[] }> {
  const prefEntries = shardsByArea(input.area.prefecture);
  if (prefEntries.length === 0) {
    // シャード自体が存在しない都道府県はDATA_NOT_AVAILABLE（docs/14 3.3節・9.2節U-6）
    throw new ToolError(
      "DATA_NOT_AVAILABLE",
      `指定された地域（${input.area.prefecture}）のデータは現在整備されていません。対応地域は現時点で東京都瑞穂町周辺に限定されています。`,
    );
  }
  // 市区町村名の不一致は「0件の正常応答」（表記揺れ耐性は限定的、docs/14 3.3節）
  const entries =
    input.area.municipality === undefined
      ? prefEntries
      : shardsByArea(input.area.prefecture, input.area.municipality);
  const services: FlexServiceSummary[] = [];
  for (const entry of entries) {
    const loaded = await ctx.cache.get(entry);
    services.push(...listFlexServices(loaded.raw, entry));
  }
  return { services };
}

// ---- get_booking_rules（docs/14 3.4節） ----

const GetBookingRulesInputSchema = z.object({
  serviceId: z
    .string()
    .min(1)
    .describe("list_flex_servicesが返すサービス識別子（例: mizuhomachi_group:east_trip）。"),
});

async function handleGetBookingRules(
  ctx: ToolContext,
  input: z.infer<typeof GetBookingRulesInputSchema>,
): Promise<object> {
  let lastError: ToolError | undefined;
  for (const entry of SHARD_REGISTRY) {
    const loaded = await ctx.cache.get(entry);
    try {
      return getBookingRules(loaded.raw, input.serviceId);
    } catch (e) {
      if (e instanceof ToolError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw (
    lastError ??
    new ToolError(
      "INVALID_INPUT",
      `serviceId「${input.serviceId}」に該当するサービスが見つかりません。list_flex_servicesで一覧を確認してください。`,
    )
  );
}

// ---- get_isochrone（docs/14 3.5節） ----

const GetIsochroneInputSchema = z.object({
  origin: LocationRefSchema.describe(
    "出発地。座標(kind:coord)、停留所ID(kind:stopId)、停留所名(kind:stopName)のいずれか。",
  ),
  departureTime: DepartureTimeSchema,
  cutoffsMinutes: z
    .array(z.number().positive().max(180))
    .min(1)
    .max(5)
    .describe(
      "到達圏を計算するカットオフ分数の配列。最大5要素、各値は最大180分。例: [15, 30, 60]。",
    ),
});

async function handleGetIsochrone(
  ctx: ToolContext,
  input: z.infer<typeof GetIsochroneInputSchema>,
): Promise<object> {
  const { serviceDate, secOfDay } = parseDepartureTime(input.departureTime);
  const loaded = await resolveShardForRef(ctx, input.origin);
  const result = ctx.cache.runWithActive(loaded, () => {
    try {
      return isochrone(
        toRouterRef(loaded, input.origin),
        secOfDay,
        input.cutoffsMinutes.map((m) => m * 60),
        { serviceDate },
      );
    } catch (e) {
      rethrowRouterError(e);
    }
  });
  return capIsochroneSize(result);
}

// ---- list_data_sources（docs/14 3.6節） ----

const ListDataSourcesInputSchema = z.object({}).describe("引数なし。");

async function handleListDataSources(ctx: ToolContext): Promise<object> {
  return ctx.source.fetchCredits();
}

// ---- ツール定義表 ----

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (ctx: ToolContext, input: unknown) => Promise<object>;
}

function withValidation<S extends z.ZodType>(
  schema: S,
  handler: (ctx: ToolContext, input: z.infer<S>) => Promise<object>,
): (ctx: ToolContext, input: unknown) => Promise<object> {
  return async (ctx, input) => {
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) {
      // zodの英語メッセージをそのまま利用者に見せず、日本語要約＋detailに分離する（docs/14 5.4節）
      const detail = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join(" / ");
      throw new ToolError(
        "INVALID_INPUT",
        "入力の形式が正しくありません。各パラメータの形式・値域を確認して再試行してください。",
        detail,
      );
    }
    return handler(ctx, parsed.data as z.infer<S>);
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "plan_journey",
    description: `出発地から目的地までの経路を検索する。日本の鉄道・バスに加え、デマンド交通（GTFS-Flex、
事前予約制の乗合バス等）を統合して検索する。

【重要な制約】
- 出発時刻の指定のみに対応する。到着時刻を指定した逆算検索は非対応（未来のバージョンで対応予定）。
- 単一のサービス日内の検索のみ対応する。深夜0時をまたぐ移動で日付が変わる場合、翌日分は別の
  検索として扱われることがある。
- 経路にデマンド交通（Flexレッグ）が含まれる場合、summary.requiresBooking が true になる。
  この場合、該当レッグの booking フィールド（電話番号・予約締切・案内文）を利用者にそのまま
  伝えること。予約締切を過ぎている経路は結果に含まれない（実行不可能な経路は返さない）。
- データが整備されていない地域（GTFSフィードが未取得の市町村等）を指定した場合、
  isError: true の応答が返る。全国のすべての地域を保証するものではない。
- 座標は日本国内を想定する。国外の座標を指定した場合の動作は保証されない。`,
    inputSchema: PlanJourneyInputSchema,
    handler: withValidation(PlanJourneyInputSchema, handlePlanJourney),
  },
  {
    name: "search_stops",
    description: `停留所（駅・バス停等）またはデマンド交通のサービスエリア（location_group）を検索する。
名称の部分一致検索、または座標＋半径検索のいずれかを指定する（両方同時の指定は不可）。

【重要な制約】
- 半径検索の半径は上限5000m（5km）。これを超える半径を指定した場合はサーバー側で
  5000mに切り詰められる（拒否ではなく上限適用）。
- 名称検索は前方一致・部分一致を行うが、読み仮名・旧称・通称には対応しない場合がある。
- 該当0件は正常な結果（isError: falseで空配列を返す）であり、エラーではない。
- 大量の結果が見込まれる緩い検索条件（例: 1文字だけの名称検索）は結果件数を100件に
  制限する場合がある。`,
    inputSchema: SearchStopsInputSchema,
    handler: withValidation(SearchStopsInputSchema, handleSearchStops),
  },
  {
    name: "list_flex_services",
    description: `指定した都道府県・市区町村でデマンド交通（事前予約制の乗合バス、GTFS-Flex）が
利用可能かどうか、利用可能な場合はサービス概要（運行曜日・時間窓・予約方法の概要）を
一覧で返す。

【重要な制約】
- エリア名は都道府県名または市区町村名の文字列一致で解釈する。表記揺れ（「瑞穂町」
  「瑞穂」等）への耐性は限定的であり、該当なしの場合は0件の配列を返す（エラーにしない）。
- このツールは概要一覧のみを返す。予約方法の詳細（そのまま利用者に案内できる文面）が
  必要な場合は get_booking_rules をサービスID指定で呼び出すこと。
- 全国のすべての市区町村を保証するものではない。データパイプラインが取り込んでいない
  自治体は0件になる（データ未整備であり、サービスが存在しないことの証明ではない）。`,
    inputSchema: ListFlexServicesInputSchema,
    handler: withValidation(ListFlexServicesInputSchema, handleListFlexServices),
  },
  {
    name: "get_booking_rules",
    description: `デマンド交通サービスの予約方法の詳細を取得する。list_flex_services で得た serviceId を
指定する。応答に含まれる spokenGuidance フィールドは、利用者にそのまま読み上げる・
表示することを想定した完成済みの案内文である。要約・言い換えを加えず、そのまま伝えること
を推奨する。

【重要な制約】
- serviceId が不明な場合、まず list_flex_services でサービス一覧を取得すること。
- 締切時刻は「何時何分までに予約すればよいか」という一般的なルールの説明であり、
  特定の乗車時刻に対する具体的な締切計算（例: 本日9時発なら8時30分までに予約）が
  必要な場合は plan_journey の結果に含まれる booking.deadline を使うこと。
  get_booking_rules 単体では「今日の何便に対する締切か」という文脈は解決できない。`,
    inputSchema: GetBookingRulesInputSchema,
    handler: withValidation(GetBookingRulesInputSchema, handleGetBookingRules),
  },
  {
    name: "get_isochrone",
    description: `指定した出発地・出発時刻から、複数の時間（分）以内に到達可能な範囲をGeoJSONの
ポリゴンとして返す。「30分以内に行ける場所はどこか」という問いに答える。

【重要な制約】
- cutoffs（カットオフ分数の配列）は最大5要素まで、各値は最大180分までに制限される。
  これを超える指定は入力不正エラーになる。
- 応答サイズには上限がある。到達範囲が広域になる場合、サーバー側でポリゴンを簡略化した
  上で返す（見た目の詳細さより応答成立を優先する）。簡略化が行われた場合、応答に
  simplified: true が付与される。
- ポリゴンは凸包（ConvexHull）による近似であり、実際の到達圏より広めに出ることがある
  （道路がない領域も到達圏に含まれる場合がある）。正確な道路網ベースの到達圏ではなく、
  概観把握用の近似図として扱うこと。`,
    inputSchema: GetIsochroneInputSchema,
    handler: withValidation(GetIsochroneInputSchema, handleGetIsochrone),
  },
  {
    name: "list_data_sources",
    description: `このサービスが使用しているデータの出典・ライセンス・クレジット表記の一覧を取得する。
引数は不要。データの二次利用条件を利用者に説明する必要がある場合や、「このデータは
どこから来ているのか」という質問に答える場合に使うこと。`,
    inputSchema: ListDataSourcesInputSchema,
    handler: withValidation(ListDataSourcesInputSchema, handleListDataSources),
  },
];
