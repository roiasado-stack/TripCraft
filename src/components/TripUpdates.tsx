import { useEffect, useState } from "react";
import { AlertTriangle, Info, Megaphone, Pin, Plus, Siren, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { TripUpdate } from "@/lib/types";
import { Button, Card, Chip, Field, Input, Modal, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

const KINDS = [
  { value: "info", label: "מידע", icon: Info, cls: "bg-primary-soft text-secondary-foreground" },
  { value: "warning", label: "לתשומת לב", icon: AlertTriangle, cls: "bg-[var(--sun)] text-[var(--sun-foreground)]" },
  { value: "urgent", label: "דחוף", icon: Siren, cls: "bg-accent-soft text-accent" },
] as const;

function kindMeta(kind: string) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[0];
}

/**
 * Announcements for a trip — schedule changes, gate updates, "meet at 8".
 * Read-only viewers (shared link) see them too, which is the point for agents.
 */
export function TripUpdates({ tripId, editable = true }: { tripId: string; editable?: boolean }) {
  const toast = useToast();
  const [updates, setUpdates] = useState<TripUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{ title: string; body: string; kind: string; is_pinned: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

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

  const togglePin = async (u: TripUpdate) => {
    await supabase.from("trip_updates").update({ is_pinned: !u.is_pinned }).eq("id", u.id);
    load();
  };

  if (loading) return null;
  if (!editable && updates.length === 0) return null;

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-bold">
          <Megaphone className="size-4 text-accent" />
          עדכונים חשובים
        </h3>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft({ title: "", body: "", kind: "info", is_pinned: false })}
            aria-label="הוספת עדכון"
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>

      {updates.length === 0 ? (
        <Card className="p-3 text-center text-xs text-muted-foreground">
          אין עדכונים. הוסף הודעה חשובה שכולם צריכים לראות.
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {updates.map((u) => {
            const meta = kindMeta(u.kind);
            const Icon = meta.icon;
            return (
              <Card key={u.id} className={cn("flex items-start gap-3 p-3", u.is_pinned && "border-accent")}>
                <div className={cn("grid size-9 shrink-0 place-items-center rounded-xl", meta.cls)}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {u.is_pinned && <Pin className="size-3 shrink-0 text-accent" />}
                    <span className="font-semibold">{u.title}</span>
                  </div>
                  {u.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{u.body}</p>}
                </div>
                {editable && (
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button onClick={() => togglePin(u)} className="text-muted-foreground" aria-label="נעיצה">
                      <Pin className={cn("size-4", u.is_pinned && "fill-current text-accent")} />
                    </button>
                    <button onClick={() => remove(u.id)} className="text-destructive" aria-label="מחיקה">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

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
