import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, LinkIcon, Lock, MoreHorizontal, Plus, ScanLine, Trash2, Upload, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { DocumentRow } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader } from "@/components/TripHeader";
import { Button, Chip, EmptyState, Field, GroupedList, Input, Label, Modal, Segmented, SheetRow, Spinner } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { DOC_CATEGORIES } from "@/lib/trip-options";
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
  const [addOpen, setAddOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<DocumentRow | null>(null);
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
        toast.error("ההעלאה נכשלה. נסו שוב.");
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
    const { error } = await supabase.from("documents").insert({
      trip_id: trip.id,
      name: linkModal.name.trim(),
      category,
      participant_id: participantId || null,
      external_url: linkModal.url.trim(),
      visibility,
    });
    if (error) {
      toast.error("שמירת הקישור נכשלה");
      return;
    }
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
    // Row first: if it fails, the file is still there for the row that remains.
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      toast.error("המחיקה נכשלה");
      load();
      return;
    }
    if (doc.storage_path) {
      const { error: fileError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
      if (fileError) console.error(fileError);
    }
    toast.success("המסמך נמחק");
  };

  // A category this build doesn't know shows under "אחר".
  const groupOf = (category: string) => (DOC_CATEGORIES.some((c) => c.value === category) ? category : "other");
  // Fall back to "all" once the chosen category has no documents left (its chip is gone).
  const activeFilter = filter !== "all" && docs.some((d) => groupOf(d.category) === filter) ? filter : "all";
  const filtered = docs.filter((d) => activeFilter === "all" || groupOf(d.category) === activeFilter);
  const participantName = (id: string | null) => participants.find((p) => p.id === id)?.name;

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="מסמכים וקבצים" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-title">מסמכים</h2>
        {canParticipate && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={uploading}
            aria-label={uploading ? "מעלה קובץ…" : "הוספת מסמך"}
            className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
          >
            {uploading ? <Spinner className="size-5" /> : <Plus className="size-5" />}
          </button>
        )}
      </div>
      {/* No `capture` attribute: that forces iOS straight into the camera,
          skipping its native picker sheet (Photo Library / Take Photo /
          Browse…) — "Browse" is also how Files-provider apps like Google
          Drive show up as an upload source, so this covers both. */}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onPickFile} />

      {/* filter — one scrolling row */}
      {docs.length > 0 && (
        <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&>*]:shrink-0 [&>*]:whitespace-nowrap">
          <Chip active={activeFilter === "all"} onClick={() => setFilter("all")}>
            הכל
          </Chip>
          {DOC_CATEGORIES.filter((c) => docs.some((d) => groupOf(d.category) === c.value)).map((c) => (
            <Chip key={c.value} active={activeFilter === c.value} onClick={() => setFilter(c.value)}>
              {c.emoji} {c.label}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          emoji="📁"
          title="אין עדיין מסמכים"
          description="העלה כרטיסי טיסה, אישורי מלון, ביטוח ודרכונים — או הדבק קישור חיצוני."
          action={
            canParticipate && (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> הוספת מסמך
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {DOC_CATEGORIES.map((c) => ({ c, list: filtered.filter((d) => groupOf(d.category) === c.value) }))
            .filter((g) => g.list.length > 0)
            .map(({ c, list }) => (
              <GroupedList key={c.value} title={`${c.label} · ${list.length}`}>
                {list.map((doc) => {
                  const mine = doc.uploaded_by === user?.id;
                  return (
                    <div key={doc.id} className="flex items-center gap-1 pe-1">
                      <button
                        type="button"
                        onClick={() => open(doc)}
                        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 ps-4 text-start transition-colors active:bg-muted/70"
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-lg" aria-hidden>
                          {c.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          {/* dir=auto so an English name clamps at its own end; match-parent keeps it right-aligned. */}
                          <span dir="auto" className="type-headline line-clamp-2 [overflow-wrap:anywhere] [text-align:match-parent]">
                            {doc.name}
                          </span>
                          <span className="type-footnote flex items-center gap-1 text-muted-foreground">
                            {doc.visibility === "members" ? <Users className="size-3 shrink-0" /> : <Lock className="size-3 shrink-0" />}
                            <span className="truncate">
                              {mine ? (doc.visibility === "members" ? "כל חברי הטיול" : "רק אני") : "שותף איתך"}
                              {doc.participant_id && participantName(doc.participant_id) && (
                                <>
                                  {" · "}
                                  <bdi>{participantName(doc.participant_id)}</bdi>
                                </>
                              )}
                            </span>
                          </span>
                        </span>
                        {doc.external_url ? (
                          <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-label="קישור חיצוני" />
                        ) : (
                          <Download className="size-4 shrink-0 text-muted-foreground" aria-label="קובץ" />
                        )}
                      </button>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => setActionsFor(doc)}
                          aria-label={`אפשרויות עבור ${doc.name}`}
                          className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                        >
                          <MoreHorizontal className="size-5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </GroupedList>
            ))}
        </div>
      )}

      {/* Add: who sees it, category, traveller — then how */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="הוספת מסמך">
        <div className="flex flex-col gap-4">
          <div>
            <Label>מי יראה את המסמך</Label>
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
            <Label>קטגוריה</Label>
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
              <Label>שייך לנוסע (לא חובה)</Label>
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
          <div className="flex flex-col gap-2">
            {!isAnonymous && (
              <SheetRow
                icon={<Upload className="size-5" />}
                label="העלאת קובץ"
                hint="תמונה או PDF, עד 20MB"
                onClick={() => {
                  setAddOpen(false);
                  fileRef.current?.click();
                }}
              />
            )}
            <SheetRow
              icon={<LinkIcon className="size-5" />}
              label="קישור חיצוני"
              hint="Drive / Dropbox / OneDrive"
              onClick={() => {
                setAddOpen(false);
                setLinkModal({ name: "", url: "" });
              }}
            />
            {canScan && (
              <SheetRow
                icon={<ScanLine className="size-5" />}
                label="סריקת שובר הזמנה"
                hint="טיסה, מלון או רכב — הפרטים נכנסים לטיול"
                onClick={() => {
                  setAddOpen(false);
                  setVoucherOpen(true);
                }}
              />
            )}
          </div>
        </div>
      </Modal>

      {/* The uploader's actions on one document */}
      <Modal open={!!actionsFor} onClose={() => setActionsFor(null)} title={actionsFor?.name ?? ""}>
        {actionsFor && (
          <div className="flex flex-col gap-2">
            <SheetRow
              icon={actionsFor.external_url ? <ExternalLink className="size-5" /> : <Download className="size-5" />}
              label="פתיחה"
              onClick={() => {
                const d = actionsFor;
                setActionsFor(null);
                open(d);
              }}
            />
            <SheetRow
              icon={actionsFor.visibility === "members" ? <Lock className="size-5" /> : <Users className="size-5" />}
              label={actionsFor.visibility === "members" ? "להפוך לפרטי (רק אני)" : "לשתף עם כל חברי הטיול"}
              onClick={() => {
                const d = actionsFor;
                setActionsFor(null);
                toggleVisibility(d);
              }}
            />
            <SheetRow
              icon={<Trash2 className="size-5" />}
              label="מחיקה"
              destructive
              onClick={() => {
                const d = actionsFor;
                setActionsFor(null);
                remove(d);
              }}
            />
          </div>
        )}
      </Modal>

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
