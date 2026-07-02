// S2: 検索ステップ1〜3（docs/15 3.2節）。「どこから」「どこへ」「いつ」を1画面1問で聞く
// ガイド型フォーム（確定判断2）。ボタンタップで即時に次ステップへ進む（1操作1遷移）。
// 音声入力（docs/15 6章）はI-8フェーズで追加する。
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { recentStopPlaces, type PlaceSelection, type WhenSelection } from "../lib/history.js";
import { buildResultSearch } from "../lib/result-query.js";
import type { StopCandidate } from "../lib/stop-search.js";
import {
  currentNow,
  parseDateInput,
  parseTimeInput,
  toDateInputValue,
  toTimeInputValue,
} from "../lib/time.js";
import { getRouterClient } from "../worker/client.js";

interface PlaceStepProps {
  stepNo: 1 | 2;
  question: string;
  /** 「現在地を使う」ボタンを出すか（ステップ1のみ、docs/15 3.2節ワイヤーフレーム） */
  allowCurrentLocation: boolean;
  /** 出発地と同一のstopを選ばせない（ステップ2で使用） */
  excludeStopId?: string;
  onSelect: (place: PlaceSelection) => void;
}

function PlaceStep({
  stepNo,
  question,
  allowCurrentLocation,
  excludeStopId,
  onSelect,
}: PlaceStepProps): ReactElement {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<StopCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = useMemo(
    () => recentStopPlaces().filter((p) => p.stopId !== excludeStopId),
    [excludeStopId],
  );

  // インクリメンタル検索（docs/15 3.2節「地点入力中は候補をインクリメンタルに表示」）
  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setCandidates([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      getRouterClient()
        .searchStops(q)
        .then((result) => {
          setCandidates(result);
          setSearched(true);
        })
        .catch(() => {
          setCandidates([]);
          setSearched(true);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const chooseStop = (stop: { stopId: string; name: string }): void => {
    if (stop.stopId === excludeStopId) {
      setMessage("出発地と同じ地点です。別の地点を選んでください");
      return;
    }
    onSelect({ kind: "stop", stopId: stop.stopId, name: stop.name });
  };

  const useCurrentLocation = (): void => {
    setMessage(null);
    if (!("geolocation" in navigator)) {
      setMessage("現在地を取得できませんでした。地点を入力してください");
      inputRef.current?.focus();
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onSelect({
          kind: "coord",
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "現在地",
        });
      },
      () => {
        // 許可拒否・タイムアウト共通。ブロッキングなアラートにせずその場に留まる（docs/15 3.2節）
        setLocating(false);
        setMessage("現在地を取得できませんでした。地点を入力してください");
        inputRef.current?.focus();
      },
      { timeout: 10000 },
    );
  };

  const inputId = `place-input-${stepNo}`;
  return (
    <>
      <h1 className="wizard-question">{question}</h1>

      {allowCurrentLocation && (
        <button type="button" className="btn btn-primary" onClick={useCurrentLocation}>
          📍 {locating ? "取得中…" : "現在地を使う"}
        </button>
      )}

      <label className="field-label" htmlFor={inputId}>
        🔍 地点を入力
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        className="text-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="例: みずほ病院"
        autoComplete="off"
      />

      {message !== null && (
        <p className="inline-error" role="alert">
          {message}
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="itinerary-list" aria-label="地点の候補">
          {candidates.map((c) => (
            <li key={c.stopId}>
              <button type="button" className="btn btn-candidate" onClick={() => chooseStop(c)}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && candidates.length === 0 && query.trim() !== "" && (
        <p className="status-text" role="status">
          一致する地点が見つかりません。別のキーワードでお試しください
        </p>
      )}

      {recent.length > 0 && (
        <>
          <h2 className="section-title">最近の検索地点</h2>
          <ul className="itinerary-list" aria-label="最近の検索地点">
            {recent.map((p) => (
              <li key={p.stopId}>
                <button type="button" className="btn btn-candidate" onClick={() => chooseStop(p)}>
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function WhenStep({ onSelect }: { onSelect: (when: WhenSelection) => void }): ReactElement {
  const initial = useMemo(() => currentNow(), []);
  const [showDateTime, setShowDateTime] = useState(false);
  const [dateValue, setDateValue] = useState(toDateInputValue(initial.serviceDate));
  const [timeValue, setTimeValue] = useState(toTimeInputValue(initial.nowSec));
  const parsedDate = parseDateInput(dateValue);
  const parsedTime = parseTimeInput(timeValue);

  return (
    <>
      <h1 className="wizard-question">いつ出発しますか？</h1>

      {/* 既定値で1タップ完了を優先（docs/15 3.2節: 「今すぐ」を最上位候補に） */}
      <button type="button" className="btn btn-primary" onClick={() => onSelect({ type: "now" })}>
        今すぐ
      </button>

      {!showDateTime && (
        <button type="button" className="btn" onClick={() => setShowDateTime(true)}>
          日時を指定する
        </button>
      )}

      {showDateTime && (
        <section aria-label="日時の指定">
          <label className="field-label" htmlFor="when-date">
            日付
          </label>
          <input
            id="when-date"
            type="date"
            className="text-input"
            value={dateValue}
            min={toDateInputValue(initial.serviceDate)}
            onChange={(e) => setDateValue(e.target.value)}
          />
          <label className="field-label" htmlFor="when-time">
            出発時刻
          </label>
          <input
            id="when-time"
            type="time"
            className="text-input"
            value={timeValue}
            onChange={(e) => setTimeValue(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={parsedDate === null || parsedTime === null}
            onClick={() => {
              if (parsedDate !== null && parsedTime !== null) {
                onSelect({ type: "datetime", serviceDate: parsedDate, timeSec: parsedTime });
              }
            }}
          >
            この日時で検索
          </button>
        </section>
      )}
    </>
  );
}

export function SearchWizardPage(): ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [from, setFrom] = useState<PlaceSelection | null>(null);
  const [to, setTo] = useState<PlaceSelection | null>(null);

  const finish = (when: WhenSelection): void => {
    if (from === null || to === null) return;
    navigate(`/result${buildResultSearch(from, to, when)}`);
  };

  const goBack = (): void => {
    if (step === 1) {
      void navigate("/");
    } else {
      setStep(step === 3 ? 2 : 1);
    }
  };

  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={goBack}>
          ‹ 戻る
        </button>
        {/* 進捗表示（docs/15 3.2節・5.2節: 進捗と質問文を読み上げ順に伝える） */}
        <p className="wizard-progress heading" aria-live="polite">
          {step}/3
        </p>
      </header>

      {step === 1 && (
        <PlaceStep
          stepNo={1}
          question="どこから出発しますか？"
          allowCurrentLocation
          onSelect={(place) => {
            setFrom(place);
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <PlaceStep
          stepNo={2}
          question="どこへ行きますか？"
          allowCurrentLocation={false}
          excludeStopId={from?.kind === "stop" ? from.stopId : undefined}
          onSelect={(place) => {
            setTo(place);
            setStep(3);
          }}
        />
      )}
      {step === 3 && <WhenStep onSelect={finish} />}
    </main>
  );
}
