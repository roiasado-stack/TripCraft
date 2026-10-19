import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, Link2Off, MessageCircle, UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Trip, TripClient, TripInvite, TripMember, TripRole } from "@/lib/types";
import { can } from "@/lib/permissions";
import { Button, EmptyState, FullSpinner, GroupedList, Spinner } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { clientMessage, normalizePhone, waMeUrl } from "@/lib/whatsapp";
import { isValidEmail, normalizeEmail, sameLeadEmail } from "@/lib/client-email";
import { dateRangeHeb } from "@/lib/trip-dates";

/** Shown in the preview until the links exist (they're created on send, never on open). */
const SHARE_PLACEHOLDER = "[קישור לדף הטיול]";
const JOIN_PLACEHOLDER = "[קישור הצטרפות]";

type Links = { shareUrl: string; joinUrl: string | null };

/** Thrown when the typed client email can't lock a link. */
class InvalidEmail extends Error {}

/** The trip's live personal link for the client (one per trip, migration 024), if there is one. */
async function liveLeadInvite(tripId: string): Promise<{ invite: TripInvite | null; error: boolean }> {
  const { data, error } = await supabase
    .from("trip_invites")
    .select("*")
    .eq("trip_id", tripId)
    .eq("grants_lead", true)
    .is("revoked_at", null)
    .limit(1);
  if (error) console.error(error);
  return { invite: ((data as TripInvite[] | null) ?? [])[0] ?? null, error: !!error };
}

/** The trip's lead client, waiting or in (at most one, migration 024). */
async function currentLead(tripId: string): Promise<{ lead: TripMember | null; error: boolean }> {
  const { data, error } = await supabase
    .from("trip_members")
    .select("*")
    .eq("trip_id", tripId)
    .eq("is_lead", true)
    .in("status", ["pending", "active"])
    .limit(1);
  if (error) console.error(error);
  return { lead: ((data as TripMember[] | null) ?? [])[0] ?? null, error: !!error };
}

/**
 * Step 3 of "new trip from documents", also reachable from inside a trip:
 * the trip's public page (share_slug, migration 013/016) and the client's
 * personal join link (migration 024) in one WhatsApp message — sent from the
 * agent's own phone through wa.me, or copied. Owner only.
 *
 * The personal link is single use and makes the client the trip's lead, who
 * invites the family from the app; the agent approves nobody. With the
 * client's email it opens only for that account; without one, the agent
 * approves that one person (here or in the members screen).
 *
 * Opening this page changes nothing. Sharing is turned on and the link is
 * created only when the agent taps send or copy (see prepareLinks).
 */
