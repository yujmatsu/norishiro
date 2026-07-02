// S6: 検索履歴一覧（docs/15 3.6節）。②家族の代理検索・①本人の定期的な移動の再検索を助ける。
// 全てlocalStorage内の操作で完結する（サーバー送信なし）。
import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { serviceDateLabel } from "../lib/booking-script.js";
import { formatClock } from "../lib/format.js";
import {
  deleteSearch,
  loadHistory,
  type PlaceSelection,
  type SearchRecord,
} from "../lib/history.js";
import { buildResultSearch } from "../lib/result-query.js";

function placeLabel(p: PlaceSelection): string {
  return p.kind === "stop" ? p.name : p.label;
}

function whenLabel(record: SearchRecord): string {
  if (record.when.type === "datetime") {
    return `${serviceDateLabel(record.when.serviceDate)} ${formatClock(record.when.timeSec)}発`;
  }
  const d = new Date(record.savedAt);
  return `${d.getMonth() + 1}/${d.getDate()} に検索`;
}

export function HistoryPage(): ReactElement {
  const navigate = useNavigate();
  const [records, setRecords] = useState<SearchRecord[]>(() => loadHistory());

  // 出発地・目的地は保持し「いつ」だけ「今すぐ」に更新して結果一覧へ直行（docs/15 3.6節）
  const research = (record: SearchRecord): void => {
    void navigate(`/result${buildResultSearch(record.from, record.to, { type: "now" })}`);
  };

  const remove = (record: SearchRecord): void => {
    deleteSearch(record);
    setRecords(loadHistory()); // その場でリストから除去（再取得はlocalStorage内のみ）
  };

  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={() => void navigate(-1)}>
          ‹ 戻る
        </button>
        <h1 className="heading">検索履歴</h1>
      </header>

      {records.length === 0 ? (
        <>
          <p className="status-text" role="status">
            まだ検索履歴がありません。
          </p>
          <Link to="/search" className="btn btn-primary">
            経路をさがす
          </Link>
        </>
      ) : (
        <ul className="itinerary-list">
          {records.map((record, i) => (
            <li key={i} className="card">
              <p className="history-route">
                {placeLabel(record.from)} → {placeLabel(record.to)}
              </p>
              <p className="history-when">{whenLabel(record)}</p>
              <div className="history-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-inline"
                  onClick={() => research(record)}
                >
                  再検索
                </button>
                <button type="button" className="btn btn-inline" onClick={() => remove(record)}>
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
