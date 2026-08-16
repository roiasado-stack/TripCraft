import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, LinkIcon, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { DocumentRow } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, Chip, EmptyState, Field, Input, Modal, Spinner } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { DOC_CATEGORIES, docCategoryLabel } from "@/lib/trip-options";

const BUCKET = "trip-docs";

export default function DocumentsTab() {
  const { trip, participants } = useTrip();
  const { user } = useAuth();
  const toast = useToast();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("flight");
  const [participantId, setParticipantId] = useState<string>("");
  const [linkModal, setLinkModal] = useState<{ name: string; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.from("documents").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false });
    setDocs((data as DocumentRow[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("הקובץ גדול מדי (מקסימום 20MB)");
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${user.id}/${trip.id}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("documents").insert({
        trip_id: trip.id,
        name: file.name,
        category,
        participant_id: participantId || null,
        storage_path: path,
      });
      if (insErr) throw insErr;
      toast.success("הקובץ הועלה 📎");
      load();
    } catch (err) {
      console.error(err);
      toast.error("ההעלאה נכשלה. ודא שהסכימה/הדלי הוגדרו (README).");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveLink = async () => {
    if (!linkModal?.url.trim() || !linkModal.name.trim()) {
      toast.error("צריך שם וקישור");
      return;
    }
    await supabase.from("documents").insert({
      trip_id: trip.id,
      name: linkModal.name.trim(),
      category,
      participant_id: participantId || null,
      external_url: linkModal.url.trim(),
    });
    setLinkModal(null);
    toast.success("הקישור נשמר 🔗");
    load();
  };

  const open = async (doc: DocumentRow) => {
    if (doc.external_url) {
      window.open(doc.external_url, "_blank", "noopener");
      return;
    }
    if (doc.storage_path) {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
      if (error || !data) {
        toast.error("לא ניתן לפתוח את הקובץ");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener");
    }
  };

  const remove = async (doc: DocumentRow) => {
    setDocs((x) => x.filter((d) => d.id !== doc.id));
    if (doc.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
  };

  const filtered = docs.filter((d) => filter === "all" || d.category === filter);
  const participantName = (id: string | null) => participants.find((p) => p.id === id)?.name;

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="מסמכים וקבצים" />
      <ScreenTitle title="מסמכים" />

      {/* upload controls */}
      <Card className="mb-4 flex flex-col gap-3 p-4">
        <div>
          <div className="mb-1.5 text-sm font-semibold">קטגוריה</div>
          <div className="flex flex-wrap gap-1.5">
            {DOC_CATEGORIES.map((c) => (
              <Chip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
                {c.emoji} {c.label}
              </Chip>
            ))}
          </div>
        </div>
        {participants.length > 0 && (
          <div>
            <div className="mb-1.5 text-sm font-semibold">שייך לנוסע (לא חובה)</div>
            <select
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              className="h-11 w-full rounded-2xl border border-input bg-card px-3 text-sm"
            >
              <option value="">כללי / כל הטיול</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" loading={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> העלאת קובץ
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setLinkModal({ name: "", url: "" })}>
            <LinkIcon className="size-4" /> קישור חיצוני
          </Button>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={onPickFile} />
      </Card>

      {/* filter */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          הכל
        </Chip>
        {DOC_CATEGORIES.map((c) => (
          <Chip key={c.value} active={filter === c.value} onClick={() => setFilter(c.value)}>
            {c.emoji} {c.label}
          </Chip>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState emoji="📁" title="אין עדיין מסמכים" description="העלה כרטיסי טיסה, אישורי מלון, ביטוח ודרכונים — או הדבק קישור חיצוני." />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((doc) => (
            <Card key={doc.id} className="flex items-center gap-3 p-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-xl">
                {DOC_CATEGORIES.find((c) => c.value === doc.category)?.emoji ?? "📄"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{doc.name}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{docCategoryLabel(doc.category)}</span>
                  {doc.participant_id && <span>· {participantName(doc.participant_id)}</span>}
                  {doc.external_url && <ExternalLink className="size-3" />}
                </div>
              </div>
              <button onClick={() => open(doc)} className="grid size-9 place-items-center rounded-xl border border-border text-primary" aria-label="פתיחה">
                {doc.external_url ? <ExternalLink className="size-4" /> : <Download className="size-4" />}
              </button>
              <button onClick={() => remove(doc)} className="text-destructive" aria-label="מחיקה">
                <Trash2 className="size-4" />
              </button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!linkModal}
        onClose={() => setLinkModal(null)}
        title="קישור חיצוני"
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setLinkModal(null)}>
              ביטול
            </Button>
            <Button className="flex-1" onClick={saveLink}>
              שמירה
            </Button>
          </>
        }
      >
        {linkModal && (
          <div className="flex flex-col gap-3">
            <Field label="שם המסמך">
              <Input value={linkModal.name} onChange={(e) => setLinkModal({ ...linkModal, name: e.target.value })} placeholder="למשל: כרטיס טיסה - יוסי" />
            </Field>
            <Field label="קישור (Drive / Dropbox / OneDrive)" hint="הדבק קישור שיתוף לצפייה.">
              <Input dir="ltr" className="text-right" value={linkModal.url} onChange={(e) => setLinkModal({ ...linkModal, url: e.target.value })} placeholder="https://…" />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