export function AgentSendPanel({
  tripId,
  embedded = false,
  onTripChange,
}: {
  tripId: string | undefined;
  /** In the agency trip screen's side column: no page chrome, no trip card, no "to the trip" rows. */
  embedded?: boolean;
  /** Called after this panel changes the trip row (sharing turned on). */
  onTripChange?: () => void;
}) {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const toast = useToast();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [invite, setInvite] = useState<TripInvite | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [lead, setLead] = useState<TripMember | null>(null);
  const saved = useRef<{ name: string; phone: string; email: string; exists: boolean }>({
    name: "",
    phone: "",
    email: "",
    exists: false,
  });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
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
      // Read only: the live personal link and the lead, if any. Nothing is created here.
      const [{ invite: live, error: inviteError }, { lead: current, error: leadError }] = await Promise.all([
        liveLeadInvite(tripId),
        currentLead(tripId),
      ]);
      if (cancelled) return;
      if (inviteError || leadError) {
        setState("error");
        return;
      }
      setRequestedAgency((account as { agency_name: string } | null)?.agency_name ?? null);
      const c = client as TripClient | null;
      setClientName(c?.client_name ?? "");
      setClientPhone(c?.client_phone ?? "");
      setClientEmail(c?.client_email ?? "");
      saved.current = {
        name: c?.client_name ?? "",
        phone: c?.client_phone ?? "",
        email: c?.client_email ?? "",
        exists: !!c,
      };
      preparing.current = null;
      setInvite(live);
      setLead(current);
      setTrip(t as Trip);
      setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, userId]);

  if (state === "loading")
    return embedded ? (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    ) : (
      <FullSpinner label="רגע, טוענים…" />
    );
  if (state !== "ready" || !trip)
    return (
      <div className={embedded ? "py-6" : "mx-auto max-w-lg px-4 pt-16"}>
        <EmptyState
          emoji="🧭"
          title={state === "forbidden" ? "אין גישה לטיול הזה" : "משהו השתבש"}
          description={state === "forbidden" ? "רק מי שיצר את הטיול יכול לשלוח אותו ללקוח." : "נסו לרענן את הדף."}
          action={embedded ? undefined : <Button onClick={() => navigate("/agency")}>לסביבת הסוכן</Button>}
        />
      </div>
    );

  const realShareUrl = trip.share_slug ? `${window.location.origin}/share/${trip.share_slug}` : "";
  const emailNow = normalizeEmail(clientEmail);
  const emailInvalid = !!emailNow && !isValidEmail(emailNow);
  // A live link made for another address is replaced on the next send.
  const usableInvite = invite && sameLeadEmail(invite.lead_email, emailNow) ? invite : null;
  // Once the client is the lead (or waiting), the message goes without a join link.
  const realJoinUrl = lead ? null : usableInvite ? `${window.location.origin}/join/${usableInvite.token}` : null;
  const buildMessage = (links: Links) =>
    clientMessage({
      clientName,
      destination: trip.destination,
      shareUrl: links.shareUrl,
      joinUrl: links.joinUrl,
      // The admin-approved name, as on the brochure (023).
      agencyName: requestedAgency?.trim() || profile?.agency_name?.trim() || null,
    });
  // The preview never shows a link that doesn't work yet.
  const preview = buildMessage({
    shareUrl: trip.is_shared && realShareUrl ? realShareUrl : SHARE_PLACEHOLDER,
    joinUrl: lead ? null : (realJoinUrl ?? JOIN_PLACEHOLDER),
  });
  const phoneOk = !!normalizePhone(clientPhone);
  const phoneInvalid = clientPhone.trim() !== "" && !phoneOk;

  /**
   * Turns public sharing on and makes sure there's a live personal link for
   * the email typed now (none once the client is the lead). Idempotent:
   * repeated taps share one run, and a link created concurrently elsewhere
   * (unique index → 23505) is reused when it was made for the same email.
   */
  const doPrepare = async (): Promise<Links> => {
    if (emailInvalid) throw new InvalidEmail();
    let shared = trip.is_shared;
    if (!shared) {
      const { data, error } = await supabase.from("trips").update({ is_shared: true }).eq("id", trip.id).select("id");
      if (error || !(data as unknown[] | null)?.length) throw error ?? new Error("share not updated");
      shared = true;
      setTrip((prev) => (prev ? { ...prev, is_shared: true } : prev));
      onTripChange?.();
      toast.success("דף הטיול נפתח לצפייה בקישור");
    }
    const shareUrl = shared && trip.share_slug ? `${window.location.origin}/share/${trip.share_slug}` : "";
    if (lead) return { shareUrl, joinUrl: null };

    let link = usableInvite;
    if (!link && invite) {
      // Made for a different email: retire it so only the new address can use a link.
      const { error } = await supabase.from("trip_invites").update({ revoked_at: new Date().toISOString() }).eq("id", invite.id);
      if (error) throw error;
      setInvite(null);
    }
    if (!link) {
      const { data: created, error } = await supabase
        .from("trip_invites")
        .insert({ trip_id: trip.id, role: "participant", requires_approval: false, grants_lead: true, lead_email: emailNow })
        .select()
        .single();
      if (!error) {
        link = created as TripInvite;
      } else if ((error as { code?: string }).code === "23505") {
        // Another tab created the personal link a moment ago; use it only if it's for this email.
        const live = (await liveLeadInvite(trip.id)).invite;
        if (live && sameLeadEmail(live.lead_email, emailNow)) link = live;
        else console.error(error);
      } else {
        console.error(error);
      }
      if (link) setInvite(link);
      else toast.error("הקישור האישי לא נוצר — נשלח רק את דף הטיול.");
    }
    return { shareUrl, joinUrl: link ? `${window.location.origin}/join/${link.token}` : null };
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
    if (e instanceof InvalidEmail) {
      toast.error("המייל של הלקוח לא נראה תקין. תקנו אותו או השאירו ריק.");
    } else {
      console.error(e);
      toast.error("לא הצלחנו להכין את הקישורים. נסו שוב.");
    }
  };

  /** Keeps the client's details if the agent changed them here. Best effort, after the send. */
  const saveClient = async () => {
    const name = clientName.trim();
    const phone = clientPhone.trim();
    const email = emailNow ?? "";
    if (
      name === saved.current.name.trim() &&
      phone === saved.current.phone.trim() &&
      email === (normalizeEmail(saved.current.email) ?? "")
    )
      return;
    if (!name && !phone && !email && !saved.current.exists) return;
    const { error } = await supabase
      .from("trip_clients")
      .upsert({ trip_id: trip.id, client_name: name || null, client_phone: phone || null, client_email: email || null });
    if (error) {
      toast.error("פרטי הלקוח לא נשמרו");
      return;
    }
    saved.current = { name, phone, email, exists: true };
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

  /** Owner-only (RLS "owner invites"): the sent personal link stops working; the next send makes a new one. */
  const retireLink = async () => {
    if (!invite || linkBusy) return;
    setLinkBusy(true);
    const { error } = await supabase.from("trip_invites").update({ revoked_at: new Date().toISOString() }).eq("id", invite.id);
    setLinkBusy(false);
    if (error) {
      console.error(error);
      toast.error("הביטול נכשל. נסו שוב.");
      return;
    }
    preparing.current = null;
    setInvite(null);
    toast.success("הקישור הקודם בוטל. בשליחה הבאה ייווצר קישור אישי חדש.");
  };

  /** Owner (RLS "owner manages"): let the waiting lead in. One approval per trip. */
  const approveLead = async () => {
    if (!lead || linkBusy) return;
    setLinkBusy(true);
    const { data, error } = await supabase
      .from("trip_members")
      .update({ status: "active" })
      .eq("id", lead.id)
      .select()
      .maybeSingle();
    setLinkBusy(false);
    if (error || !data) {
      if (error) console.error(error);
      toast.error("האישור נכשל. נסו שוב.");
      return;
    }
    setLead(data as TripMember);
    toast.success("הלקוח אושר ויכול להזמין את המשפחה");
  };

  const leadName = lead?.display_name?.trim() || "הלקוח";

  const fieldRow = "flex min-h-12 items-center gap-3 px-4";
  const fieldInput = "type-body min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-muted-foreground";
  const actionRow =
    "type-body flex min-h-12 w-full items-center gap-3 px-4 text-start text-primary transition-colors active:bg-muted/70";

  return (
    <div className={embedded ? undefined : "mx-auto max-w-lg px-4 pb-16 pt-4 lg:max-w-2xl lg:px-8 lg:pt-8"}>
      {embedded ? (
        <h2 className="type-title mb-3 px-1">שליחה ללקוח</h2>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={() => navigate(`/agency/trips/${trip.id}`)}
              className="-ms-2 grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
              aria-label="לטיול"
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
        </>
      )}

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
          <label className={fieldRow}>
            <span className="type-body w-20 shrink-0">מייל</span>
            <input
              type="email"
              dir="ltr"
              inputMode="email"
              autoComplete="off"
              value={clientEmail}
              onChange={(e) => {
                setClientEmail(e.target.value);
                preparing.current = null; // a link prepared for another address must not be reused
              }}
              placeholder="client@gmail.com"
              maxLength={254}
              className={`${fieldInput} text-end`}
              aria-invalid={emailInvalid}
            />
          </label>
        </GroupedList>
        {(phoneInvalid || !clientPhone.trim()) && (
          <p className={`type-footnote -mt-4 px-4 ${phoneInvalid ? "text-destructive" : "text-muted-foreground"}`}>
            {phoneInvalid ? "המספר לא נראה תקין — וואטסאפ ישאל למי לשלוח." : "בלי מספר, וואטסאפ ישאל למי לשלוח."}
          </p>
        )}
        {emailInvalid && <p className="type-footnote -mt-4 px-4 text-destructive">המייל לא נראה תקין.</p>}

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
          {lead ? (
            lead.status === "pending" ? (
              <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-card px-4 py-3">
                <p className="type-footnote flex items-start gap-2">
                  <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>
                    <bdi>{leadName}</bdi> נכנס/ה בקישור האישי ומחכה לאישור שלכם. זה האישור היחיד: אחריו הלקוח מזמין את
                    המשפחה בעצמו.
                  </span>
                </p>
                <Button className="w-full" loading={linkBusy} onClick={approveLead}>
                  {!linkBusy && <UserCheck className="size-5" />}
                  אישור הלקוח
                </Button>
              </div>
            ) : (
              <p className="type-footnote mt-1.5 px-4 text-muted-foreground">
                <bdi>{leadName}</bdi> כבר בטיול כלקוח ראשי ומזמין את המשפחה בעצמו, ולכן ההודעה נשלחת בלי קישור הצטרפות.
              </p>
            )
          ) : (
            <p className="type-footnote mt-1.5 px-4 text-muted-foreground">
              {emailNow && !emailInvalid
                ? "הקישור האישי ייפתח רק לחשבון עם המייל הזה. הלקוח נכנס מיד ומזמין את המשפחה בעצמו, בלי אישורים שלכם."
                : "בלי מייל, מי שנכנס בקישור האישי מחכה לאישור אחד שלכם. אחריו הלקוח מזמין את המשפחה בעצמו."}
            </p>
          )}
          {!lead && invite && (
            <button
              type="button"
              onClick={retireLink}
              disabled={linkBusy}
              className="type-footnote mt-1 flex min-h-11 items-center gap-2 px-4 text-destructive disabled:opacity-60"
            >
              <Link2Off className="size-4" aria-hidden />
              ביטול הקישור האישי שכבר נשלח
            </button>
          )}
        </section>

        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" onClick={sendWhatsApp} loading={busy} disabled={busy || emailInvalid}>
            {!busy && <MessageCircle className="size-5" />}
            שליחה בוואטסאפ
          </Button>
          <Button size="lg" variant="soft" className="w-full" onClick={copy} disabled={busy || emailInvalid}>
            {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
            העתקת ההודעה
          </Button>
        </div>

        {(!embedded || (trip.is_shared && realShareUrl)) && (
          <GroupedList>
            {trip.is_shared && realShareUrl && (
              <a href={realShareUrl} target="_blank" rel="noopener noreferrer" className={actionRow}>
                <ExternalLink className="size-5" />
                מה הנוסעים רואים
              </a>
            )}
            {!embedded && (
              <>
                <button type="button" onClick={() => navigate(`/agency/trips/${trip.id}`)} className={actionRow}>
                  <ChevronLeft className="size-5" />
                  לטיול
                </button>
                <button type="button" onClick={() => navigate("/agency")} className={actionRow}>
                  <Check className="size-5" />
                  סיום
                </button>
              </>
            )}
          </GroupedList>
        )}
      </div>
    </div>
  );
}
