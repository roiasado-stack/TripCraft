import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, LinkIcon, Lock, ScanLine, Trash2, Upload, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { DocumentRow } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, Chip, EmptyState, Field, Input, Modal, Segmented, Spinner } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { DOC_CATEGORIES, docCategoryLabel } from "@/lib/trip-options";
import { ImportVoucher, type VoucherResult } from "@/components/ImportVoucher";
import { DOCS_BUCKET as BUCKET, uploadTripDocument } from "@/lib/documents";
import { isSafeHttpUrl } from "@/lib/maps";

/**
 * A scanned voucher's times come back as local wall-clock time with no zone
 * ("2026-10-04T07:40:00"). Postgres would read that as UTC and the trip would
 * show the flight 2-3 hours late, so convert it the same way manual entry
 * does: read as local time, store as UTC.
 */
function localToIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function DocumentsTab() {
  const { trip, role, participants } = useTrip();
  const { user, isAnonymous } = useAuth();
  const canParticipate = can(role, "participate");
  // Voucher scans write flights/stays/transfers (editor-level) and are off for demo sessions.
  const canScan = can(role, "edit") && !isAnonymous;
  const [visibility, setVisibility] = useState<"private" | "members">("private");
  const toast = useToast();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("flight");
  const [participantId, setParticipantId] = useState<string>("");
  const [linkModal, setLinkModal] = useState<{ name: string; url: string } | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
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

  /** Thin wrapper over the shared uploadTripDocument (also used by the Wizard)
   *  binding this trip + user. Shared by the manual file picker and the
   *  voucher-scan confirm handler below. Throws on any failure (including an
   *  oversize file) for the caller to catch and toast appropriately. */
  const uploadDocument = async (file: File, fields: { category: string; participantId?: string | null; name?: string }) => {
    if (!user) throw new Error("not_authenticated");
    await uploadTripDocument({ userId: user.id, tripId: trip.id, file, visibility, ...fields });
  };

  /** Uploader-only: switch a document between "only me" and "all members". */
  const toggleVisibility = async (doc: DocumentRow) => {
    const next = doc.visibility === "members" ? "private" : "members";
    const { error } = await supabase.from("documents").update({ visibility: next }).eq("id", doc.id);
    if (error) {
      toast.error("לא הצלחנו לשנות את ההרשאה.");
      return;
    }
    toast.success(next === "members" ? "כל חברי הטיול יכולים לראות את המסמך" : "המסמך גלוי רק לך");
    load();
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      await uploadDocument(file, { category, participantId });
      toast.success("הקובץ הועלה 📎");
      load();
    } catch (err) {
      if (err instanceof Error && err.message === "file_too_large") {
        toast.error("הקובץ גדול מדי (מקסימום 20MB)");
      } else {
        console.error(err);
        toast.error("ההעלאה נכשלה. ודא שהסכימה/הדלי הוגדרו (README).");
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** Human-in-the-loop voucher scan confirmed: insert the structured record
   *  into the matching table, AND (best-effort) save the original file the
   *  same way the manual upload path does — so both the parsed data and the
   *  source document are preserved. */
  const onVoucherConfirm = async (result: VoucherResult, sourceFile: File | null) => {
    const docType = result.docType;
    try {
      if (result.docType === "flight") {
        // Every segment (outbound, return, connection legs) in one insert —
        // all or nothing, and the source file below is still uploaded once.
        const { error } = await supabase.from("flights").insert(
          result.data.map((d) => ({
            trip_id: trip.id,
            direction: d.direction === "inbound" ? "inbound" : "outbound",
            airline: d.airline,
            flight_number: d.flight_number,
            from_airport: d.from_airport,
            to_airport: d.to_airport,
            depart_at: localToIso(d.depart_at),
            arrive_at: localToIso(d.arrive_at),
            from_terminal: d.from_terminal,
            to_terminal: d.to_terminal,
            seats: d.seats,
            baggage: d.baggage,
            booking_ref: d.booking_ref,
            notes: d.notes,
          })),
        );
        if (error) throw error;
      } else if (result.docType === "hotel") {
        const d = result.data;
        const { error } = await supabase.from("stays").insert({
          trip_id: trip.id,
          hotel_name: d.hotel_name,
          address: d.address,
          check_in: d.check_in,
          check_out: d.check_out,
          booking_ref: d.booking_ref,
          phone: d.phone,
          url: d.url,
          notes: d.notes,
        });
        if (error) throw error;
      } else {
        const d = result.data;
        const { error } = await supabase.from("transfers").insert({
          trip_id: trip.id,
          kind: "car_rental",
          provider: d.provider,
          pickup_location: d.pickup_location,
          dropoff_location: d.dropoff_location,
          pickup_at: localToIso(d.pickup_at),
          return_at: localToIso(d.return_at),
          booking_ref: d.booking_ref,
          phone: d.phone,
          url: d.url,
          notes: d.notes,
        });
        if (error) throw error;
      }
    } catch (err) {
      console.error(err);
      toast.error("שמירת פרטי השובר נכשלה.");
      return;
    }

    if (sourceFile) {
      try {
        await uploadDocument(sourceFile, { category: docType, name: sourceFile.name });
      } catch (err) {
        console.error(err);
        toast.error("הפרטים נשמרו, אך שמירת הקובץ המקורי נכשלה.");
        load();
        return;
      }
    }
    toast.success("הפרטים נשמרו 🧾");
    load();
  };

  const saveLink = async () => {
    if (!linkModal?.url.trim() || !linkModal.name.trim()) {
      toast.error("צריך שם וקישור");
      return;
    }
    if (!isSafeHttpUrl(linkModal.url.trim())) {
      toast.error("הקישור צריך להתחיל ב-https://");
      return;
    }
    await supabase.from("documents").insert({
      trip_id: trip.id,
      name: linkModal.name.trim(),
      category,
      participant_id: participantId || null,
      external_url: linkModal.url.trim(),
      visibility,
    });
    setLinkModal(null);
    toast.success("הקישור נשמר 🔗");
    load();
  };

  const open = async (doc: DocumentRow) => {
    if (doc.external_url) {
      if (!isSafeHttpUrl(doc.external_url)) {
        toast.error("הקישור לא תקין — צריך להתחיל ב-https://");
        return;
      }
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
      {canParticipate && (
      <Card className="mb-4 flex flex-col gap-3 p-4">
        <div>
          <div className="mb-1.5 text-sm font-semibold">מי יראה את המסמך</div>
          <Segmented
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: "private", label: "רק אני", emoji: "🔒" },
              { value: "members", label: "כל חברי הטיול", emoji: "👥" },
            ]}
          />
        </div>
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
          {!isAnonymous && (
            <Button className="flex-1" loading={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> העלאת קובץ
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={() => setLinkModal({ name: "", url: "" })}>
            <LinkIcon className="size-4" /> קישור חיצוני
          </Button>
        </div>
        {/* No `capture` attribute: that forces iOS straight into the camera,
            skipping its native picker sheet (Photo Library / Take Photo /
            Browse…) — "Browse" is also how Files-provider apps like Google
            Drive show up as an upload source, so this covers both. */}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onPickFile} />
        {canScan && (
          <Button variant="soft" onClick={() => setVoucherOpen(true)}>
            <ScanLine className="size-4" /> סריקת שובר הזמנה
          </Button>
        )}
      </Card>
      )}

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
              {doc.uploaded_by === user?.id ? (
                <button
                  onClick={() => toggleVisibility(doc)}
                  className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground"
                  aria-label={doc.visibility === "members" ? "גלוי לכל חברי הטיול — להפוך לפרטי" : "גלוי רק לי — לשתף עם חברי הטיול"}
                  title={doc.visibility === "members" ? "גלוי לכל חברי הטיול" : "גלוי רק לי"}
                >
                  {doc.visibility === "members" ? <Users className="size-4" /> : <Lock className="size-4" />}
                </button>
              ) : (
                <Users className="size-4 shrink-0 text-muted-foreground" aria-label="שותף איתך" />
              )}
              <button onClick={() => open(doc)} className="grid size-9 place-items-center rounded-xl border border-border text-primary" aria-label="פתיחה">
                {doc.external_url ? <ExternalLink className="size-4" /> : <Download className="size-4" />}
              </button>
              {doc.uploaded_by === user?.id && (
                <button onClick={() => remove(doc)} className="text-destructive" aria-label="מחיקה">
                  <Trash2 className="size-4" />
                </button>
              )}
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

      <ImportVoucher open={voucherOpen} onClose={() => setVoucherOpen(false)} onConfirm={onVoucherConfirm} />
    </div>
  );
}
