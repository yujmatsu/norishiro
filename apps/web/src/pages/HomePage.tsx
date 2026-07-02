// S1: ホーム画面（docs/15 3.1節）。迷わず「経路をさがす」に入れることが目的。
// 履歴ボタンは履歴0件なら非表示（空状態）。フッター3リンクは常時表示。
// 文字サイズ切替・高コントラストはPhase E（アクセシビリティ仕上げ）で追加する。
import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { loadHistory } from "../lib/history.js";

const ONBOARDING_KEY = "norishiro.onboardingSeen.v1";

function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== null;
  } catch {
    return true; // localStorage不可の環境では出さない
  }
}

export function HomePage(): ReactElement {
  const [hasHistory] = useState(() => loadHistory().length > 0);
  // 初回起動時に「使い方」を軽く促す表示を1回だけ出す（docs/15 3.1節。既読管理はlocalStorageのみ）
  const [showOnboarding, setShowOnboarding] = useState(() => !onboardingSeen());

  const dismissOnboarding = (): void => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // 保存できなくても表示は閉じる
    }
    setShowOnboarding(false);
  };

  return (
    <main className="app-main">
      <h1 className="app-title">ノリシロ</h1>
      <p className="app-tagline">その町、クルマがなくても行けます</p>

      {showOnboarding && (
        <div className="onboarding" role="status">
          <p>はじめてお使いになる方は「使い方」をご覧ください。</p>
          <div className="onboarding-actions">
            <Link to="/help" className="btn btn-inline">
              使い方を見る
            </Link>
            <button type="button" className="btn btn-inline" onClick={dismissOnboarding}>
              閉じる
            </button>
          </div>
        </div>
      )}

      <nav aria-label="メインメニュー">
        <Link to="/search" className="btn btn-primary">
          経路をさがす
        </Link>
        {hasHistory && (
          <Link to="/history" className="btn">
            履歴から再検索
          </Link>
        )}
        <Link to="/isochrone" className="btn">
          到達圏マップ（デモ）
        </Link>
      </nav>

      <footer className="app-footer">
        <nav aria-label="サイト情報">
          <Link to="/help">使い方</Link>
          <Link to="/credits">データ出典</Link>
          <Link to="/contact">お問い合わせ</Link>
        </nav>
      </footer>
    </main>
  );
}
