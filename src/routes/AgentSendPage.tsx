import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Trip, TripClient, TripInvite, TripRole } from "@/lib/types";
import { can } from "@/lib/permissions";
import { Button, EmptyState, FullSpinner, GroupedList } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { clientMessage, normalizePhone, waMeUrl } from "@/lib/whatsapp";
import { dateRangeHeb } from "@/lib/trip-dates";

/**
 * Step 3 of "new trip from documents", also reachable from inside a trip:
 * the trip's public page (share_slug, migration 013/016) and a participant
 * invite link (migration 015) in one WhatsApp message to the client — sent
 * from the agent's own phone through wa.me, or copied. Owner only.
 */
export default function AgentSendPage() {
  const { tripId } = useParams();
  const { user, profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const saved = useRef<{ name: string; phone: string; exists: boolean }>({ name: "", phone: "", exists: false });
  const [copied, setCopied] = useState(false);
  // The branding name from settings, else the name the agent asked for access with.
  const [requestedAgency, setRequestedAgency] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!tripId || !user) return;
      const [{ data: t }, { data: role }, { data: client }, { data: account }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.rpc("trip_role", { _trip_id: tripId }),
        supabase.from("trip_clients").select("*").eq("trip_id", tripId).maybeSingle(),
        supabase.from("agent_accounts").select("agency_name").eq("user_id", user.id).maybeSingle(),
      ]);
      if (!t || !can(role as TripRole | null, "manage")) {
        setState("forbidden");
        return;
      }
      setRequestedAgency((account as { agency_name: string } | null)?.agency_name ?? null);
      let current = t as Trip;
      const c = client as TripClient | null;
      setClientName(c?.client_name ?? "");
      setClientPhone(c?.client_phone ?? "");
      saved.current = { name: c?.client_name ?? "", phone: c?.client_phone ?? "", exists: !!c };

      // Sending means the client gets the public page: turn it on if it's off.
      if (!current.is_shared) {
        const { error } = await supabase.from("trips").update({ is_shared: true }).eq("id", current.id);
        if (error) {
          console.error(error);
          toast.error("לא הצלחנו לפתוח את קישור הטיול. נסו שוב.");
          setState("error");
          return;
        }
        current = { ...current, is_shared: true };
      }
      // The live participant link, or a new one (one live link per role).
      const { data: invites } = await supabase
        .from("trip_invites")
        .select("*")
        .eq("trip_id", current.id)
        .eq("role", "participant")
        .is("revoked_at", null)
        .limit(1);
      let invite: TripInvite | null = ((invites as TripInvite[] | null) ?? [])[0] ?? null;
      if (!invite) {
        const { data: created, error } = await supabase
          .from("trip_invites")
          .insert({ trip_id: current.id, role: "participant" })
          .select()
          .single();
        if (error) {
          console.error(error);
          toast.error("קישור ההצטרפות לא נוצר — נשלח רק את דף הטיול.");
        }
        invite = (created as TripInvite | null) ?? null;
      }
      setInviteUrl(invite ? `${window.location.origin}/join/${invite.token}` : null);
      setTrip(current);
      setState("ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, user]);

  if (state === "loading") return <FullSpinner label="מכינים את הקישורים…" />;
  if (state !== "ready" || !trip)
    return (
      <div className="mx-auto max-w-lg px-4 pt-16">
        <EmptyState
          emoji="🧭"
          title={state === "forbidden" ? "אין גישה לטיול הזה" : "משהו השתבש"}
          description={state === "forbidden" ? "רק מי שיצר את הטיול יכול לשלוח אותו ללקוח." : "נסו לרענן את הדף."}
          action={<Button onClick={() => navigate("/agent")}>לסביבת הסוכן</Button>}
        />
      </div>
    );

  const shareUrl = trip.share_slug ? `${window.location.origin}/share/${trip.share_slug}` : "";
  const message = clientMessage({
    clientName,
    destination: trip.destination,
    shareUrl,
    joinUrl: inviteUrl,
    agencyName: profile?.agency_name?.trim() || requestedAgency,
  });
  const phoneOk = !!normalizePhone(clientPhone);
  const phoneInvalid = clientPhone.trim() !== "" && !phoneOk;

  /** Keeps the client's details if the agent changed them here. Best effort, after the send. */
  const saveClient = async () => {
    const name = clientName.trim();
    const phone = clientPhone.trim();
    if (name === saved.current.name.trim() && phone === saved.current.phone.trim()) return;
    if (!name && !phone && !saved.current.exists) return;
    const { error } = await supabase
      .from("trip_clients")
      .upsert({ trip_id: trip.id, client_name: name || null, client_phone: phone || null });
    if (error) {
      toast.error("פרטי הלקוח לא נשמרו");
      return;
    }
    saved.current = { name, phone, exists: true };
  };

  const sendWhatsApp = () => {
    // Opened right in the click handler, so the popup isn't blocked.
    window.open(waMeUrl(clientPhone, message), "_blank", "noopener,noreferrer");
    void saveClient();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("ההודעה הועתקה");
      void saveClient();
    } catch {
      toast.error("לא ניתן להעתיק. סמנו והעתיקו ידנית.");
    }
  };

  const fieldRow = "flex min-h-12 items-center gap-3 px-4";
  const fieldInput = "type-body min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-muted-foreground";
  const actionRow =
    "type-body flex min-h-12 w-full items-center gap-3 px-4 text-start text-primary transition-colors active:bg-muted/70";

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate("/agent")}
          className="-ms-2 grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          aria-label="לסביבת הסוכן"
        >
          <ChevronRight className="size-6" />
        </button>
      </div>

      <h1 className="type-large-title">שליחה ללקוח</h1>
      <div className="mb-6 mt-3 flex items-center gap-3 rounded-2xl bg-card px-4 py-3">
        <Flag destination={trip.destination} fallback={trip.cover_emoji} className="w-[36px] text-[26px]" />
        <div className="min-w-0 flex-1">
          <div className="type-headline line-clamp-2 [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{trip.title}</div>
          <div className="type-footnote truncate text-muted-foreground">
            {[trip.destination, dateRangeHeb(trip.start_date, trip.end_date, new Date())].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <GroupedList title="הלקוח">
          <label className={fieldRow}>
            <span className="type-body w-20 shrink-0">שם</span>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="לדוגמה: משפחת כהן"
              maxLength={120}
              className={fieldInput}
            />
          </label>
          <label className={fieldRow}>
            <span className="type-body w-20 shrink-0">טלפון</span>
            <input
              type="tel"
              dir="ltr"
              inputMode="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="050-1234567"
              maxLength={40}
              className={`${fieldInput} text-end`}
              aria-invalid={phoneInvalid}
            />
          </label>
        </GroupedList>
        {(phoneInvalid || !clientPhone.trim()) && (
          <p className={`type-footnote -mt-4 px-4 ${phoneInvalid ? "text-destructive" : "text-muted-foreground"}`}>
            {phoneInvalid ? "המספר לא נראה תקין — וואטסאפ ישאל למי לשלוח." : "בלי מספר, וואטסאפ ישאל למי לשלוח."}
          </p>
        )}

        <section>
          <h2 className="type-footnote mb-1.5 px-4 font-semibold text-muted-foreground">ההודעה</h2>
          <p
            dir="auto"
            className="type-footnote whitespace-pre-wrap rounded-2xl bg-card px-4 py-3 [overflow-wrap:anywhere]"
          >
            {message}
          </p>
          <p className="type-footnote mt-1.5 px-4 text-muted-foreground">
            דף הטיול פתוח לצפייה למי שיש לו את הקישור, בלי מספרי הזמנה ובלי מסמכים. קישור ההצטרפות מצריך את האישור שלכם.
          </p>
        </section>

        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" onClick={sendWhatsApp}>
            <MessageCircle className="size-5" />
            שליחה בוואטסאפ
          </Button>
          <Button size="lg" variant="soft" className="w-full" onClick={copy}>
            {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
            העתקת ההודעה
          </Button>
        </div>

        <GroupedList>
          {shareUrl && (
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className={actionRow}>
              <ExternalLink className="size-5" />
              מה הנוסעים רואים
            </a>
          )}
          <button type="button" onClick={() => navigate(`/trip/${trip.id}`)} className={actionRow}>
            <ChevronLeft className="size-5" />
            לטיול
          </button>
          <button type="button" onClick={() => navigate("/agent")} className={actionRow}>
            <Check className="size-5" />
            סיום
          </button>
        </GroupedList>
      </div>
    </div>
  );
}
