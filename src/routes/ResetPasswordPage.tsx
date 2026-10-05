import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/BrandLogo";
import { Button, Card, FullSpinner, Input, Label } from "@/components/ui";

/**
 * Landing page of the password-recovery email. supabase-js reads the recovery
 * token from the URL and opens a session, so all that's left is updateUser.
 * Without a session the link was expired or already used.
 */
export default function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <FullSpinner label="רגע, טוענים…" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("הסיסמה עודכנה ✅");
    navigate("/", { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-surf">
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-7 flex justify-center">
          <BrandLogo size="lg" withText={false} />
        </div>
        <Card className="p-6">
          {session ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <h1 className="text-lg font-bold">בחירת סיסמה חדשה</h1>
              <div>
                <Label>סיסמה חדשה</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="לפחות 6 תווים"
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" size="lg" loading={busy} className="w-full">
                שמירת הסיסמה
              </Button>
            </form>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <h1 className="text-lg font-bold">הקישור כבר לא בתוקף</h1>
              <p className="text-sm text-muted-foreground">
                קישורי איפוס תקפים לזמן קצר ולשימוש אחד. אפשר לבקש קישור חדש ממסך הכניסה.
              </p>
              <Link to="/auth" className="font-semibold text-primary underline underline-offset-2">
                למסך הכניסה
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
