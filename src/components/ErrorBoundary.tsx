import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { label: string; children: ReactNode }
interface State { error: Error | null }

/** Contains a crash to one section: the section shows what failed (and a retry) instead of blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error.message, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200" data-testid={`error-boundary-${this.props.label}`}>
        <p className="font-semibold">{this.props.label} failed to render.</p>
        <p className="mt-1 break-words text-red-300/80">{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="mt-3 rounded-md border border-red-700 px-3 py-1.5 text-xs text-red-100 hover:bg-red-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
          Try again
        </button>
      </div>
    );
  }
}
