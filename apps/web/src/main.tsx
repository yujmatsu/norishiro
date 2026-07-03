import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { applyDisplaySettings, loadDisplaySettings } from "./lib/settings.js";
import "./styles.css";

// 保存済みの表示設定（文字サイズ・高コントラスト）を初回描画前に反映する（ちらつき防止）
applyDisplaySettings(loadDisplaySettings());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
