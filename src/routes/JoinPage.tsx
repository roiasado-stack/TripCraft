import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Clock, LogIn, UserX } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { MemberRole } from "@/lib/types";
import { stepAfterWaitingCheck, stepForMemberStatus, type WaitingCheckStep } from "@/lib/join-waiting";
import { ROLE_HINTS, ROLE_LABELS } from "@/lib/permissions";
import { formatHeb } from "@/lib/trip-options";
import { Flag } from "@/components/Flag";
import { BrandLogo } from "@/components/BrandLogo";
import { Button, FullSpinner } from "@/components/ui";

type Preview = {
  title: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  cover_emoji: string | null;
  role: MemberRole;
  /** The client's personal link from the agent (migration 024). */
  grants_lead?: boolean;
  /** Masked address the personal link is locked to, e.g. da***@gmail.com. */
  lead_email_hint?: string | null;
};

/**
 * Dead ends that need their own message: accept_trip_invite refusals (migration 024),
 * a member the owner removed, and a waiting request whose row no longer exists.
 */
type JoinProblem = "wrong_account" | "lead_taken" | "removed" | "gone" | null;

/** A join request waiting for approval, for this link and this account only. */
type WaitingRequest = {
  tripId: string;
  userId: string;
  token: string;
  /** Joined by a personal link but not made lead, so the lead wording doesn't apply. */
  notLead: boolean;
};

const WAITING_CHECK_MS = 10_000;

/**
 * /join/:token — where a WhatsApp invite lands. Public: shows what the link
 * offers (invite_preview), sends signed-out visitors through sign-in and back,
 * then joins via accept_trip_invite (migration 015).
 */
