import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Trip, TripClient, TripInvite, TripRole } from "@/lib/types";
import { can } from "@/lib/permissions";
import { Button, EmptyState, FullSpinner, GroupedList } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { clientMessage, normalizePhone, waMeUrl } from "@/lib/whatsapp";
import { dateRangeHeb } from "@/lib/trip-dates";

/** Shown in the preview until the links exist (they're created on send, never on open). */
const SHARE_PLACEHOLDER = "[קישור לדף הטיול]";
const JOIN_PLACEHOLDER = "[קישור הצטרפות]";

type Links = { shareUrl: string; joinUrl: string | null };

/** The trip's live participant link (one live link per role, migration 015), if there is one. */
async function liveParticipantInvite(tripId: string): Promise<{ invite: TripInvite | null; error: boolean }> {
  const { data, error } = await supabase
    .from("trip_invites")
    .select("*")
    .eq("trip_id", tripId)
    .eq("role", "participant")
    .is("revoked_at", null)
    .limit(1);
  if (error) console.error(error);
  return { invite: ((data as TripInvite[] | null) ?? [])[0] ?? null, error: !!error };
}

/** Thrown when the link we'd send turns out not to require approval and the agent hasn't seen that yet. */
class ApprovalNotRequired extends Error {}

/**
 * Step 3 of "new trip from documents", also reachable from inside a trip:
 * the trip's public page (share_slug, migration 013/016) and a participant
 * invite link (migration 015) in one WhatsApp message to the client — sent
 * from the agent's own phone through wa.me, or copied. Owner only.
 *
 * Opening this page changes nothing. Sharing is turned on and the invite is
 * created only when the agent taps send or copy (see prepareLinks).
 */
