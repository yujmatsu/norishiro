// S3: 結果一覧画面（docs/15 3.3節）。経路カードの比較と、Flexレッグの要予約可視化。
// 締切超過時は打ち切り表示＋代替候補の提示（docs/15 4.2節・4.4節、ロジックはlib/search-runner）。
// カードタップ→経路詳細（S4）はPhase Cで接続する。
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { FlexLeg, Itinerary, LocationRef } from "@norishiro/router";
import { ItineraryCard } from "../components/ItineraryCard.js";
import { saveSearch, type PlaceSelection } from "../lib/history.js";
import { formatClock, formatDurationMin } from "../lib/format.js";
import { parseResultQuery, type ResultQuery } from "../lib/result-query.js";
import { runSearch, type SearchOutcome } from "../lib/search-runner.js";
import { currentNow, type SearchNow } from "../lib/time.js";
import { getRouterClient } from "../worker/client.js";

type ResultState =
  | { phase: "loading" }
  | { phase: "invalid" }
  | { phase: "shard-error" }
  | { phase: "search-error"; detail: string }
  | { phase: "done"; outcome: SearchOutcome; serviceDate: number };

type SortBy = "duration" | "transfers";

function toLocationRef(place: PlaceSelection): LocationRef {
  return place.kind === "stop"
    ? { kind: "stopId", stopId: place.stopId }
    : { kind: "coord", lat: place.lat, lon: place.lon };
}

function placeLabel(place: PlaceSelection): string {
  return place.kind === "stop" ? place.name : place.label;
}

/** 代替候補の案内文（docs/15 4.4節のコピー文言に準拠） */
function shiftedIntroText(leg: FlexLeg, now: SearchNow): string {
  const deadline = leg.booking.deadline;
  const departure = `${formatClock(leg.departureTime)}発でしたら、`;
  if (deadline === undefined) {
    return `${departure}ご予約のうえご利用いただけます`;
  }
  const remaining = deadline - now.nowSec;
  const when =
    remaining > 0
      ? `あと${formatDurationMin(Math.floor(remaining / 60) * 60)}（${formatClock(deadline)}まで）`
      : `${formatClock(deadline)}まで`;
  return `${departure}${when}にご予約いただければご利用いただけます`;
}

