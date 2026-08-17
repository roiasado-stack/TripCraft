import { useEffect, useMemo, useState } from "react";
import { Check, ListPlus, Plane } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { ChecklistItem, Flight, Participant, Trip } from "@/lib/types";
import { hoursLabel, preflightChecklist, type PreflightItem } from "@/lib/preflight";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The "before you leave the house" timeline, generated from the trip's own
 * flights and travellers. Items become normal shared checklist rows once
 * added, so ticking them off works exactly like everything else.
 */
export function PreflightPanel({
  trip,
  participants,
  existing,
  onAdded,
}: {
  trip: Trip;
  participants: Participant[];
  existing: ChecklistItem[];
  onAdded: () => void;
}) {
  const toast = useToast();
  const [flights, setFlights] = useState<Flight[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("flights").select("*").eq("trip_id", trip.id).order("depart_at");
      setFlights((data as Flight[]) ?? []);
    })();
  }, [trip.id]);

  const items = useMemo(
    () => (flights ? preflightChecklist(trip, flights, participants) : []),
    [trip, flights, participants],
  );

  const existingTitles = useMemo(() => new Set(existing.map((i) => i.title)), [existing]);

  // Group by the human label, not the raw hours: several buckets share a
  // label ("on the day"), and splitting them would repeat the heading.
  const groups = useMemo(() => {
    const map = new Map<string, { order: number; items: PreflightItem[] }>();
    items.forEach((i) => {
      const label = hoursLabel(i.hours_before);
      const entry = map.get(label) ?? { order: i.hours_before, items: [] };
      entry.order = Math.max(entry.order, i.hours_before);
      entry.items.push(i);
      map.set(label, entry);
    });
    return [...map.entries()].sort((a, b) => b[1].order - a[1].order);
  }, [items]);

  const missing = items.filter((i) => !existingTitles.has(i.title));

  const addAll = async () => {
    if (!missing.length) return;
    setBusy(true);
    const base = existing.length;
    const rows = missing.map((m, idx) => ({
      trip_id: trip.id,
      title: m.title,
      is_done: false,
      is_shared: true,
      sort_order: base + idx,
      participant_id: null,
    }));
    const { error } = await supabase.from("checklist_items").insert(rows);
    setBusy(false);
    if (error) {
      toast.error("ההוספה נכשלה");
      return;
    }
    toast.success(`נוספו ${rows.length} משימות לצ'קליסט ✈️`);
    onAdded();
  };

  const addOne = async (title: string) => {
    const { error } = await supabase.from("checklist_items").insert({
      trip_id: trip.id,
      title,
      is_done: false,
      is_shared: true,
      sort_order: existing.length,
      participant_id: null,
    });
    if (error) {
      toast.error("ההוספה נכשלה");
      return;
    }
    onAdded();
  };

  if (flights === null)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-sea text-white">
          <Plane className="size-5" />
        </div>
        <div className="flex-1 text-sm">
          <div className="font-bold">מה לעשות לפני הטיסה</div>
          <p className="text-xs text-muted-foreground">
            נבנה אוטומטית לפי הנוסעים והטיסות שלך. הוסף לצ'קליסט כדי לסמן ✓
          </p>
        </div>
      </Card>

      {missing.length > 0 && (
        <Button size="lg" loading={busy} onClick={addAll}>
          <ListPlus className="size-5" />
          הוספת {missing.length} המשימות לצ'קליסט
        </Button>
      )}

      {groups.map(([label, group]) => (
        <div key={label}>
          <h3 className="mb-2 flex items-center gap-2 font-bold">
            <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs text-secondary-foreground">
              {label}
            </span>
          </h3>
          <div className="flex flex-col gap-1.5">
            {group.items.map((i) => {
              const added = existingTitles.has(i.title);
              return (
                <Card
                  key={i.title}
                  className={cn("flex items-center gap-3 p-3 text-sm", added && "opacity-60")}
                >
                  <span className="flex-1">{i.title}</span>
                  {added ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                      <Check className="size-4" /> נוסף
                    </span>
                  ) : (
                    <button
                      onClick={() => addOne(i.title)}
                      className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                    >
                      הוספה
                    </button>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
