import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Participant } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { can } from "@/lib/permissions";
import { TripHeader } from "@/components/TripHeader";
import { ImportParticipants } from "@/components/ImportParticipants";
import { Button, Chip, EmptyState, Field, GroupedList, Input, Label, Modal, Segmented, SheetRow } from "@/components/ui";
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
  const { trip, role, participants, reloadParticipants } = useTrip();
  const canEdit = can(role, "edit");
  const toast = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<Participant | null>(null);

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
    const { error } = await supabase.from("participants").delete().eq("id", p.id);
    if (error) {
      toast.error("המחיקה נכשלה");
      return;
    }
    toast.success(`${p.name} הוסר`);
    reloadParticipants();
  };

  const toEdit = (p: Participant): Draft => ({
    id: p.id,
    name: p.name,
    // Unknown age opens in exact-age mode, empty — range mode would preselect
    // AGE_RANGES[5] and a plain save would silently write that guess.
    ageMode: p.age == null && p.age_range ? "range" : "age",
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
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-title">
          משתתפים
          {participants.length > 0 && <span className="type-headline ms-2 text-muted-foreground">{participants.length}</span>}
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            aria-label="הוספת משתתפים"
            className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
          >
            <Plus className="size-5" />
          </button>
        )}
      </div>

      {participants.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="אין עדיין משתתפים"
          description="הוסף את הנוסעים כדי לקבל המלצות מותאמות לגילאים ולהעדפות שלהם."
          action={
            canEdit && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => setEditing({ ...blank })}>
                  <Plus className="size-4" /> הוספת משתתף
                </Button>
                <Button variant="outline" onClick={() => setBulkOpen(true)}>
                  <Users className="size-4" /> קבוצה בבת אחת
                </Button>
              </div>
            )
          }
        />
      ) : (
        <GroupedList>
          {participants.map((p) => (
            <div key={p.id} className="flex items-start gap-3 py-3 ps-4 pe-1">
              <div className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-sunset text-lg font-bold text-white">
                {Array.from(p.name.trim())[0] ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="type-headline [overflow-wrap:anywhere]">
                  <bdi>{p.name}</bdi>
                </div>
                <div className="type-footnote text-muted-foreground">
                  {p.age != null ? `גיל ${p.age}` : p.age_range ? `גילאי ${p.age_range}` : "גיל לא צוין"}
                </div>
                {p.preferences?.length > 0 && (
                  <div className="type-footnote mt-0.5 text-muted-foreground">
                    {p.preferences.map((pref) => `${prefEmoji(pref)} ${prefLabel(pref)}`).join(" · ")}
                  </div>
                )}
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setActionsFor(p)}
                  aria-label={`אפשרויות עבור ${p.name}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                >
                  <MoreHorizontal className="size-5" />
                </button>
              )}
            </div>
          ))}
        </GroupedList>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="הוספת משתתפים">
        <div className="flex flex-col gap-2">
          <SheetRow
            icon={<Plus className="size-5" />}
            label="משתתף אחד"
            onClick={() => {
              setAddOpen(false);
              setEditing({ ...blank });
            }}
          />
          <SheetRow
            icon={<Users className="size-5" />}
            label="קבוצה בבת אחת"
            hint="רשימת שמות, Excel, או סריקת דרכונים"
            onClick={() => {
              setAddOpen(false);
              setBulkOpen(true);
            }}
          />
        </div>
      </Modal>

      <Modal open={!!actionsFor} onClose={() => setActionsFor(null)} title={actionsFor?.name ?? ""}>
        {actionsFor && (
          <div className="flex flex-col gap-2">
            <SheetRow
              icon={<Pencil className="size-5" />}
              label="עריכה"
              onClick={() => {
                const p = actionsFor;
                setActionsFor(null);
                setEditing(toEdit(p));
              }}
            />
            <SheetRow
              icon={<Trash2 className="size-5" />}
              label="מחיקה"
              destructive
              onClick={() => {
                const p = actionsFor;
                setActionsFor(null);
                remove(p);
              }}
            />
          </div>
        )}
      </Modal>

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