export default function AgentSendPage() {
  const { tripId } = useParams();
  const { user, profile } = useAuth();
  const userId = user?.id;
  const toast = useToast();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [invite, setInvite] = useState<TripInvite | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const saved = useRef<{ name: string; phone: string; exists: boolean }>({ name: "", phone: "", exists: false });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  // One in-flight/finished preparation, so a double tap never creates twice.
  const preparing = useRef<Promise<Links> | null>(null);
  // The branding name from settings, else the name the agent asked for access with.
  const [requestedAgency, setRequestedAgency] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tripId || !userId) return;
      const [{ data: t }, { data: role }, { data: client }, { data: account }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.rpc("trip_role", { _trip_id: tripId }),
        supabase.from("trip_clients").select("*").eq("trip_id", tripId).maybeSingle(),
        supabase.from("agent_accounts").select("agency_name").eq("user_id", userId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (!t || !can(role as TripRole | null, "manage")) {
        setState("forbidden");
        return;
      }
      // Read only: the live participant link, if one exists. Nothing is created here.
      const { invite: live, error: inviteError } = await liveParticipantInvite(tripId);
      if (cancelled) return;
      if (inviteError) {
        setState("error");
        return;
      }
      setRequestedAgency((account as { agency_name: string } | null)?.agency_name ?? null);
      const c = client as TripClient | null;
      setClientName(c?.client_name ?? "");
      setClientPhone(c?.client_phone ?? "");
      saved.current = { name: c?.client_name ?? "", phone: c?.client_phone ?? "", exists: !!c };
      preparing.current = null;
      setInvite(live);
      setTrip(t as Trip);
      setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, userId]);

  if (state === "loading") return <FullSpinner label="רגע, טוענים…" />;
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

  const realShareUrl = trip.share_slug ? `${window.location.origin}/share/${trip.share_slug}` : "";
  const realJoinUrl = invite ? `${window.location.origin}/join/${invite.token}` : null;
  const buildMessage = (links: Links) =>
    clientMessage({
      clientName,
      destination: trip.destination,
      shareUrl: links.shareUrl,
      joinUrl: links.joinUrl,
      agencyName: profile?.agency_name?.trim() || requestedAgency,
    });
  // The preview never shows a link that doesn't work yet.
  const preview = buildMessage({
    shareUrl: trip.is_shared && realShareUrl ? realShareUrl : SHARE_PLACEHOLDER,
    joinUrl: realJoinUrl ?? JOIN_PLACEHOLDER,
  });
  const phoneOk = !!normalizePhone(clientPhone);
  const phoneInvalid = clientPhone.trim() !== "" && !phoneOk;
  const noApproval = !!invite && !invite.requires_approval;

  /**
   * Turns public sharing on and makes sure there's a live participant link
   * (new ones require approval). Idempotent: repeated taps share one run, and
   * a link created concurrently elsewhere (unique index → 23505) is reused.
   */
  const doPrepare = async (): Promise<Links> => {
    let shared = trip.is_shared;
    if (!shared) {
      const { data, error } = await supabase.from("trips").update({ is_shared: true }).eq("id", trip.id).select("id");
      if (error || !(data as unknown[] | null)?.length) throw error ?? new Error("share not updated");
      shared = true;
      setTrip((prev) => (prev ? { ...prev, is_shared: true } : prev));
      toast.success("דף הטיול נפתח לצפייה בקישור");
    }
    let link = invite;
    if (!link) {
      const { data: created, error } = await supabase
        .from("trip_invites")
        .insert({ trip_id: trip.id, role: "participant", requires_approval: true })
        .select()
        .single();
      if (!error) {
        link = created as TripInvite;
      } else if ((error as { code?: string }).code === "23505") {
        // Someone (another tab, the members screen) created the live link a moment ago.
        link = (await liveParticipantInvite(trip.id)).invite;
        if (link && !link.requires_approval) {
          setInvite(link);
          throw new ApprovalNotRequired();
        }
      } else {
        console.error(error);
      }
      if (link) setInvite(link);
      else toast.error("קישור ההצטרפות לא נוצר — נשלח רק את דף הטיול.");
    }
    return {
      shareUrl: shared && trip.share_slug ? `${window.location.origin}/share/${trip.share_slug}` : "",
      joinUrl: link ? `${window.location.origin}/join/${link.token}` : null,
    };
  };

  const prepareLinks = (): Promise<Links> => {
    if (!preparing.current) {
      preparing.current = doPrepare().then(
        (links) => {
          if (!links.joinUrl) preparing.current = null; // the next tap tries the join link again
          return links;
        },
        (e: unknown) => {
          preparing.current = null; // a failed run may be retried
          throw e;
        },
      );
    }
    return preparing.current;
  };

  const prepareError = (e: unknown) => {
    if (e instanceof ApprovalNotRequired) {
      toast.error("קישור ההצטרפות הקיים לא דורש אישור. בדקו את האזהרה לפני השליחה.");
    } else {
      console.error(e);
      toast.error("לא הצלחנו להכין את הקישורים. נסו שוב.");
    }
  };

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

  const sendWhatsApp = async () => {
    if (busy) return;
    // Opened synchronously inside the tap so the popup isn't blocked; filled in once the links exist.
    const w = window.open("about:blank", "_blank");
    if (w) w.opener = null;
    setBusy(true);
    try {
      const url = waMeUrl(clientPhone, buildMessage(await prepareLinks()));
      if (w) w.location.href = url;
      else window.location.href = url;
      void saveClient();
    } catch (e) {
      w?.close();
      prepareError(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (busy) return;
    setBusy(true);
    const progress = { linksReady: false };
    const text = prepareLinks().then((links) => {
      progress.linksReady = true;
      return buildMessage(links);
    });
    try {
      try {
        // A promised ClipboardItem keeps the tap's permission while the links are created (Safari).
        if (typeof ClipboardItem === "undefined" || !navigator.clipboard.write) throw new Error("no ClipboardItem");
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) }),
        ]);
      } catch {
        await navigator.clipboard.writeText(await text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("ההודעה הועתקה");
      void saveClient();
    } catch (e) {
      if (progress.linksReady) toast.error("לא ניתן להעתיק. סמנו והעתיקו ידנית.");
      else prepareError(e);
    } finally {
      setBusy(false);
    }
  };

  /** Owner-only (RLS "owner invites"): make the live link require approval again. */
  const requireApproval = async () => {
    if (!invite || approvalBusy) return;
    setApprovalBusy(true);
    const { data, error } = await supabase
      .from("trip_invites")
      .update({ requires_approval: true })
      .eq("id", invite.id)
      .select()
      .maybeSingle();
    setApprovalBusy(false);
    if (error || !data) {
      if (error) console.error(error);
      toast.error("העדכון נכשל. נסו שוב.");
      return;
    }
    setInvite(data as TripInvite);
    toast.success("כל מצטרף חדש יחכה לאישור שלכם");
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
            {preview}
          </p>
          {trip.is_shared ? (
            <p className="type-footnote mt-1.5 px-4 text-muted-foreground">
              דף הטיול פתוח לצפייה למי שיש לו את הקישור, בלי מספרי הזמנה ובלי מסמכים.
            </p>
          ) : (
            <p className="type-footnote mt-1.5 px-4 font-semibold">
              דף הטיול ייפתח לכל מי שיש לו את הקישור — ברגע שתשלחו או תעתיקו את ההודעה. בלי מספרי הזמנה ובלי מסמכים.
            </p>
          )}
          {(!invite || invite.requires_approval) && (
            <p className="type-footnote mt-1.5 px-4 text-muted-foreground">
              {invite
                ? "מי שמצטרף בקישור ההצטרפות מחכה לאישור שלכם."
                : "קישור ההצטרפות ייווצר בשליחה, ומי שיצטרף בו יחכה לאישור שלכם."}
            </p>
          )}
          {noApproval && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-card px-4 py-3">
              <p className="type-footnote flex items-start gap-2 text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                כל מי שיקבל את הקישור יצטרף מיד בלי אישור שלכם.
              </p>
              <Button variant="outline" className="w-full" loading={approvalBusy} onClick={requireApproval}>
                דרישת אישור
              </Button>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" onClick={sendWhatsApp} loading={busy} disabled={busy}>
            {!busy && <MessageCircle className="size-5" />}
            שליחה בוואטסאפ
          </Button>
          <Button size="lg" variant="soft" className="w-full" onClick={copy} disabled={busy}>
            {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
            העתקת ההודעה
          </Button>
        </div>

        <GroupedList>
          {trip.is_shared && realShareUrl && (
            <a href={realShareUrl} target="_blank" rel="noopener noreferrer" className={actionRow}>
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
