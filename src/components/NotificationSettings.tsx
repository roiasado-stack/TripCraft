import { useEffect, useState } from "react";
import { Bell, BellOff, Send, Share, SquarePlus, UserPlus, Megaphone } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Button, GroupedList, Switch } from "@/components/ui";
import {
  VAPID_PUBLIC_KEY,
  detectPushSupport,
  isSubscribedHere,
  notificationPermission,
  subscribe,
  unsubscribe,
} from "@/lib/push";

type Prefs = { trip_updates: boolean; join_requests: boolean };

const row = "flex min-h-12 items-center gap-3 px-4 py-2.5";

/**
 * Settings → "התראות": web push on this device (migration 026, notify function).
 * Not rendered for demo (anonymous) users — they can't subscribe.
 */
export function NotificationSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [support] = useState(detectPushSupport);
  const [permission, setPermission] = useState(notificationPermission);
  const [deviceOn, setDeviceOn] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ trip_updates: true, join_requests: true });
  const [busy, setBusy] = useState(false);
  const [savingPref, setSavingPref] = useState(false);
  const [testing, setTesting] = useState(false);

  const canSubscribe = support === "supported" && !!VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("notification_settings")
      .select("trip_updates, join_requests")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        // No row = both on.
        if (!cancelled && data) setPrefs(data as Prefs);
      });
    if (support === "supported") {
      isSubscribedHere()
        .then((on) => !cancelled && setDeviceOn(on))
        .catch(() => !cancelled && setDeviceOn(false));
    } else {
      setDeviceOn(false);
    }
    return () => {
      cancelled = true;
    };
  }, [user, support]);

  const turnOn = async () => {
    setBusy(true);
    const result = await subscribe();
    setPermission(notificationPermission());
    setBusy(false);
    if (result === "ok") {
      setDeviceOn(true);
      toast.success("ההתראות הופעלו במכשיר הזה 🔔");
    } else if (result === "denied") {
      toast.error("הדפדפן חוסם התראות מהאתר. אפשר לאשר אותן בהגדרות הדפדפן.");
    } else if (result === "dismissed") {
      toast.error("לא אושרו התראות. אפשר לנסות שוב.");
    } else {
      toast.error("לא הצלחנו להפעיל התראות. נסו שוב.");
    }
  };

  const turnOff = async () => {
    setBusy(true);
    const ok = await unsubscribe().catch(() => false);
    setBusy(false);
    if (ok) {
      setDeviceOn(false);
      toast.success("ההתראות כובו במכשיר הזה");
    } else {
      toast.error("לא הצלחנו לכבות. נסו שוב.");
    }
  };

  const togglePref = async (key: keyof Prefs) => {
    if (!user) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setSavingPref(true);
    const { error } = await supabase
      .from("notification_settings")
      .upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSavingPref(false);
    if (error) {
      toast.error("השמירה נכשלה");
      return;
    }
    setPrefs(next);
    toast.success("נשמר ✓");
  };

  const sendTest = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("notify", { body: { type: "test" } });
    setTesting(false);
    const result = data as { sent?: number; no_devices?: boolean } | null;
    // A non-2xx arrives as FunctionsHttpError with the Response on .context (see @/lib/ai).
    const status = (error as { context?: Response } | null)?.context?.status;
    if (status === 429) {
      toast.error("אפשר לשלוח התראת ניסיון שוב בעוד רגע");
    } else if (error || !result) {
      toast.error("שליחת התראת הניסיון נכשלה. נסו שוב.");
    } else if (result.no_devices) {
      toast.error("אין מכשיר עם התראות פעילות. הפעילו קודם התראות במכשיר הזה.");
    } else if (!result.sent) {
      toast.error("ההתראה לא נמסרה. נסו לכבות ולהפעיל מחדש.");
    } else {
      toast.success("נשלחה התראת ניסיון. היא אמורה להגיע תוך רגע.");
    }
  };

  return (
    <>
      <GroupedList title="התראות">
        {/* this device */}
        {support === "ios-needs-home-screen" ? (
          <div className={row}>
            <SquarePlus className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="type-body">התראות באייפון</div>
              <div className="type-footnote text-muted-foreground">
                באייפון התראות עובדות רק מהאפליקציה במסך הבית: בספארי לוחצים על{" "}
                <Share className="inline size-4 align-text-bottom" aria-label="שתף" /> שתף ← "הוסף למסך הבית", פותחים
                את TripCraft מהמסך הבית ומפעילים כאן.
              </div>
            </div>
          </div>
        ) : support === "unsupported" ? (
          <div className={row}>
            <BellOff className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="type-body">הדפדפן הזה לא תומך בהתראות</div>
              <div className="type-footnote text-muted-foreground">נסו מ-Chrome, Edge, Firefox או Safari מעודכנים.</div>
            </div>
          </div>
        ) : !VAPID_PUBLIC_KEY ? (
          <div className={row}>
            <BellOff className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="type-body">התראות עדיין לא זמינות</div>
              <div className="type-footnote text-muted-foreground">השירות עוד לא הוגדר בשרת. נסו שוב בהמשך.</div>
            </div>
          </div>
        ) : permission === "denied" && !deviceOn ? (
          <div className={row}>
            <BellOff className="size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="type-body">הדפדפן חוסם התראות מ-TripCraft</div>
              <div className="type-footnote text-muted-foreground">
                כדי להפעיל: לוחצים על סמל המנעול או ההגדרות ליד כתובת האתר ← "התראות" ← "אפשר", ומרעננים את הדף.
                בטלפון אפשר גם דרך הגדרות הדפדפן ← הגדרות אתרים ← התראות.
              </div>
            </div>
          </div>
        ) : (
          <div className={row}>
            {deviceOn ? <Bell className="size-5 shrink-0 text-primary" /> : <BellOff className="size-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <div className="type-body">המכשיר הזה</div>
              <div className="type-footnote text-muted-foreground">
                {deviceOn === null ? "בודק…" : deviceOn ? "ההתראות פעילות" : "ההתראות כבויות"}
              </div>
            </div>
            {deviceOn !== null &&
              (deviceOn ? (
                <Button variant="outline" size="sm" loading={busy} onClick={turnOff}>
                  כבה
                </Button>
              ) : (
                <Button size="sm" loading={busy} disabled={!canSubscribe} onClick={turnOn}>
                  הפעל התראות במכשיר הזה
                </Button>
              ))}
          </div>
        )}

        {/* which kinds, for all of this account's devices */}
        <div className={row}>
          <Megaphone className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="type-body">עדכוני טיול</div>
            <div className="type-footnote text-muted-foreground">כשמישהו אחר מפרסם עדכון בטיול</div>
          </div>
          <Switch checked={prefs.trip_updates} disabled={savingPref} onChange={() => togglePref("trip_updates")} label="עדכוני טיול" />
        </div>
        <div className={row}>
          <UserPlus className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="type-body">בקשות הצטרפות</div>
            <div className="type-footnote text-muted-foreground">כשמישהו מבקש להצטרף לטיול שלך</div>
          </div>
          <Switch checked={prefs.join_requests} disabled={savingPref} onChange={() => togglePref("join_requests")} label="בקשות הצטרפות" />
        </div>

        {deviceOn && (
          <button
            type="button"
            onClick={sendTest}
            disabled={testing}
            className="type-body flex min-h-12 w-full items-center gap-3 px-4 text-start text-primary transition-colors active:bg-muted/70 disabled:opacity-60"
          >
            <Send className="size-5 shrink-0" />
            {testing ? "שולח…" : "שלח התראת ניסיון"}
          </button>
        )}
      </GroupedList>
      <p className="type-footnote -mt-4 px-4 text-muted-foreground">
        ההתראות נשלחות לכל מכשיר שהפעלתם בו. אפשר להשתיק טיול מסוים מעמוד הבית שלו.
      </p>
    </>
  );
}
