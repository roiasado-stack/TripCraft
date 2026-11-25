import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { track } from "@/lib/analytics";
import {
  TRIPS_OPTIONS,
  sendDemoRequest,
  validateDemoRequest,
  type DemoRequestErrors,
  type DemoRequestInput,
} from "@/lib/demo-request";
import { cn } from "@/lib/utils";

/* The agent demo request form, shown on /agents (anchor #demo). Public: no login, one POST to the demo-request function. */

const EMPTY: DemoRequestInput = { fullName: "", agencyName: "", phone: "", email: "", tripsPerMonth: "" };

export function AgentDemoForm() {
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const [values, setValues] = useState<DemoRequestInput>(EMPTY);
  const [errors, setErrors] = useState<DemoRequestErrors>({});
  const [website, setWebsite] = useState(""); // honeypot: real visitors never see it
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<"busy" | "failed" | null>(null);
  const [done, setDone] = useState(false);

  // A link to /agents#demo: the router doesn't scroll to anchors on its own.
  useEffect(() => {
    if (hash === "#demo") ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  function set<K extends keyof DemoRequestInput>(key: K, value: DemoRequestInput[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    const found = validateDemoRequest(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSending(true);
    setFailure(null);
    const result = await sendDemoRequest(values, website);
    setSending(false);
    if (result.ok) {
      track("submit_agent_demo");
      setDone(true);
    } else {
      setFailure(result.reason);
    }
  }

  return (
    <section id="demo" ref={ref} className="mx-auto max-w-3xl scroll-mt-4 px-4 pt-14 sm:px-6">
      <Card className="p-6 sm:p-8">
        {done ? (
          <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
              <CheckCircle2 className="size-8" />
            </span>
            <p className="font-display text-xl font-bold leading-snug">
              תודה! נחזור אליכם תוך יום עסקים אחד עם קישור להדגמה
            </p>
          </div>
        ) : (
          <>
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">קבעו הדגמה של 15 דקות</h2>
            <form onSubmit={submit} noValidate className="mt-5 space-y-4">
              <TextField
                label="שם מלא"
                error={errors.fullName}
                input={{ value: values.fullName, onChange: (v) => set("fullName", v), autoComplete: "name" }}
              />
              <TextField
                label="שם סוכנות"
                error={errors.agencyName}
                input={{ value: values.agencyName, onChange: (v) => set("agencyName", v), autoComplete: "organization" }}
              />
              <TextField
                label="טלפון"
                error={errors.phone}
                input={{ value: values.phone, onChange: (v) => set("phone", v), type: "tel", autoComplete: "tel", inputMode: "tel", dir: "ltr" }}
              />
              <TextField
                label="מייל"
                error={errors.email}
                input={{ value: values.email, onChange: (v) => set("email", v), type: "email", autoComplete: "email", inputMode: "email", dir: "ltr" }}
              />

              <div>
                <label htmlFor="demo-trips" className="mb-1.5 block text-sm font-semibold">
                  כמה טיולים בחודש?
                </label>
                <select
                  id="demo-trips"
                  value={values.tripsPerMonth}
                  onChange={(e) => set("tripsPerMonth", e.target.value as DemoRequestInput["tripsPerMonth"])}
                  aria-invalid={errors.tripsPerMonth ? true : undefined}
                  aria-describedby={errors.tripsPerMonth ? "demo-trips-error" : undefined}
                  className={cn(
                    "h-12 w-full rounded-2xl border border-input bg-card px-4 text-[15px] text-foreground transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40",
                    values.tripsPerMonth === "" && "text-muted-foreground",
                  )}
                >
                  <option value="" disabled>
                    בחרו
                  </option>
                  {TRIPS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {errors.tripsPerMonth && (
                  <p id="demo-trips-error" className="mt-1 text-sm text-destructive">
                    {errors.tripsPerMonth}
                  </p>
                )}
              </div>

              {/* Honeypot: hidden from people and from screen readers. */}
              <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  אתר
                  <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>

              {failure && (
                <p role="alert" className="text-sm font-semibold text-destructive">
                  {failure === "busy"
                    ? "יש כרגע עומס, נסו שוב בעוד כמה דקות."
                    : "לא הצלחנו לשלוח את הפרטים. נסו שוב."}
                </p>
              )}

              <Button type="submit" size="lg" loading={sending} className="w-full">
                שלחו לי הדגמה
              </Button>
            </form>
          </>
        )}
      </Card>
    </section>
  );
}

function TextField({
  label,
  error,
  input,
}: {
  label: string;
  error?: string;
  input: {
    value: string;
    onChange: (v: string) => void;
    type?: string;
    autoComplete?: string;
    inputMode?: "tel" | "email";
    dir?: "ltr";
  };
}) {
  const id = `demo-${label}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <Input
        id={id}
        value={input.value}
        onChange={(e) => input.onChange(e.target.value)}
        type={input.type ?? "text"}
        autoComplete={input.autoComplete}
        inputMode={input.inputMode}
        dir={input.dir}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
