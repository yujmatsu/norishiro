// アプリのルーティング骨格（Phase A）。画面本体（S1〜S10、docs/15 3章）はPhase B以降で実装する。
import type { ReactElement } from "react";
import { Route, Routes } from "react-router-dom";
import { DevCheckPage } from "./pages/DevCheckPage.js";

export function App(): ReactElement {
  return (
    <Routes>
      {/* Phase B以降: S1ホーム / S2検索ステップ / S3結果一覧 / S4詳細 / S6履歴 / S7到達圏 / S8〜S10 */}
      <Route path="*" element={<DevCheckPage />} />
    </Routes>
  );
}
