import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Link2, Link2Off, LogOut, MessageCircle, UserMinus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { MemberRole, Trip, TripInvite, TripMember, TripRole } from "@/lib/types";
import { ROLE_HINTS, ROLE_LABELS } from "@/lib/permissions";
import { InsetGroup, Segmented, Spinner, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";

const MEMBER_ROLES: MemberRole[] = ["viewer", "participant", "editor"];

/** A tappable row inside an InsetGroup. */
function ActionRow({
  icon,
  label,
  onClick,
  href,
  destructive,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const cls = cn(
    "type-headline flex min-h-12 w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-foreground/5 disabled:opacity-60",
    destructive ? "text-destructive" : "text-primary",
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {icon}
      {label}
    </a>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {label}
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary">
      {Array.from(name.trim())[0] ?? "?"}
    </div>
  );
}

/**
 * People on a trip (migration 015). The owner creates one invite link per
 * role, approves joiners, changes roles and removes people; everyone else
 * sees who's on the trip and can leave. The database enforces all of it —
 * this only shows the controls that will work.
 */
export function TripMembers({ trip, role }: { trip: Trip; role: TripRole }) {
  const { user, isAnonymous } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const isOwner = role === "owner";
  const [members, setMembers] = useState<TripMember[]>([]);
  const [invites, setInvites] = useState<TripInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteRole, setInviteRole] = useState<MemberRole>("participant");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const [{ data: m }, { data: i }] = await Promise.all([
      supabase.from("trip_members").select("*").eq("trip_id", trip.id).order("created_at"),
      isOwner
        ? supabase.from("trip_invites").select("*").eq("trip_id", trip.id).is("revoked_at", null)
        : Promise.resolve({ data: [] }),
    ]);
    setMembers((m as TripMember[]) ?? []);
    setInvites((i as TripInvite[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const invite = invites.find((i) => i.role === inviteRole);
  const inviteUrl = invite ? `${window.location.origin}/join/${invite.token}` : "";

  const createInvite = async () => {
    setBusy(true);
    const { error } = await supabase.from("trip_invites").insert({ trip_id: trip.id, role: inviteRole });
    setBusy(false);
    if (error) {
      toast.error("לא הצלחנו ליצור קישור הזמנה");
      return;
    }
    toast.success("קישור ההזמנה נוצר 🔗");
    load();
  };

  const revokeInvite = async () => {
    if (!invite) return;
    setBusy(true);
    const { error } = await supabase.from("trip_invites").update({ revoked_at: new Date().toISOString() }).eq("id", invite.id);
    setBusy(false);
    if (error) {
      toast.error("לא הצלחנו לבטל את הקישור");
      return;
    }
    toast.success("הקישור בוטל. מי שכבר הצטרף נשאר בטיול.");
    load();
  };

  const toggleApproval = async () => {
    if (!invite || busy) return;
    setBusy(true);
    const { error } = await supabase
      .from("trip_invites")
      .update({ requires_approval: !invite.requires_approval })
      .eq("id", invite.id);
    setBusy(false);
    if (error) {
      toast.error("העדכון נכשל");
      return;
    }
    toast.success(invite.requires_approval ? "מצטרפים חדשים ייכנסו מיד" : "כל מצטרף חדש יחכה לאישור שלך");
    load();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("הקישור הועתק");
    } catch {
      toast.error("לא ניתן להעתיק. סמן והעתק ידנית.");
    }
  };

  const whatsappText = `הוזמנת לטיול "${trip.title}" ב-TripCraft (${ROLE_LABELS[inviteRole]}): ${inviteUrl}`;

  const updateMember = async (m: TripMember, patch: Partial<Pick<TripMember, "role" | "status">>, done: string) => {
    const { error } = await supabase.from("trip_members").update(patch).eq("id", m.id);
    if (error) {
      toast.error("העדכון נכשל");
      return;
    }
    toast.success(done);
    load();
  };

  const removeMember = async (m: TripMember, done: string) => {
    // Kept as 'removed' rather than deleted, so a still-live invite link can't
    // bring them straight back (accept_trip_invite returns an existing row as is).
    const { error } = await supabase.from("trip_members").update({ status: "removed" }).eq("id", m.id);
    if (error) {
      toast.error("ההסרה נכשלה");
      return;
    }
    toast.success(done);
    load();
  };

  const leave = async () => {
    const mine = members.find((m) => m.user_id === user?.id);
    if (!mine) return;
    const { error } = await supabase.from("trip_members").delete().eq("id", mine.id);
    if (error) {
      toast.error("העזיבה נכשלה");
      return;
    }
    toast.success("עזבת את הטיול");
    navigate("/", { replace: true });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");
  const sectionTitle = "type-footnote mb-1.5 px-4 font-semibold text-muted-foreground";

  return (
    <div className="flex flex-col gap-5">
      {isOwner && isAnonymous && (
        <p className="type-footnote rounded-2xl bg-muted p-4 text-muted-foreground">
          בעותק דמו אי אפשר להזמין אנשים. אחרי הרשמה תוכלו לשתף טיולים עם המשפחה או הלקוחות.
        </p>
      )}

      {isOwner && !isAnonymous && (
        <section>
          <h3 className={sectionTitle}>הזמנת אנשים</h3>
          <Segmented
            value={inviteRole}
            onChange={setInviteRole}
            options={MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
          <p className="type-footnote mb-2 mt-1.5 px-4 text-muted-foreground">{ROLE_HINTS[inviteRole]}</p>

          {invite ? (
            <InsetGroup>
              <div dir="ltr" className="overflow-x-auto whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                {inviteUrl}
              </div>
              <ActionRow
                icon={copied ? <Check className="size-5" /> : <Copy className="size-5" />}
                label="העתקת הקישור"
                onClick={copy}
              />
              <ActionRow
                icon={<MessageCircle className="size-5" />}
                label="שליחה בוואטסאפ"
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
              />
              <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                <span className="type-body min-w-0 flex-1">כל מצטרף חדש צריך את האישור שלי</span>
                <Switch
                  checked={invite.requires_approval}
                  onChange={toggleApproval}
                  label="כל מצטרף חדש צריך את האישור שלי"
                  disabled={busy}
                />
              </div>
              <ActionRow
                icon={<Link2Off className="size-5" />}
                label="ביטול הקישור"
                destructive
                disabled={busy}
                onClick={revokeInvite}
              />
            </InsetGroup>
          ) : (
            <InsetGroup>
              <ActionRow
                icon={busy ? <Spinner className="size-5" /> : <Link2 className="size-5" />}
                label={`יצירת קישור הזמנה ל${ROLE_LABELS[inviteRole]}`}
                disabled={busy}
                onClick={createInvite}
              />
            </InsetGroup>
          )}
        </section>
      )}

      {isOwner && pending.length > 0 && (
        <section>
          <h3 className={sectionTitle}>ממתינים לאישור ({pending.length})</h3>
          <InsetGroup>
            {pending.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2 ps-4 pe-2">
                <Avatar name={m.display_name || "משתמש"} />
                <div className="min-w-0 flex-1">
                  <div className="type-headline truncate [unicode-bidi:plaintext]">{m.display_name || "משתמש"}</div>
                  <div className="type-footnote text-muted-foreground">מבקש להצטרף כ{ROLE_LABELS[m.role]}</div>
                </div>
                <button
                  type="button"
                  onClick={() => updateMember(m, { status: "active" }, "אושר ✓")}
                  aria-label={`אישור ${m.display_name || "משתמש"}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
                >
                  <Check className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeMember(m, "הבקשה נדחתה")}
                  aria-label={`דחיית ${m.display_name || "משתמש"}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-foreground/5"
                >
                  <X className="size-5" />
                </button>
              </div>
            ))}
          </InsetGroup>
        </section>
      )}

      <section>
        <h3 className={sectionTitle}>חברי הטיול{active.length > 0 ? ` (${active.length})` : ""}</h3>
        {active.length === 0 ? (
          <p className="type-footnote rounded-2xl bg-muted p-4 text-muted-foreground">
            {isOwner ? "עדיין אין חברים. שלחו קישור הזמנה כדי שהמשפחה או הלקוח יראו את כל הטיול." : "רק אתה ובעל הטיול."}
          </p>
        ) : (
          <InsetGroup>
            {active.map((m) => (
              <div key={m.id} className="flex min-h-14 items-center gap-3 py-2 ps-4 pe-2">
                <Avatar name={m.display_name || "משתמש"} />
                <div className="type-headline min-w-0 flex-1 truncate [unicode-bidi:plaintext]">
                  {m.display_name || "משתמש"}
                  {m.user_id === user?.id && <span className="text-muted-foreground"> (את/ה)</span>}
                </div>
                {isOwner ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => updateMember(m, { role: e.target.value as MemberRole }, "התפקיד עודכן")}
                      className="type-footnote h-11 shrink-0 rounded-xl border border-input bg-card px-2"
                      aria-label={`התפקיד של ${m.display_name || "משתמש"}`}
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMember(m, "הוסר מהטיול")}
                      className="grid size-11 shrink-0 place-items-center rounded-full text-destructive transition-colors active:bg-foreground/5"
                      aria-label={`הסרת ${m.display_name || "משתמש"} מהטיול`}
                    >
                      <UserMinus className="size-5" />
                    </button>
                  </>
                ) : (
                  <span className="type-footnote shrink-0 pe-2 text-muted-foreground">{ROLE_LABELS[m.role]}</span>
                )}
              </div>
            ))}
          </InsetGroup>
        )}
      </section>

      {!isOwner && (
        <InsetGroup>
          <ActionRow icon={<LogOut className="size-5" />} label="עזיבת הטיול" destructive onClick={leave} />
        </InsetGroup>
      )}
    </div>
  );
}
