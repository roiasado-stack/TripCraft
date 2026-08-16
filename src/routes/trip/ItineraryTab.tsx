import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ItineraryItem } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, EmptyState, Field, Input, Label, Modal, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { generateContent } from "@/lib/ai";
import { daysBetween, formatDayHeb, ITINERARY_CATEGORIES, itineraryCategory } from "@/lib/trip-options";

type Draft = {
  id?: string;
  day_date: string;
  start_time: string;
  title: string;
  description: string;
  category: string;
  location: string;
};

export default function ItineraryTab() {
  const { trip, participants } = useTrip();
  const toast = useToast();
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("itinerary_items")
      .select("*")
      .eq("trip_id", trip.id)
      .order("day_date")
      .order("start_time", { nullsFirst: true })
      .order("sort_order");
    setItems((data as ItineraryItem[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const days = useMemo(() => {
    const set = new Set<string>();
    if (trip.start_date && trip.end_date) daysBetween(trip.start_date, trip.end_date).forEach((d) => set.add(d));
    items.forEach((i) => set.add(i.day_date));
    return [...set].sort();
  }, [trip.start_date, trip.end_date, items]);

  const grouped = useMemo(() => {
    const map: Record<string, ItineraryItem[]> = {};
    items.forEach((i) => {
      (map[i.day_date] ??= []).push(i);
    });
    return map;
  }, [items]);

  const defaultDay = trip.start_date ?? new Date().toISOString().slice(0, 10);

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error("צריך כותרת לפריט");
      return;
    }
    const payload = {
      trip_id: trip.id,
      day_date: editing.day_date,
      start_time: editing.start_time || null,
      title: editing.title.trim(),
      description: editing.description || null,
      category: editing.category,
      location: editing.location || null,
    };
    if (editing.id) {
      await supabase.from("itinerary_items").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("itinerary_items").insert(payload);
    }
    setEditing(null);
    toast.success("נשמר");
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("itinerary_items").delete().eq("id", id);
    setItems((x) => x.filter((i) => i.id !== id));
  };

  const generate = async () => {
    setGenerating(true);
    const res = await generateContent(trip, participants, "itinerary");
    setGenerating(false);
    if (res.ok) {
      toast.success(`נוצר מסלול מוצע (${res.inserted} פריטים) ✨`);
      load();
    } else if (res.error === "not_deployed") {
      toast.error("יצירת ה-AI עדיין לא הופעלה. ראה README (Edge Function).");
    } else {
      toast.error("יצירת ה-AI נכשלה. נסה שוב.");
    }
  };

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="המסלול היומי" />
      <ScreenTitle
        title="מסלול"
        action={
          <Button size="sm" variant="soft" loading={generating} onClick={generate}>
            <Sparkles className="size-4" />
            AI
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : days.length === 0 ? (
        <EmptyState
          emoji="🗓️"
          title="עדיין אין מסלול"
          description="הוסף תאריכים לטיול או פריט ראשון, או תן ל-AI להציע מסלול יומי."
          action={
            <Button onClick={() => setEditing({ day_date: defaultDay, start_time: "", title: "", description: "", category: "activity", location: "" })}>
              <Plus className="size-4" /> הוספת פריט
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((day, idx) => (
            <div key={day}>
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {idx + 1}
                </span>
                <h3 className="font-bold">{formatDayHeb(day)}</h3>
              </div>
              <div className="flex flex-col gap-2">
                {(grouped[day] ?? []).map((it) => {
                  const cat = itineraryCategory(it.category);
                  return (
                    <Card key={it.id} className="flex items-start gap-3 p-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-lg">{cat.emoji}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {it.start_time && <span className="text-xs font-bold text-primary">{it.start_time.slice(0, 5)}</span>}
                          <span className="truncate font-semibold">{it.title}</span>
                        </div>
                        {it.location && <div className="text-xs text-muted-foreground">📍 {it.location}</div>}
                        {it.description && <p className="mt-0.5 text-sm text-muted-foreground">{it.description}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button onClick={() => setEditing({ id: it.id, day_date: it.day_date, start_time: it.start_time ?? "", title: it.title, description: it.description ?? "", category: it.category, location: it.location ?? "" })} className="text-muted-foreground" aria-label="עריכה">
                          <Pencil className="size-4" />
                        </button>
                        <button onClick={() => remove(it.id)} className="text-destructive" aria-label="מחיקה">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </Card>
                  );
                })}
                <button
                  onClick={() => setEditing({ day_date: day, start_time: "", title: "", description: "", category: "activity", location: "" })}
                  className="flex items-center justify-center gap-1 rounded-2xl border border-dashed border-border py-2.5 text-sm font-semibold text-muted-foreground"
                >
                  <Plus className="size-4" /> הוספה ליום זה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "עריכת פריט" : "פריט חדש"}
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
              ביטול
            </Button>
            <Button className="flex-1" onClick={save}>
              שמירה
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <Field label="כותרת">
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="לדוגמה: ביקור בפארק" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך">
                <Input type="date" value={editing.day_date} onChange={(e) => setEditing({ ...editing, day_date: e.target.value })} />
              </Field>
              <Field label="שעה">
                <Input type="time" value={editing.start_time} onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} />
              </Field>
            </div>
            <div>
              <Label>קטגוריה</Label>
              <div className="flex flex-wrap gap-1.5">
                {ITINERARY_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setEditing({ ...editing, category: c.value })}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${editing.category === c.value ? "border-primary bg-primary-soft" : "border-border"}`}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="מיקום">
              <Input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} placeholder="כתובת / שם מקום" />
            </Field>
            <Field label="פרטים">
              <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="הערות, טיפים…" />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
