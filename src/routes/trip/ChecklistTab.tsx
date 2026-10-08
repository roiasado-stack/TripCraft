import { useEffect, useMemo, useState } from "react";
import { ListPlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ChecklistItem } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { can } from "@/lib/permissions";
import { TripHeader } from "@/components/TripHeader";
import { Button, Checkbox, EmptyState, GroupedList, Segmented, Spinner } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { starterChecklist } from "@/lib/starter";
import { PreflightPanel } from "@/components/PreflightPanel";
import { cn } from "@/lib/utils";

export default function ChecklistTab() {
  const { trip, role, participants } = useTrip();
  const canParticipate = can(role, "participate");
  const toast = useToast();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"shared" | "personal" | "preflight">("shared");
  const [newTitle, setNewTitle] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [owner, setOwner] = useState<string>("");

  const ownerName = (id: string | null) => participants.find((p) => p.id === id)?.name;

  const load = async () => {
    const { data } = await supabase.from("checklist_items").select("*").eq("trip_id", trip.id).order("sort_order").order("created_at");
    setItems((data as ChecklistItem[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const shown = useMemo(
    () => (tab === "preflight" ? [] : items.filter((i) => (tab === "shared" ? i.is_shared : !i.is_shared))),
    [items, tab],
  );
  const doneCount = shown.filter((i) => i.is_done).length;

  const toggle = async (item: ChecklistItem) => {
    setItems((x) => x.map((i) => (i.id === item.id ? { ...i, is_done: !i.is_done } : i)));
    const { error } = await supabase.from("checklist_items").update({ is_done: !item.is_done }).eq("id", item.id);
    if (error) {
      toast.error("העדכון נכשל");
      load();
    }
  };
  const remove = async (item: ChecklistItem) => {
    setItems((x) => x.filter((i) => i.id !== item.id));
    const { error } = await supabase.from("checklist_items").delete().eq("id", item.id);
    if (error) {
      toast.error("המחיקה נכשלה");
      load();
    }
  };
  const add = async () => {
    if (!newTitle.trim()) return;
    const { data, error } = await supabase
      .from("checklist_items")
      .insert({
        trip_id: trip.id,
        title: newTitle.trim(),
        is_shared: tab === "shared",
        participant_id: tab === "personal" && owner ? owner : null,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error("ההוספה נכשלה");
      return;
    }
    setItems((x) => [...x, data as ChecklistItem]);
    setNewTitle("");
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const existing = new Set(items.map((i) => i.title));
      const rows = starterChecklist(trip, participants)
        .filter((t) => !existing.has(t))
        .map((title, idx) => ({ trip_id: trip.id, title, is_shared: true, sort_order: idx }));
      if (rows.length === 0) {
        toast.toast("הרשימה המומלצת כבר קיימת");
        return;
      }
      const { error } = await supabase.from("checklist_items").insert(rows);
      if (error) {
        toast.error("לא הצלחנו להוסיף את הרשימה");
        return;
      }
      toast.success(`נוספו ${rows.length} פריטים מומלצים ✨`);
      load();
    } finally {
      setSeeding(false);
    }
  };

  const canAdd = canParticipate && tab !== "preflight";
  const addRow = canAdd && (
    <div className="flex min-h-12 items-center gap-3 py-1.5 ps-4 pe-1.5">
      <Plus className="size-5 shrink-0 text-primary" aria-hidden />
      <input
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="הוספת פריט…"
        aria-label="פריט חדש"
        className="type-body min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted-foreground"
      />
      {newTitle.trim() && (
        <Button size="sm" onClick={add}>
          הוספה
        </Button>
      )}
    </div>
  );

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="צ'קליסט" />

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-title">צ'קליסט</h2>
        {canParticipate && tab === "shared" && (
          <Button size="sm" variant="soft" loading={seeding} onClick={seed}>
            <Sparkles className="size-4" /> רשימה מומלצת
          </Button>
        )}
      </div>

      <Segmented
        className="mb-4"
        options={[
          { value: "shared", label: "משותף" },
          // Personal items are private to whoever adds them; viewers can't add any.
          ...(canParticipate ? [{ value: "personal" as const, label: "אישי" }] : []),
          { value: "preflight", label: "לפני טיסה" },
        ]}
        value={tab}
        onChange={(v) => setTab(v)}
      />

      {canAdd && tab === "personal" && participants.length > 0 && (
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          aria-label="שיוך פריט חדש לנוסע"
          className="type-footnote mb-3 h-11 w-full rounded-2xl border border-input bg-card px-3"
        >
          <option value="">פריטים חדשים: בלי שיוך לנוסע</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              פריטים חדשים: עבור {p.name}
            </option>
          ))}
        </select>
      )}

      {tab === "preflight" && (
        <PreflightPanel trip={trip} participants={participants} existing={items} onAdded={load} readOnly={!canParticipate} />
      )}

      {tab === "preflight" ? null : loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <>
          {addRow && <GroupedList className="mb-2">{addRow}</GroupedList>}
          <EmptyState
            emoji="✅"
            title={tab === "shared" ? "הרשימה המשותפת ריקה" : "אין עדיין פריטים אישיים"}
            description={
              !canParticipate
                ? undefined
                : tab === "shared"
                  ? "הוסף פריטים ידנית, או צור רשימה מומלצת חכמה לפי המשתתפים והטיול."
                  : "הוסף פריטים ידנית בשורה למעלה."
            }
            action={
              tab === "shared" && canParticipate ? (
                <Button variant="outline" loading={seeding} onClick={seed}>
                  <ListPlus className="size-4" /> רשימה מומלצת
                </Button>
              ) : undefined
            }
          />
        </>
      ) : (
        <>
          {/* Progress */}
          <div className="mb-4 rounded-2xl bg-card px-4 py-3 text-card-foreground">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="type-headline">
                {doneCount === shown.length ? "הכול מוכן ✓" : `${doneCount} מתוך ${shown.length} הושלמו`}
              </span>
              <span className="type-footnote tabular-nums text-muted-foreground">
                {Math.round((doneCount / shown.length) * 100)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / shown.length) * 100}%` }} />
            </div>
          </div>

          <GroupedList>
            {shown.map((item) => (
              <div key={item.id} className="flex min-h-12 items-center gap-3 py-2 ps-4 pe-1">
                <Checkbox
                  checked={item.is_done}
                  onChange={() => toggle(item)}
                  disabled={!canParticipate}
                  label={item.title}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "type-body [overflow-wrap:anywhere] transition-colors",
                      item.is_done && "text-muted-foreground line-through",
                    )}
                  >
                    <bdi>{item.title}</bdi>
                  </div>
                  {ownerName(item.participant_id) && (
                    <div className="type-footnote text-muted-foreground">
                      עבור <bdi>{ownerName(item.participant_id)}</bdi>
                    </div>
                  )}
                </div>
                {canParticipate && (
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    aria-label={`מחיקת ${item.title}`}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {addRow}
          </GroupedList>
        </>
      )}

    </div>
  );
}
