import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Clock, LogIn } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { MemberRole } from "@/lib/types";
import { ROLE_HINTS, ROLE_LABELS } from "@/lib/permissions";
import { formatHeb } from "@/lib/trip-options";
import { Flag } from "@/components/Flag";
import { BrandLogo } from "@/components/BrandLogo";
import { Button, Card, FullSpinner } from "@/components/ui";

type Preview = {
  title: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  cover_emoji: string | null;
  role: MemberRole;
};

/**
 * /join/:token — where a WhatsApp invite lands. Public: shows what the link
 * offers (invite_preview), sends signed-out visitors through sign-in and back,
 * then joins via accept_trip_invite (migration 015).
 */
export default function JoinPage() {
  const { token = "" } = useParams();
  const { session, isAnonymous, loading, signInWithGoogle, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const [pending, setPending] = useState(false);
  const returnPath = `/join/${token}`;

  useEffect(() => {
    // A failed lookup shows the same "invite not valid" card as an unknown token.
    supabase
      .rpc("invite_preview", { p_token: token })
      .then(({ data }) => setPreview((data as Preview | null) ?? null), () => setPreview(null));
  }, [token]);

  const join = async () => {
    setJoining(true);
    const { data, error } = await supabase.rpc("accept_trip_invite", { p_token: token });
    setJoining(false);
    if (error) {
      toast.error(error.message.includes("invalid_invite") ? "ההזמנה כבר לא בתוקף." : "ההצטרפות נכשלה. נסו שוב.");
      return;
    }
    const result = data as { trip_id: string; status: "pending" | "active" | "owner" | "removed" };
    if (result.status === "removed") {
      toast.error("בעל הטיול הסיר אותך מהטיול, ולכן הקישור לא מצרף אותך שוב. אפשר לבקש ממנו להוסיף אותך מחדש.");
      return;
    }
    if (result.status === "pending") {
      setPending(true);
      return;
    }
    toast.success("הצטרפת לטיול 🎉");
    navigate(`/trip/${result.trip_id}`, { replace: true });
  };

  if (loading || preview === undefined) return <FullSpinner label="טוען הזמנה…" />;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-16 pt-6">
      <BrandLogo />
      <div className="mt-8">
        {!preview ? (
          <Card className="p-6 text-center">
            <div className="text-5xl">🔒</div>
            <h1 className="mt-3 text-lg font-bold">ההזמנה לא בתוקף</h1>
            <p className="mt-1 text-sm text-muted-foreground">ייתכן שהקישור בוטל. בקשו מבעל הטיול קישור חדש.</p>
            <Link to="/" className="mt-4 inline-block font-semibold text-primary">
              לטיולים שלי
            </Link>
          </Card>
        ) : (
          <Card className="p-6">
            <div className="text-center">
              <div className="flex justify-center text-5xl">
                <Flag destination={preview.destination} fallback={preview.cover_emoji} className="w-16" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">הוזמנת להצטרף לטיול</p>
              <h1 className="mt-1 font-display text-2xl font-extrabold">{preview.title}</h1>
              <p className="text-muted-foreground">{preview.destination}</p>
              {preview.start_date && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatHeb(preview.start_date)} – {formatHeb(preview.end_date)}
                </p>
              )}
              <div className="mt-4 rounded-2xl bg-primary-soft p-3 text-sm">
                <span className="font-bold">{ROLE_LABELS[preview.role]}</span>: {ROLE_HINTS[preview.role]}
              </div>
            </div>

            <div className="mt-5">
              {pending ? (
                <div className="flex items-center gap-3 rounded-2xl bg-muted p-3 text-sm">
                  <Clock className="size-5 shrink-0 text-primary" />
                  הבקשה נשלחה. הטיול יופיע ברשימת הטיולים שלך אחרי שבעל הטיול יאשר.
                </div>
              ) : session && !isAnonymous ? (
                <Button size="lg" className="w-full" loading={joining} onClick={join}>
                  הצטרפות לטיול
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-center text-sm text-muted-foreground">
                    {isAnonymous ? "אתם במצב דמו. כדי להצטרף צריך חשבון אמיתי." : "כדי להצטרף צריך להתחבר. זה לוקח רגע."}
                  </p>
                  <Button
                    size="lg"
                    onClick={async () => {
                      if (isAnonymous) await signOut();
                      const { error } = await signInWithGoogle(returnPath);
                      if (error) toast.error(error);
                    }}
                  >
                    המשך עם Google
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={async () => {
                      if (isAnonymous) await signOut();
                      navigate(`/auth?next=${encodeURIComponent(returnPath)}`);
                    }}
                  >
                    <LogIn className="size-4" />
                    כניסה או הרשמה עם מייל
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