function useSearchOutcome(query: ResultQuery | null): ResultState {
  const [state, setState] = useState<ResultState>({ phase: "loading" });

  useEffect(() => {
    if (query === null) {
      setState({ phase: "invalid" });
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    void (async () => {
      const client = getRouterClient();
      try {
        await client.ready();
      } catch {
        if (!cancelled) setState({ phase: "shard-error" });
        return;
      }
      const now = currentNow();
      const serviceDate = query.when.type === "now" ? now.serviceDate : query.when.serviceDate;
      const departureTime = query.when.type === "now" ? now.nowSec : query.when.timeSec;
      try {
        const outcome = await runSearch(client, {
          origin: toLocationRef(query.from),
          destination: toLocationRef(query.to),
          serviceDate,
          departureTime,
          now,
        });
        // 検索が実行できた条件のみ履歴に残す（docs/15 3.6節の再検索の起点になる）
        saveSearch({ from: query.from, to: query.to, when: query.when, savedAt: Date.now() });
        if (!cancelled) setState({ phase: "done", outcome, serviceDate });
      } catch (e) {
        if (!cancelled) {
          setState({ phase: "search-error", detail: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return state;
}

export function ResultsPage(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = useMemo(() => parseResultQuery(searchParams), [searchParams]);
  const state = useSearchOutcome(query);
  const [sortBy, setSortBy] = useState<SortBy>("duration");

  // 締切カウントダウンの周期更新（docs/15 4.2節。15秒ごとに再計算）
  const [nowTick, setNowTick] = useState<SearchNow>(() => currentNow());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(currentNow()), 15000);
    return () => clearInterval(timer);
  }, []);

  const sorted = useMemo((): Itinerary[] => {
    if (state.phase !== "done") return [];
    const list = [...state.outcome.itineraries];
    if (sortBy === "transfers") {
      list.sort(
        (a, b) =>
          a.summary.transferCount - b.summary.transferCount ||
          a.summary.durationSec - b.summary.durationSec,
      );
    }
    return list; // 既定はrunSearchが返す所要時間昇順（docs/15 3.3節）
  }, [state, sortBy]);

  if (query === null) {
    return (
      <main className="app-main">
        <p className="status-text" role="alert">
          検索条件が正しくありません。もう一度検索してください。
        </p>
        <Link to="/search" className="btn btn-primary">
          経路をさがす
        </Link>
      </main>
    );
  }

  const shiftedLeg =
    state.phase === "done"
      ? state.outcome.shiftedFlex?.itinerary.legs.find((leg): leg is FlexLeg => leg.kind === "flex")
      : undefined;

  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={() => void navigate(-1)}>
          ‹ 戻る
        </button>
        {/* 検索条件の要約は常に表示して見失わせない（docs/15 3.3節） */}
        <h1 className="heading">
          {placeLabel(query.from)} → {placeLabel(query.to)}
        </h1>
      </header>

      {state.phase === "loading" && (
        <p className="status-text" role="status">
          経路をさがしています…
        </p>
      )}

      {state.phase === "shard-error" && (
        <>
          <p className="status-text" role="alert">
            この地域のデータをまだ取得できていません。電波の良い場所で再度お試しください。
          </p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            再試行
          </button>
        </>
      )}

      {state.phase === "search-error" && (
        <>
          <p className="status-text" role="alert">
            検索中に問題が発生しました。条件を変えてもう一度お試しください。
          </p>
          <p className="status-text">（詳細: {state.detail}）</p>
          <Link to="/search" className="btn">
            検索条件を変える
          </Link>
        </>
      )}

      {state.phase === "done" && (
        <>
          {state.outcome.missedFlex !== undefined && (
            <div className="notice-passed" role="status">
              <p>
                🚐 この便は予約締切を過ぎています（締切{" "}
                {formatClock(state.outcome.missedFlex.deadlineSec)}）。次の候補をご案内します。
              </p>
            </div>
          )}

          {state.outcome.shiftedFlex !== undefined && shiftedLeg !== undefined && (
            <section aria-label="時間をずらした候補">
              <p className="status-text">🚐 {shiftedIntroText(shiftedLeg, nowTick)}</p>
              <ul className="itinerary-list">
                <ItineraryCard
                  itinerary={state.outcome.shiftedFlex.itinerary}
                  serviceDate={state.serviceDate}
                  now={nowTick}
                  suggested
                />
              </ul>
            </section>
          )}

          {sorted.length > 1 && (
            <div className="sort-control">
              <label htmlFor="sort-select">並び替え</label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value === "transfers" ? "transfers" : "duration")
                }
              >
                <option value="duration">所要時間が短い順</option>
                <option value="transfers">乗換が少ない順</option>
              </select>
            </div>
          )}

          {sorted.length > 0 && (
            <ul className="itinerary-list">
              {sorted.map((itinerary, i) => (
                <ItineraryCard
                  key={i}
                  itinerary={itinerary}
                  serviceDate={state.serviceDate}
                  now={nowTick}
                />
              ))}
            </ul>
          )}

          {sorted.length === 0 && state.outcome.shiftedFlex === undefined && (
            <>
              {/* 空状態の誠実な説明（docs/15 3.3節、docs/06「データが無い地域は無いなりに表示」） */}
              <p className="status-text" role="status">
                この条件では経路が見つかりませんでした。時間帯や出発地点を変えてお試しください。
              </p>
              <p className="status-text">
                この地域は現在データが提供されていない、または本当に交通手段が乏しい可能性があります。
              </p>
              <Link to="/search" className="btn">
                検索条件を変える
              </Link>
            </>
          )}
        </>
      )}
    </main>
  );
}
