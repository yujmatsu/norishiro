// アプリのルーティング骨格（docs/15 2.2節の画面一覧S1〜S10に対応）。
import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ContactPage } from "./pages/ContactPage.js";
import { CreditsPage } from "./pages/CreditsPage.js";
import { DetailPage } from "./pages/DetailPage.js";
import { HelpPage } from "./pages/HelpPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { HomePage } from "./pages/HomePage.js";
import { IsochronePage } from "./pages/IsochronePage.js";
import { ResultsPage } from "./pages/ResultsPage.js";
import { SearchWizardPage } from "./pages/SearchWizardPage.js";

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/search" element={<SearchWizardPage />} />
      <Route path="/result" element={<ResultsPage />} />
      <Route path="/detail" element={<DetailPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/isochrone" element={<IsochronePage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/credits" element={<CreditsPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
