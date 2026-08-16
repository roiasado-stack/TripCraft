import { useEffect, useMemo, useState } from "react";
import { ListPlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ChecklistItem } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, Checkbox, EmptyState, Input, Segmented, Spinner } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { starterChecklist } from "@/lib/starter";
import { cn } from "@/lib/utils";

export default function ChecklistTab() {
  const { trip, participants } = useTrip();
  const toast = useToast();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"shared" | "personal">("shared");
  const [newTitle, setNewTitle] = useState("");
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("checklist_items").select("*").eq("trip_id", trip.id).order("sort_order").order("created_at");
    setItems((data as ChecklistItem[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const shown = useMemo(() => items.filter((i) => (tab === "shared" ? i.is_shared : !i.is_shared)), [items, tab]);
  const doneCount = shown.filter((i) => i.is_done).length;

  const toggle = async (item: ChecklistItem) => {
    setItems((x) => x.map((i) => (i.id === item.id ? { ...i, is_done: !i.is_done } : i)));
    await supabase.from("checklist_items").update({ is_done: !item.is_done }).eq("id", item.id);
  };
  const remove = async (id: string) => {
    setItems((x) => x.filter((i) => i.id !== id));
    await supabase.from("checklist_items").delete().eq("id", id);
  };
  const add = async () => {
    if (!newTitle.trim()) return;
    const { data } = await supabase
      .from("checklist_items")
      .insert({ trip_id: trip.id, title: newTitle.trim(), is_shared: tab === "shared" })
      .select()
      .single();
    if (data) setItems((x) => [...x, data as ChecklistItem]);
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
      await supabase.from("checklist_items").insert(rows);
      toast.success(`נוספו ${rows.length} פריטים מומלצים ✨`);
      load();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="צ'קליסט" />
      <ScreenTitle
        title="צ'קליסט"
        action={
          <Button size="sm" variant="soft" loading={seeding} onClick={seed}>
            <Sparkles className="size-4" /> רשימה מומלצת
          </Button>
        }
      />

      <Segmented
        className="mb-3"
        options={[
          { value: "shared", label: "משותף 👥" },
          { value: "personal", label: "אישי 🧍" },
        ]}
        value={tab}
        onChange={(v) => setTab(v)}
      />

      {shown.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / shown.length) * 100}%` }} />
          </div>
          <span className="text-xs font-semibold text-muted-foreground">
            {doneCount}/{shown.length}
          </span>
        </div>
      )}

      {/* add row */}
      <div className="mb-4 flex gap-2">
        <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="הוספת פריט…" />
        <Button size="icon" onClick={add} aria-label="הוספה">
          <Plus className="size-5" />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          emoji="✅"
          title={tab === "shared" ? "הרשימה המשותפת ריקה" : "אין עדיין פריטים אישיים"}
          description="הוסף פריטים ידנית, או צור רשימה מומלצת חכמה לפי המשתתפים והטיול."
          action={
            tab === "shared" ? (
              <Button variant="outline" loading={seeding} onClick={seed}>
                <ListPlus className="size-4" /> רשימה מומלצת
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((item) => (
            <Card key={item.id} className={cn("flex items-center gap-3 p-3 transition", item.is_done && "opacity-60")}>
              <Checkbox checked={item.is_done} onChange={() => toggle(item)} />
              <span className={cn("flex-1 font-medium", item.is_done && "line-through")}>{item.title}</span>
              <button onClick={() => remove(item.id)} className="text-destructive" aria-label="מחיקה">
                <Trash2 className="size-4" />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
