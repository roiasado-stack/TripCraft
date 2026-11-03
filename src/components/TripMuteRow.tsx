import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui";

/**
 * "Mute this trip" (trip_notification_mutes, migration 026). A personal
 * preference, not a trip edit: any role that can see the trip may mute it for
 * themselves, so there's no can() gate. Hidden for demo users (no push).
 */
export function TripMuteRow({ tripId }: { tripId: string }) {
  const { user, isAnonymous } = useAuth();
  const toast = useToast();
  const [muted, setMuted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("trip_notification_mutes")
      .select("trip_id")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .maybeSingle();
    setMuted(!!data);
  };

  useEffect(() => {
    if (!isAnonymous) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, user?.id, isAnonymous]);

  if (isAnonymous || !user || muted === null) return null;

  const toggle = async () => {
    setBusy(true);
    const { error } = muted
      ? await supabase.from("trip_notification_mutes").delete().eq("trip_id", tripId).eq("user_id", user.id)
      : await supabase.from("trip_notification_mutes").insert({ trip_id: tripId });
    setBusy(false);
    if (error) {
      toast.error("לא הצלחנו לעדכן את ההתראות");
      return;
    }
    toast.success(muted ? "ההשתקה בוטלה. ההתראות מהטיול יחזרו" : "ההתראות מהטיול הזה הושתקו");
    await load();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="type-headline flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start text-primary transition-colors active:bg-muted/70 disabled:opacity-60"
    >
      {busy ? <Spinner className="size-5" /> : muted ? <Bell className="size-5" /> : <BellOff className="size-5" />}
      <span className="min-w-0 flex-1">
        <span className="block">{muted ? "בטל השתקה" : "השתק התראות מהטיול הזה"}</span>
        {muted && <span className="type-footnote block font-normal text-muted-foreground">ההתראות מהטיול הזה מושתקות</span>}
      </span>
    </button>
  );
}
