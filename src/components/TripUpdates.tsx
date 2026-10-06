import { useEffect, useState } from "react";
import { AlertTriangle, Info, Megaphone, Pin, Plus, Siren, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { TripRole, TripUpdate } from "@/lib/types";
import { useAuth } from "@/hooks/use-auth";
import { can } from "@/lib/permissions";
import { Button, Chip, Field, Input, Modal, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

const KINDS = [
  { value: "info", label: "מידע", icon: Info, cls: "bg-primary-soft text-secondary-foreground" },
  { value: "warning", label: "לתשומת לב", icon: AlertTriangle, cls: "bg-[var(--sun)] text-[var(--sun-foreground)]" },
  { value: "urgent", label: "דחוף", icon: Siren, cls: "bg-accent-soft text-accent" },
] as const;

const RECENT_UPDATES = 3;

function kindMeta(kind: string) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[0];
}

/**
 * Announcements for a trip — schedule changes, gate updates, "meet at 8".
 * Read-only viewers (shared link) see them too, which is the point for agents.
 */
export function TripUpdates({
  tripId,
  role,
  editable = true,
  preloaded,
  className = "mt-4",
}: {
  tripId: string;
  /** Caller's role: participants post and manage their own; editors manage all. */
  role?: TripRole;
  editable?: boolean;
  /** Already-fetched updates (the share page gets them from get_shared_trip) — skips the query. */
  preloaded?: Omit<TripUpdate, "trip_id">[];
  className?: string;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const canPost = editable && (role === undefined || can(role, "participate"));
  const canManage = (u: Omit<TripUpdate, "trip_id">) =>
    editable && (role === undefined || can(role, "edit") || (can(role, "participate") && u.created_by === user?.id));
  const [updates, setUpdates] = useState<Omit<TripUpdate, "trip_id">[]>(preloaded ?? []);
  const [loading, setLoading] = useState(!preloaded);
  const [draft, setDraft] = useState<{ title: string; body: string; kind: string; is_pinned: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Pinned updates always show; of the rest (newest first), only the latest few
  // until expanded — a group trip piles up dozens and buries the whole screen.
  const recentIds = new Set(updates.filter((u) => !u.is_pinned).slice(0, RECENT_UPDATES).map((u) => u.id));
  const visible = showAll ? updates : updates.filter((u) => u.is_pinned || recentIds.has(u.id));
  const hiddenCount = updates.length - visible.length;

  const load = async () => {
    const { data } = await supabase
      .from("trip_updates")
      .select("*")
      .eq("trip_id", tripId)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });
    setUpdates((data as TripUpdate[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (preloaded) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const save = async () => {
    if (!draft?.title.trim()) {
      toast.error("צריך כותרת");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("trip_updates").insert({
      trip_id: tripId,
      title: draft.title.trim(),
      body: draft.body.trim() || null,
      kind: draft.kind,
      is_pinned: draft.is_pinned,
    });
    setSaving(false);
    if (error) {
      toast.error("השמירה נכשלה. ודא שהרצת את מיגרציה 002.");
      return;
    }
    setDraft(null);
    toast.success("העדכון נוסף 📣");
    load();
  };

  const remove = async (id: string) => {
    setUpdates((u) => u.filter((x) => x.id !== id));
    await supabase.from("trip_updates").delete().eq("id", id);
  };

  const togglePin = async (u: Omit<TripUpdate, "trip_id">) => {
    await supabase.from("trip_updates").update({ is_pinned: !u.is_pinned }).eq("id", u.id);
    load();
  };

  if (loading) return null;
  if (!canPost && updates.length === 0) return null;

  return (
    <section className={className}>
      <div className="mb-1.5 flex min-h-11 items-center justify-between gap-2 ps-4">
        <h2 className="type-footnote flex items-center gap-1.5 font-semibold text-muted-foreground">
          <Megaphone className="size-4 text-accent" />
          עדכונים חשובים
        </h2>
        {canPost && (
          <button
            type="button"
            onClick={() => setDraft({ title: "", body: "", kind: "info", is_pinned: false })}
            aria-label="הוספת עדכון"
            className="grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          >
            <Plus className="size-5" />
          </button>
        )}
      </div>

      <div className="divide-y divide-separator overflow-hidden rounded-2xl bg-card text-card-foreground">
        {updates.length === 0 ? (
          <p className="type-footnote px-4 py-3 text-muted-foreground">
            אין עדכונים. הוסף הודעה חשובה שכולם צריכים לראות.
          </p>
        ) : (
          <>
            {visible.map((u) => {
              const meta = kindMeta(u.kind);
              const Icon = meta.icon;
              return (
                <div key={u.id} className="flex items-start gap-3 py-3 ps-4 pe-2">
                  <div className={cn("grid size-9 shrink-0 place-items-center rounded-full", meta.cls)}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* items-start: the pin stays on the title's first line when it wraps. */}
                    <div className="flex items-start gap-1.5">
                      {u.is_pinned && <Pin className="mt-1 size-3.5 shrink-0 fill-current text-accent" role="img" aria-label="נעוץ" />}
                      <span className="type-headline min-w-0 [overflow-wrap:anywhere]">{u.title}</span>
                    </div>
                    {u.body && (
                      <p className="type-footnote mt-0.5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                        {u.body}
                      </p>
                    )}
                  </div>
                  {canManage(u) && (
                    <div className="flex shrink-0 flex-col">
                      <button
                        onClick={() => togglePin(u)}
                        className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                        aria-label={u.is_pinned ? "ביטול נעיצה" : "נעיצה"}
                      >
                        <Pin className={cn("size-4", u.is_pinned && "fill-current text-accent")} />
                      </button>
                      <button
                        onClick={() => remove(u.id)}
                        className="grid size-9 place-items-center rounded-full text-destructive transition-colors active:bg-destructive/10"
                        aria-label="מחיקה"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="type-headline w-full px-4 py-3 text-start text-primary transition-colors active:bg-muted/70"
              >
                הצגת כל {updates.length} העדכונים
              </button>
            )}
          </>
        )}
      </div>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title="עדכון חדש"
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setDraft(null)}>
              ביטול
            </Button>
            <Button className="flex-1" loading={saving} onClick={save}>
              פרסום
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <Chip key={k.value} active={draft.kind === k.value} onClick={() => setDraft({ ...draft, kind: k.value })}>
                  {k.label}
                </Chip>
              ))}
            </div>
            <Field label="כותרת">
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="למשל: שינוי שעת המפגש"
              />
            </Field>
            <Field label="פרטים">
              <Textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="מה חשוב שכולם ידעו?"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.is_pinned}
                onChange={(e) => setDraft({ ...draft, is_pinned: e.target.checked })}
                className="size-4"
              />
              להצמיד למעלה
            </label>
          </div>
        )}
      </Modal>
    </section>
  );
}
