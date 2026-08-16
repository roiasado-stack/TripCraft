import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/BrandLogo";
import { Button, Card, FullSpinner, Input, Label } from "@/components/ui";
import { Mail } from "lucide-react";

type Mode = "signin" | "signup";

export default function AuthPage() {
  const { session, loading, signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (loading) return <FullSpinner label="רגע, טוענים…" />;
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await signInWithPassword(email.trim(), password);
        if (error) toast.error(error);
      } else {
        if (!fullName.trim()) {
          toast.error("איך קוראים לך?");
          return;
        }
        const { error, needsConfirmation } = await signUpWithPassword(
          email.trim(),
          password,
          fullName.trim(),
        );
        if (error) toast.error(error);
        else if (needsConfirmation) {
          setSent(true);
          toast.success("שלחנו לך מייל לאישור החשבון 📩");
        } else {
          toast.success("ברוך הבא ל-TripCraft! 🎉");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const { error } = await signInWithGoogle();
    if (error) {
      toast.error(error);
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-surf">
      {/* decorative sun blobs */}
      <div className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-[var(--sun)] opacity-30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-10 size-72 rounded-full bg-accent opacity-20 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <BrandLogo size="lg" withText={false} />
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              Trip<span className="text-primary">Craft</span>
            </h1>
            <p className="mt-1 text-[15px] text-muted-foreground">
              בונים, מארגנים ומלווים כל טיול — במקום אחד.
            </p>
          </div>
        </div>

        <Card className="p-6">
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Mail className="size-12 text-primary" />
              <h2 className="text-lg font-bold">בדוק את המייל שלך</h2>
              <p className="text-sm text-muted-foreground">
                שלחנו קישור אישור ל-<span className="font-semibold">{email}</span>. אחרי האישור אפשר
                להתחבר.
              </p>
              <Button variant="ghost" onClick={() => { setSent(false); setMode("signin"); }}>
                חזרה להתחברות
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-5 flex gap-1 rounded-2xl bg-muted p-1">
                <button
                  onClick={() => setMode("signin")}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                    mode === "signin" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground"
                  }`}
                >
                  כניסה
                </button>
                <button
                  onClick={() => setMode("signup")}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                    mode === "signup" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground"
                  }`}
                >
                  הרשמה
                </button>
              </div>

              <form onSubmit={submit} className="flex flex-col gap-4">
                {mode === "signup" && (
                  <div>
                    <Label>שם מלא</Label>
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="ישראל ישראלי"
                      autoComplete="name"
                    />
                  </div>
                )}
                <div>
                  <Label>אימייל</Label>
                  <Input
                    type="email"
                    dir="ltr"
                    className="text-right"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <Label>סיסמה</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="לפחות 6 תווים"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
                  {mode === "signin" ? "כניסה" : "יצירת חשבון"}
                </Button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>או</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Button variant="outline" size="lg" onClick={google} disabled={busy} className="w-full">
                <GoogleIcon />
                המשך עם Google
              </Button>
            </>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          בהמשך הרישום אתה מסכים לתנאי השימוש ומדיניות הפרטיות.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
