// ErrorBoundary — catch a render-time crash in a route so it degrades to a
// recoverable card instead of white-screening the whole app. Wrapped around
// the Studio Outlet, so the sidebar/nav survive a single page's exception and
// the user can retry or jump back to chat. Stale-chunk import failures are
// handled separately (App.tsx reloadForStaleChunk); this is for runtime throws.

import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Changing this (e.g. location.pathname) clears the error — so navigating
   *  away from a broken route recovers without a manual reload. */
  resetKey?: string;
}
interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown) {
    // Surface for observability — shows up in the browser console + any
    // error-reporting hook listening on window.
    console.error("[studio] route crashed:", err);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: undefined });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="max-w-md mx-auto mt-[12vh] px-4 text-center">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-rose-50 text-rose-600 mb-3">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <h2 className="font-display text-xl font-medium text-foreground tracking-tight">This page hit a snag</h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Something on this page errored. The rest of Studio still works — reload the page or head back to the chat.
        </p>
        {this.state.message && (
          <p className="mt-2 text-[11px] text-muted-foreground/70 font-mono break-words">{this.state.message.slice(0, 200)}</p>
        )}
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-[13px] hover:bg-primary/85 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reload
          </button>
          <Link to="/studio" className="px-3 py-1.5 rounded-full border border-border text-[13px] text-foreground hover:bg-muted transition-colors">
            Back to chat
          </Link>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
