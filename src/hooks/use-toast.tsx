import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; message: string; kind: ToastKind };

type ToastState = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastState>({
  toast: () => {},
  success: () => {},
  error: () => {},
});

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++counter;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const value: ToastState = {
    toast: push,
    success: (m) => push(m, "success"),
    error: (m) => push(m, "error"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground shadow-pop"
            style={{ animation: "tc-slide-in 200ms ease-out" }}
          >
            {t.kind === "success" && <CheckCircle2 className="size-5 shrink-0 text-primary" />}
            {t.kind === "error" && <XCircle className="size-5 shrink-0 text-destructive" />}
            {t.kind === "info" && <Info className="size-5 shrink-0 text-muted-foreground" />}
            <span className="flex-1 leading-snug">{t.message}</span>
          </div>
        ))}
      </div>
      <style>{`@keyframes tc-slide-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