export default function JoinPage() {
  const { token = "" } = useParams();
  const { session, user, isAnonymous, loading, signInWithGoogle, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const [waitingRequest, setWaitingRequest] = useState<WaitingRequest | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);
  const [problem, setProblem] = useState<JoinProblem>(null);
  const runCheck = useRef<(() => Promise<WaitingCheckStep>) | null>(null);
  // The toast object changes whenever a toast shows; the checks below shouldn't restart for that.
  const toastRef = useRef(toast);
  const returnPath = `/join/${token}`;
  const isLeadLink = !!preview?.grants_lead;
  // Another account (signed in from another tab) or another link is not this request:
  // its row would read as gone.
  const waiting = waitingRequest && waitingRequest.userId === user?.id && waitingRequest.token === token ? waitingRequest : null;
  const waitingTripId = waiting?.tripId;
  const waitingUserId = waiting?.userId;

  useEffect(() => {
    toastRef.current = toast;
  });

  useEffect(() => {
    // A failed lookup shows the same "invite not valid" card as an unknown token.
    supabase
      .rpc("invite_preview", { p_token: token })
      .then(({ data }) => setPreview((data as Preview | null) ?? null), () => setPreview(null));
  }, [token]);

  // While waiting: re-read the user's own member row on a timer and when the page
  // comes back. A failed read does nothing and the next one retries.
  useEffect(() => {
    if (!waitingTripId || !waitingUserId) return;
    let stopped = false;
    let inFlight: Promise<WaitingCheckStep> | null = null;

    const read = async (): Promise<WaitingCheckStep> => {
      try {
        const { data, error } = await supabase
          .from("trip_members")
          .select("status")
          .eq("trip_id", waitingTripId)
          .eq("user_id", waitingUserId)
          .maybeSingle();
        return stepAfterWaitingCheck(!!error, (data as { status: string } | null)?.status);
      } catch {
        return "retry";
      }
    };

    const check = () => {
      inFlight ??= read().then((step) => {
        inFlight = null;
        if (stopped) return step;
        if (step === "open_trip") {
          stopped = true;
          toastRef.current.success("הבקשה אושרה, נכנסים לטיול 🎉");
          navigate(`/trip/${waitingTripId}`, { replace: true });
        } else if (step === "removed" || step === "gone") {
          stopped = true;
          setProblem(step);
          setWaitingRequest(null);
        }
        return step;
      });
      return inFlight;
    };
    runCheck.current = check;

    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, WAITING_CHECK_MS);
    const onVisibility = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      runCheck.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [waitingTripId, waitingUserId, navigate]);

  const checkNow = async () => {
    if (!runCheck.current) return;
    setCheckingNow(true);
    const step = await runCheck.current();
    setCheckingNow(false);
    if (step === "wait") toast.toast("עדיין ממתינים לאישור.");
    else if (step === "retry") toast.error("הבדיקה לא הצליחה. ננסה שוב בעוד רגע.");
  };

  const join = async () => {
    setJoining(true);
    const { data, error } = await supabase.rpc("accept_trip_invite", { p_token: token });
    setJoining(false);
    if (error) {
      if (error.message.includes("wrong_account")) setProblem("wrong_account");
      else if (error.message.includes("lead_taken")) setProblem("lead_taken");
      else
        toast.error(
          error.message.includes("invalid_invite")
            ? "ההזמנה כבר לא בתוקף, או שהקישור האישי כבר שומש."
            : "ההצטרפות נכשלה. נסו שוב.",
        );
      return;
    }
    const result = data as {
      trip_id: string;
      status: "pending" | "active" | "owner" | "removed";
      /** Already on the trip, personal link without an email: not made lead (migration 024). */
      not_lead?: boolean;
    };
    const step = stepForMemberStatus(result.status);
    if (step === "removed" || step === "gone") {
      setProblem(step);
      return;
    }
    if (result.not_lead) {
      toast.error("כבר הייתם בטיול, ולכן הקישור האישי לא הפך אתכם ללקוח הראשי. בקשו מהסוכן לסמן אתכם כלקוח ראשי.");
    }
    if (step === "wait") {
      if (user) setWaitingRequest({ tripId: result.trip_id, userId: user.id, token, notLead: !!result.not_lead });
      return;
    }
    if (!result.not_lead) toast.success("הצטרפת לטיול 🎉");
    navigate(`/trip/${result.trip_id}`, { replace: true });
  };

  if (loading || preview === undefined) return <FullSpinner label="טוען הזמנה…" />;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-16 pt-6">
      <BrandLogo />
      <div className="mt-8">
        {!preview ? (
          <div className="rounded-3xl bg-card p-6 text-center text-card-foreground">
            <div className="text-5xl">🔒</div>
            <h1 className="type-title mt-3">ההזמנה לא בתוקף</h1>
            <p className="type-footnote mt-1 text-muted-foreground">
              ייתכן שהקישור בוטל, או שזה קישור אישי שכבר שומש. בני משפחה מקבלים קישור מהלקוח שמנהל את הטיול.
            </p>
            <Link to="/" className="type-headline mt-4 inline-flex min-h-11 items-center text-primary">
              לטיולים שלי
            </Link>
          </div>
        ) : (
          <div className="rounded-3xl bg-card p-6 text-card-foreground">
            <div className="text-center">
              <div className="flex justify-center text-5xl">
                <Flag destination={preview.destination} fallback={preview.cover_emoji} className="w-16" />
              </div>
              <p className="type-footnote mt-3 text-muted-foreground">הוזמנת להצטרף לטיול</p>
              <h1 className="type-title mt-1 [overflow-wrap:anywhere]">
                <bdi>{preview.title}</bdi>
              </h1>
              <p className="type-body text-muted-foreground">
                <bdi>{preview.destination}</bdi>
              </p>
              {preview.start_date && (
                <p className="type-footnote mt-1 text-muted-foreground">
                  {formatHeb(preview.start_date)}
                  {preview.end_date ? ` – ${formatHeb(preview.end_date)}` : ""}
                </p>
              )}
              {isLeadLink ? (
                <div className="type-footnote mt-4 rounded-2xl bg-primary-soft p-3 text-start">
                  <span className="font-semibold text-primary">הקישור האישי שלך מהסוכן</span>
                  <span className="block text-foreground">
                    תצטרפו כלקוח הראשי של הטיול: תראו הכול, ותוכלו להזמין את בני המשפחה ולנהל מי בטיול.
                  </span>
                  {preview.lead_email_hint && (
                    <span className="mt-1 block text-muted-foreground">
                      הקישור נפתח רק לחשבון <bdi dir="ltr">{preview.lead_email_hint}</bdi>
                    </span>
                  )}
                </div>
              ) : (
                <div className="type-footnote mt-4 rounded-2xl bg-primary-soft p-3 text-start">
                  <span className="font-semibold text-primary">{ROLE_LABELS[preview.role]}</span>
                  <span className="block text-foreground">{ROLE_HINTS[preview.role]}</span>
                </div>
              )}
            </div>

            <div className="mt-5">
              {problem === "wrong_account" ? (
                <div className="flex flex-col gap-3">
                  <p className="type-footnote flex items-start gap-3 rounded-2xl bg-muted p-3">
                    <UserX className="size-5 shrink-0 text-destructive" />
                    <span>
                      הקישור הזה מיועד לחשבון{" "}
                      {preview.lead_email_hint ? <bdi dir="ltr">{preview.lead_email_hint}</bdi> : "אחר"}, ואתם מחוברים
                      עכשיו כ-<bdi dir="ltr">{user?.email || "חשבון אחר"}</bdi>. התחברו עם החשבון הנכון. אם המייל שלכם
                      השתנה, בקשו מהסוכן לעדכן אותו ולשלוח קישור חדש.
                    </span>
                  </p>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={async () => {
                      await signOut();
                      setProblem(null);
                    }}
                  >
                    <LogIn className="size-4" />
                    החלפת חשבון
                  </Button>
                </div>
              ) : problem === "lead_taken" ? (
                <p className="type-footnote flex items-start gap-3 rounded-2xl bg-muted p-3">
                  <Clock className="size-5 shrink-0 text-primary" />
                  לטיול הזה כבר יש לקוח ראשי. בקשו ממנו את קישור ההצטרפות של המשפחה.
                </p>
              ) : problem === "removed" || problem === "gone" ? (
                <div className="flex flex-col items-center gap-2">
                  <p className="type-footnote flex items-start gap-3 rounded-2xl bg-muted p-3">
                    <UserX className="size-5 shrink-0 text-destructive" />
                    {problem === "removed"
                      ? "הוסרת מהטיול, ולכן הקישור לא מצרף אותך שוב. אפשר לבקש ממי שמנהל את הטיול להוסיף אותך מחדש."
                      : "הבקשה להצטרף כבר לא פעילה. ייתכן שהטיול נמחק. אפשר לבקש ממי ששלח את הקישור להזמין אותך שוב."}
                  </p>
                  <Link to="/" className="type-headline inline-flex min-h-11 items-center text-primary">
                    לטיולים שלי
                  </Link>
                </div>
              ) : waiting ? (
                <div className="flex flex-col gap-3">
                  <div className="type-footnote flex items-start gap-3 rounded-2xl bg-muted p-3">
                    <Clock className="size-5 shrink-0 text-primary" />
                    {isLeadLink && !waiting.notLead
                      ? "נכנסתם. אחרי שהסוכן יאשר, הטיול ייפתח כאן מעצמו ותוכלו להזמין את המשפחה. אפשר גם לסגור את האפליקציה: אחרי האישור הטיול יופיע ברשימת הטיולים שלכם."
                      : "הבקשה נשלחה. אחרי שבעל הטיול יאשר, הטיול ייפתח כאן מעצמו. אפשר גם לסגור את האפליקציה: אחרי האישור הטיול יופיע ברשימת הטיולים שלך."}
                  </div>
                  <Button size="lg" variant="outline" className="w-full" loading={checkingNow} onClick={checkNow}>
                    בדיקה עכשיו
                  </Button>
                </div>
              ) : session && !isAnonymous ? (
                <Button size="lg" className="w-full" loading={joining} onClick={join}>
                  הצטרפות לטיול
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="type-footnote text-center text-muted-foreground">
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
          </div>
        )}
      </div>
    </div>
  );
}
