import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Participant } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { ImportParticipants } from "@/components/ImportParticipants";
import { Button, Card, Chip, EmptyState, Field, Input, Label, Modal, Segmented } from "@/components/ui";
import { AGE_RANGES, PREFERENCES, prefEmoji, prefLabel } from "@/lib/trip-options";

type Draft = {
  id?: string;
  name: string;
  ageMode: "age" | "range";
  age: string;
  age_range: string;
  preferences: string[];
};

const blank: Draft = { name: "", ageMode: "age", age: "", age_range: AGE_RANGES[5], preferences: [] };

export default function PeopleTab() {
  const { trip, participants, reloadParticipants } = useTrip();
  const toast = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error("צריך שם");
      return;
    }
    setSaving(true);
    const payload = {
      trip_id: trip.id,
      name: editing.name.trim(),
      age: editing.ageMode === "age" && editing.age ? Number(editing.age) : null,
      age_range: editing.ageMode === "range" ? editing.age_range : null,
      preferences: editing.preferences,
    };
    const { error } = editing.id
      ? await supabase.from("participants").update(payload).eq("id", editing.id)
      : await supabase.from("participants").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("השמירה נכשלה");
      return;
    }
    setEditing(null);
    toast.success("נשמר");
    reloadParticipants();
  };

  const remove = async (p: Participant) => {
    await supabase.from("participants").delete().eq("id", p.id);
    toast.success(`${p.name} הוסר`);
    reloadParticipants();
  };

  const toEdit = (p: Participant): Draft => ({
    id: p.id,
    name: p.name,
    ageMode: p.age != null ? "age" : "range",
    age: p.age != null ? String(p.age) : "",
    age_range: p.age_range ?? AGE_RANGES[5],
    preferences: p.preferences ?? [],
  });

  const togglePref = (pref: string) =>
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            preferences: prev.preferences.includes(pref)
              ? prev.preferences.filter((x) => x !== pref)
              : [...prev.preferences, pref],
          }
        : prev,
    );

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="משתתפים" />
      <ScreenTitle
        title={`משתתפים (${participants.length})`}
        action={
          <Button size="sm" variant="outline" onClick={() => setEditing({ ...blank })}>
            <Plus className="size-4" />
          </Button>
        }
      />

      <button
        onClick={() => setBulkOpen(true)}
        className="mb-4 flex w-full items-center gap-3 rounded-3xl border-2 border-dashed border-primary bg-primary-soft/50 p-4 text-right transition active:scale-[0.99]"
      >
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Users className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-bold">הוספת קבוצה בבת אחת</div>
          <div className="text-xs text-muted-foreground">רשימת שמות, Excel, או סריקת דרכונים</div>
        </div>
      </button>

      {participants.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="אין עדיין משתתפים"
          description="הוסף את הנוסעים כדי לקבל המלצות מותאמות לגילאים ולהעדפות שלהם."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {participants.map((p) => (
            <Card key={p.id} className="flex items-start gap-3 p-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-sunset text-lg font-bold text-white">
                {p.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.age != null ? `גיל ${p.age}` : p.age_range ? `גילאי ${p.age_range}` : "גיל לא צוין"}
                </div>
                {p.preferences?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.preferences.map((pref) => (
                      <span key={pref} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                        {prefEmoji(pref)} {prefLabel(pref)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <button onClick={() => setEditing(toEdit(p))} className="text-muted-foreground" aria-label="עריכה">
                  <Pencil className="size-4" />
                </button>
                <button onClick={() => remove(p)} className="text-destructive" aria-label="מחיקה">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ImportParticipants
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onConfirm={async (items) => {
          const rows = items.map((p) => ({
            trip_id: trip.id,
            name: p.name,
            age: p.age,
            age_range: p.age == null ? p.age_range : null,
            preferences: p.preferences,
          }));
          const { error } = await supabase.from("participants").insert(rows);
          if (error) {
            toast.error("ההוספה נכשלה");
            return;
          }
          toast.success(`נוספו ${rows.length} משתתפים 🎉`);
          reloadParticipants();
        }}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "עריכת משתתף" : "משתתף חדש"}
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
              ביטול
            </Button>
            <Button className="flex-1" loading={saving} onClick={save}>
              שמירה
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <Field label="שם">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>גיל</Label>
                <Segmented
                  options={[
                    { value: "age", label: "גיל מדויק" },
                    { value: "range", label: "טווח" },
                  ]}
                  value={editing.ageMode}
                  onChange={(v) => setEditing({ ...editing, ageMode: v as "age" | "range" })}
                />
              </div>
              {editing.ageMode === "age" ? (
                <Input
                  type="number"
                  min={0}
                  max={120}
                  className="w-24"
                  value={editing.age}
                  onChange={(e) => setEditing({ ...editing, age: e.target.value })}
                />
              ) : (
                <select
                  value={editing.age_range}
                  onChange={(e) => setEditing({ ...editing, age_range: e.target.value })}
                  className="h-12 w-28 rounded-2xl border border-input bg-card px-2 text-sm"
                >
                  {AGE_RANGES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <Label>העדפות</Label>
              <div className="flex flex-wrap gap-1.5">
                {PREFERENCES.map((pref) => (
                  <Chip
                    key={pref.value}
                    active={editing.preferences.includes(pref.value)}
                    onClick={() => togglePref(pref.value)}
                  >
                    {pref.emoji} {pref.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
