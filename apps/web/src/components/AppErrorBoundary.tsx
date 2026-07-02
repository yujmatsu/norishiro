// アプリ全体のエラーバウンダリ。描画中の予期しない例外で画面が真っ白になるのを防ぎ、
// 「何が起きたか」「次に何をすればよいか」を表示する（docs/15 5.5節のエラーメッセージ方針）。
import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 外部送信はしない（docs/15 8章）。開発者がDevToolsで確認するためのログのみ
    console.error("AppErrorBoundary caught:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <main className="app-main">
          <h1>問題が発生しました</h1>
          <p className="status-text" role="alert">
            画面の表示中にエラーが発生しました。再読み込みをお試しください。
          </p>
          <p className="status-text">（詳細: {this.state.error.message}）</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            再読み込み
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
