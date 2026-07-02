// アプリのルーティング骨格。S4詳細・S6履歴・S7到達圏・S8〜S10（docs/15 2.2節）はPhase C/D以降で追加。
import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage.js";
import { ResultsPage } from "./pages/ResultsPage.js";
import { SearchWizardPage } from "./pages/SearchWizardPage.js";

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/search" element={<SearchWizardPage />} />
      <Route path="/result" element={<ResultsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
