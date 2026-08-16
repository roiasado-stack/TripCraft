import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches render/lifecycle errors anywhere below it and shows a readable
 * Hebrew screen instead of a blank page, with the technical detail available
 * for reporting. Without this, a single bad row can white-screen the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[TripCraft] crash:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-6xl">🛟</div>
        <h1 className="text-xl font-extrabold">משהו השתבש</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          נתקלנו בתקלה במסך הזה. הנתונים שלך בטוחים — אפשר לנסות שוב.
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ error: null })}
            className="h-12 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground"
          >
            נסה שוב
          </button>
          <button
            onClick={() => {
              window.location.href = "/";
            }}
            className="h-12 rounded-2xl border border-border bg-card px-5 font-semibold"
          >
            חזרה לטיולים
          </button>
        </div>

        <details className="mt-2 max-w-sm text-right">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            פרטים טכניים
          </summary>
          <pre
            dir="ltr"
            className="mt-2 max-h-48 overflow-auto rounded-xl bg-muted p-3 text-left text-[11px] leading-relaxed"
          >
            {error.message}
            {"\n\n"}
            {error.stack?.slice(0, 800)}
          </pre>
        </details>
      </div>
    );
  }
}
