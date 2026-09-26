import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, LogOut, MessageCircle, UserMinus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { MemberRole, Trip, TripInvite, TripMember, TripRole } from "@/lib/types";
import { ROLE_HINTS, ROLE_LABELS } from "@/lib/permissions";
import { Badge, Button, Segmented, Spinner } from "@/components/ui";

const MEMBER_ROLES: MemberRole[] = ["viewer", "participant", "editor"];

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
    if (!invite) return;
    const { error } = await supabase
      .from("trip_invites")
      .update({ requires_approval: !invite.requires_approval })
      .eq("id", invite.id);
    if (error) toast.error("העדכון נכשל");
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
    const { error } = await supabase.from("trip_members").delete().eq("id", m.id);
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

  return (
    <div className="flex flex-col gap-4">
      {isOwner && isAnonymous && (
        <p className="rounded-2xl bg-muted p-3 text-sm text-muted-foreground">
          בעותק דמו אי אפשר להזמין אנשים. אחרי הרשמה תוכלו לשתף טיולים עם המשפחה או הלקוחות.
        </p>
      )}

      {isOwner && !isAnonymous && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-3">
          <div className="font-semibold">הזמנת אנשים</div>
          <Segmented
            value={inviteRole}
            onChange={setInviteRole}
            options={MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
          <p className="text-xs text-muted-foreground">{ROLE_HINTS[inviteRole]}</p>

          {invite ? (
            <>
              <div dir="ltr" className="overflow-x-auto rounded-2xl bg-muted px-3 py-2.5 font-mono text-xs">
                {inviteUrl}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={copy}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  העתקה
                </Button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-border text-[15px] font-semibold"
                >
                  <MessageCircle className="size-4" />
                  וואטסאפ
                </a>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={invite.requires_approval} onChange={toggleApproval} className="size-4" />
                כל מצטרף חדש צריך את האישור שלי
              </label>
              <Button variant="ghost" size="sm" className="text-destructive" loading={busy} onClick={revokeInvite}>
                ביטול הקישור
              </Button>
            </>
          ) : (
            <Button loading={busy} onClick={createInvite}>
              יצירת קישור הזמנה ל{ROLE_LABELS[inviteRole]}
            </Button>
          )}
        </div>
      )}

      {isOwner && pending.length > 0 && (
        <div>
          <div className="mb-2 font-semibold">ממתינים לאישור</div>
          <div className="flex flex-col gap-2">
            {pending.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-2xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.display_name || "משתמש"}</div>
                  <div className="text-xs text-muted-foreground">מבקש להצטרף כ{ROLE_LABELS[m.role]}</div>
                </div>
                <Button size="sm" onClick={() => updateMember(m, { status: "active" }, "אושר ✓")} aria-label="אישור">
                  <Check className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => removeMember(m, "הבקשה נדחתה")} aria-label="דחייה">
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 font-semibold">חברי הטיול</div>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isOwner ? "עדיין אין חברים. שלחו קישור הזמנה כדי שהמשפחה או הלקוח יראו את כל הטיול." : "רק אתה ובעל הטיול."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {active.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-2xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {m.display_name || "משתמש"}
                    {m.user_id === user?.id && " (את/ה)"}
                  </div>
                </div>
                {isOwner ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => updateMember(m, { role: e.target.value as MemberRole }, "התפקיד עודכן")}
                      className="h-9 rounded-xl border border-input bg-card px-2 text-sm"
                      aria-label="תפקיד"
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeMember(m, "הוסר מהטיול")}
                      className="grid size-9 place-items-center text-destructive"
                      aria-label="הסרה מהטיול"
                    >
                      <UserMinus className="size-4" />
                    </button>
                  </>
                ) : (
                  <Badge tone="muted">{ROLE_LABELS[m.role]}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!isOwner && (
        <Button variant="ghost" className="text-destructive" onClick={leave}>
          <LogOut className="size-4" />
          עזיבת הטיול
        </Button>
      )}
    </div>
  );
}
