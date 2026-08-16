import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------- Button --------------------------------- */
type ButtonVariant = "primary" | "accent" | "soft" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:brightness-105 shadow-soft",
  accent: "bg-accent text-accent-foreground hover:brightness-105 shadow-pop",
  soft: "bg-primary-soft text-secondary-foreground hover:brightness-[0.98]",
  outline: "border border-border bg-card text-card-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  destructive: "bg-destructive text-destructive-foreground hover:brightness-105",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm rounded-xl gap-1.5",
  md: "h-11 px-5 text-[15px] rounded-2xl gap-2",
  lg: "h-14 px-6 text-base rounded-3xl gap-2.5",
  icon: "h-11 w-11 rounded-2xl",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

/* ----------------------------------- Card ---------------------------------- */
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-3xl border border-border bg-card text-card-foreground shadow-soft", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ---------------------------------- Inputs --------------------------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-2xl border border-input bg-card px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-[92px] w-full resize-y rounded-2xl border border-input bg-card px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground/70 transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1.5 block text-sm font-semibold text-foreground", className)} {...props}>
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ---------------------------------- Badge ---------------------------------- */
export function Badge({
  className,
  children,
  tone = "primary",
}: {
  className?: string;
  children: ReactNode;
  tone?: "primary" | "accent" | "sun" | "muted";
}) {
  const tones = {
    primary: "bg-primary-soft text-secondary-foreground",
    accent: "bg-accent-soft text-accent",
    sun: "bg-[var(--sun)] text-[var(--sun-foreground)]",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------- Spinner --------------------------------- */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-6 animate-spin text-primary", className)} />;
}

export function FullSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="size-8" />
      {label && <p className="text-sm font-medium">{label}</p>}
    </div>
  );
}

/* ------------------------------- Empty state ------------------------------- */
export function EmptyState({
  emoji,
  title,
  description,
  action,
}: {
  emoji: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <div className="text-5xl">{emoji}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* --------------------------------- Checkbox -------------------------------- */
export function Checkbox({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-xl border-2 transition",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
        className,
      )}
    >
      {checked && (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/* ------------------------------- Segmented -------------------------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; emoji?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 rounded-2xl bg-muted p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition",
            value === o.value ? "bg-card text-foreground shadow-soft" : "text-muted-foreground",
          )}
        >
          {o.emoji && <span className="ml-1">{o.emoji}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Modal ----------------------------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
        style={{ animation: "tc-fade 150ms ease-out" }}
      />
      <div
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-4xl border border-border bg-card p-5 shadow-pop sm:rounded-4xl"
        style={{ animation: "tc-sheet 220ms cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="סגור">
            <X className="size-5" />
          </Button>
        </div>
        {children}
        {footer && <div className="mt-5 flex gap-2">{footer}</div>}
      </div>
      <style>{`@keyframes tc-fade{from{opacity:0}to{opacity:1}}@keyframes tc-sheet{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

/* ------------------------------ Chip selector ------------------------------ */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-2 text-sm font-semibold transition active:scale-95",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-soft"
          : "border-border bg-card text-foreground",
      )}
    >
      {children}
    </button>
  );
}
