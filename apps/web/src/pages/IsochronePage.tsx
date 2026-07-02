// S7: 到達圏モード（docs/15 3.7節・9章、審査デモの山場）。
// 地点＋時間スライダーで到達圏を表示し、「デマンド交通あり/なし」トグルで交通空白のBefore/Afterを見せる。
// 全cutoff（5〜60分）を1回のisochrone呼び出しで取得し、スライダーは表示切替のみ（再計算しない）。
import { lazy, Suspense, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import type { IsochroneResult } from "@norishiro/router";
import { serviceDateLabel } from "../lib/booking-script.js";
import {
  ISOCHRONE_CUTOFFS,
  pickCutoffFeature,
  type IsochroneFeature,
} from "../lib/isochrone-view.js";
import type { StopCandidate } from "../lib/stop-search.js";
import { currentNow, parseDateInput, toDateInputValue } from "../lib/time.js";
import { getRouterClient } from "../worker/client.js";

const IsochroneMap = lazy(() =>
  import("../components/IsochroneMap.js").then((m) => ({ default: m.IsochroneMap })),
);

/** 到達圏の計算基準出発時刻（10:00固定。瑞穂町Flexの時間窓9:00-17:00内の代表値） */
const DEMO_DEPARTURE_SEC = 36000;

interface IsochroneData {
  on: IsochroneResult;
  off: IsochroneResult;
}

export function IsochronePage(): ReactElement {
  const navigate = useNavigate();

  // 基準地点の選択
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<StopCandidate[]>([]);
  const [point, setPoint] = useState<StopCandidate | null>(null);

  // 表示条件
  const [minutes, setMinutes] = useState(30);
  const [flexOn, setFlexOn] = useState(true);
  const [dateValue, setDateValue] = useState(() => toDateInputValue(currentNow().serviceDate));

  const [data, setData] = useState<IsochroneData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  // 地点のインクリメンタル検索（S2と同じパターン）
  useEffect(() => {
    const q = query.trim();
    if (q === "" || point !== null) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(() => {
      getRouterClient()
        .searchStops(q)
        .then(setCandidates)
        .catch(() => setCandidates([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [query, point]);

  // 地点・日付が決まったら「あり/なし」両方の到達圏を一括計算
  useEffect(() => {
    if (point === null) return;
    const serviceDate = parseDateInput(dateValue);
    if (serviceDate === null) return;
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const client = getRouterClient();
        await client.ready();
        const origin = { kind: "stopId", stopId: point.stopId } as const;
        const [on, off] = await Promise.all([
          client.isochrone(origin, DEMO_DEPARTURE_SEC, ISOCHRONE_CUTOFFS, { serviceDate }),
          client.isochrone(origin, DEMO_DEPARTURE_SEC, ISOCHRONE_CUTOFFS, {
            serviceDate,
            includeFlex: false,
          }),
        ]);
        if (!cancelled) {
          setData({ on, off });
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [point, dateValue]);

  const cutoffSec = minutes * 60;
  const onFeature = data === null ? null : pickCutoffFeature(data.on, cutoffSec);
  const offFeature = data === null ? null : pickCutoffFeature(data.off, cutoffSec);
  // 視野合わせは最大60分の「あり」到達圏（データ読込時のみ変化）
  const boundsFeature = useMemo((): IsochroneFeature | null => {
    if (data === null) return null;
    return pickCutoffFeature(data.on, 3600) ?? pickCutoffFeature(data.off, 3600);
  }, [data]);

  const serviceDate = parseDateInput(dateValue);

  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={() => void navigate(-1)}>
          ‹ 戻る
        </button>
        <h1 className="heading">到達圏マップ</h1>
      </header>

      {point === null ? (
        <>
          <p className="status-text">
            地点を選ぶと、そこから公共交通で行ける範囲を地図に表示します。
          </p>
          <label className="field-label" htmlFor="iso-point">
            🔍 基準地点をさがす
          </label>
          <input
            id="iso-point"
            type="text"
            className="text-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例: 瑞穂町役場"
            autoComplete="off"
          />
          {candidates.length > 0 && (
            <ul className="itinerary-list" aria-label="地点の候補">
              {candidates.map((c) => (
                <li key={c.stopId}>
                  <button
                    type="button"
                    className="btn btn-candidate"
                    onClick={() => {
                      setPoint(c);
                      setCandidates([]);
                    }}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="iso-point-row">
            <p className="iso-point-name">地点: {point.name}</p>
            <button
              type="button"
              className="btn btn-inline"
              onClick={() => {
                setPoint(null);
                setQuery("");
                setData(null);
              }}
            >
              変更
            </button>
          </div>

          <label className="field-label" htmlFor="iso-date">
            日付（曜日によって運行が変わります）
          </label>
          <input
            id="iso-date"
            type="date"
            className="text-input"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
          />

          {status === "loading" && (
            <p className="status-text" role="status">
              到達圏を計算しています…
            </p>
          )}
          {status === "error" && (
            <p className="status-text" role="alert">
              到達圏を計算できませんでした。地点や日付を変えてお試しください。
            </p>
          )}

          {data !== null && (
            <>
              <Suspense fallback={<div className="route-map map-fallback">地図を読み込み中…</div>}>
                <IsochroneMap
                  center={{ lat: point.lat, lon: point.lon }}
                  onFeature={flexOn ? onFeature : null}
                  offFeature={offFeature}
                  boundsFeature={boundsFeature}
                />
              </Suspense>

              <label className="field-label" htmlFor="iso-minutes">
                時間: {minutes}分（10:00出発として計算）
              </label>
              <input
                id="iso-minutes"
                type="range"
                className="iso-slider"
                min={5}
                max={60}
                step={5}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />

              <div className="toggle-group" role="group" aria-label="デマンド交通の有無">
                <span>デマンド交通:</span>
                <button
                  type="button"
                  className="btn btn-inline"
                  aria-pressed={flexOn}
                  onClick={() => setFlexOn(true)}
                >
                  あり
                </button>
                <button
                  type="button"
                  className="btn btn-inline"
                  aria-pressed={!flexOn}
                  onClick={() => setFlexOn(false)}
                >
                  なし
                </button>
              </div>

              <p className="status-text">
                灰色（点線の枠）: 固定路線・徒歩のみで行ける範囲
                {flexOn && " ／ オレンジ（実線の枠）: デマンド交通を使うと広がる範囲"}
              </p>

              {offFeature === null && (
                <p className="status-text" role="status">
                  固定路線・徒歩のみでは、{minutes}
                  分以内に行ける範囲はごくわずかです（地図に描ける広がりがありません）。
                </p>
              )}
              {flexOn && onFeature === null && serviceDate !== null && (
                <p className="status-text" role="status">
                  {serviceDateLabel(serviceDate)}
                  は、この地点から{minutes}
                  分以内に利用できるデマンド交通の運行が見つかりません。日付（曜日）を変えてお試しください。
                </p>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
