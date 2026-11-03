import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, ExternalLink, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ItineraryItem, TripClient } from "@/lib/types";
import { Badge, Card, Input, Spinner } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { EXTERNAL_REF_MAX, IMPORT_SOURCE_LABEL, isImportSource, normalizeExternalRef } from "@/lib/agency-import";
import { Flag } from "@/components/Flag";
import { AgentSendPanel } from "@/components/AgentSendPanel";
import { dateRangeHeb, parseLocalDate, tripLength, dayCount } from "@/lib/trip-dates";
import { useTrip } from "@/routes/trip/TripLayout";
import TransportTab from "@/routes/trip/TransportTab";
import DocumentsTab from "@/routes/trip/DocumentsTab";

type DaySummary = { day: string; titles: string[] };

/**
 * The agent's trip screen (agency workspace, phase 2), inside AgencyTripLayout.
 * Desktop: the trip — details, bookings, documents, a short itinerary — in the
 * main column, and sending to the client in a side column that stays in view.
 * Phone: one column, with sending right after the details.
 * Bookings and documents are the traveller tabs' own editors (same rows, same
 * RLS); "open in the trip app" opens the traveller screen (as the owner) in a new tab.
 */
export default function AgencyTripPage() {
  const { trip, participants, reloadTrip } = useTrip();
  const [client, setClient] = useState<TripClient | null>(null);
  const [days, setDays] = useState<DaySummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: c }, { data: items }] = await Promise.all([
        supabase.from("trip_clients").select("*").eq("trip_id", trip.id).maybeSingle(),
        supabase
          .from("itinerary_items")
          .select("day_date, title, sort_order")
          .eq("trip_id", trip.id)
          .order("day_date")
          .order("sort_order"),
      ]);
      if (cancelled) return;
      setClient((c as TripClient | null) ?? null);
      const byDay = new Map<string, string[]>();
      for (const it of (items as Pick<ItineraryItem, "day_date" | "title">[] | null) ?? []) {
        byDay.set(it.day_date, [...(byDay.get(it.day_date) ?? []), it.title]);
      }
      setDays([...byDay].map(([day, titles]) => ({ day, titles })));
    })();
    return () => {
      cancelled = true;
    };
  }, [trip.id]);

  /** After the send panel saved the client's details, so the heading shows the new name. */
  const reloadClient = async () => {
    const { data } = await supabase.from("trip_clients").select("*").eq("trip_id", trip.id).maybeSingle();
    setClient((data as TripClient | null) ?? null);
  };

  const today = new Date();
  const length = tripLength(trip.start_date, trip.end_date);
  const clientName = client?.client_name?.trim();

  return (
    <div className="mx-auto max-w-lg px-4 pb-16 pt-4 lg:max-w-6xl lg:px-8 lg:pt-8">
      <Link
        to="/agency"
        className="type-body -ms-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-full pe-3 ps-1 text-primary transition-colors active:bg-muted/70"
      >
        <ChevronRight className="size-5" />
        הטיולים
      </Link>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8">
        {/* Details: first on both widths. */}
        <section className="lg:col-start-1 lg:row-start-1">
          <div className="flex items-start gap-3">
            <Flag destination={trip.destination} fallback={trip.cover_emoji} className="w-[44px] shrink-0 text-[34px]" />
            <div className="min-w-0 flex-1">
              <h1 className="type-large-title [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{clientName || trip.title}</h1>
              <p className="type-body text-muted-foreground [unicode-bidi:plaintext]">
                {[clientName ? trip.title : null, trip.destination].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <Card className="mt-4 flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
            <span className="type-body flex items-center gap-2">
              <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              {dateRangeHeb(trip.start_date, trip.end_date, today) || "בלי תאריכים"}
              {length ? <span className="text-muted-foreground">({dayCount(length)})</span> : null}
            </span>
            <span className="type-body flex min-w-0 items-center gap-2">
              <Users className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate [unicode-bidi:plaintext]">
                {participants.length
                  ? participants.map((p) => p.name).filter(Boolean).join(", ")
                  : "עוד אין נוסעים"}
              </span>
            </span>
            <a
              href={`/trip/${trip.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="type-body inline-flex min-h-11 items-center gap-2 text-primary sm:ms-auto"
            >
              <ExternalLink className="size-5" aria-hidden />
              פתיחה באפליקציית הטיול
            </a>
          </Card>
          <BookingRefField tripId={trip.id} client={client} onSaved={reloadClient} />
        </section>

        {/* Sending: the side column on desktop (stays in view), right after the details on a phone. */}
        <aside className="lg:sticky lg:top-6 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <Card className="p-4">
            <AgentSendPanel tripId={trip.id} embedded onTripChange={reloadTrip} onClientChange={reloadClient} />
          </Card>
        </aside>

        <section className="lg:col-start-1">
          <TransportTab embedded />
        </section>

        <section className="lg:col-start-1">
          <DocumentsTab embedded />
        </section>

        <section className="lg:col-start-1">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="type-title">המסלול</h2>
            <a
              href={`/trip/${trip.id}/itinerary`}
              target="_blank"
              rel="noopener noreferrer"
              className="type-footnote inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary"
            >
              <ExternalLink className="size-4" aria-hidden />
              עריכת המסלול
            </a>
          </div>
          {days === null ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : days.length === 0 ? (
            <p className="type-footnote rounded-2xl bg-card px-4 py-5 text-center text-muted-foreground">
              עוד אין פעילויות במסלול.
            </p>
          ) : (
            <div className="divide-y divide-separator overflow-hidden rounded-2xl bg-card text-card-foreground">
              {days.map((d) => (
                <div key={d.day} className="flex items-baseline gap-3 px-4 py-3">
                  <span className="type-footnote w-24 shrink-0 font-semibold">{dayLabel(d.day)}</span>
                  <span className="type-footnote min-w-0 flex-1 truncate text-muted-foreground [unicode-bidi:plaintext]">
                    {d.titles.join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Where the trip came from and the agency's own booking number (migration 025),
 * owner-only on trip_clients. The number is saved when the field loses focus;
 * it is what a future import from the agency's system will match the trip by.
 */
function BookingRefField({
  tripId,
  client,
  onSaved,
}: {
  tripId: string;
  client: TripClient | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const stored = client?.external_ref ?? "";
  const [value, setValue] = useState(stored);
  const [saving, setSaving] = useState(false);
  // A reload (after the send panel saved the client) brings the stored value back in.
  useEffect(() => setValue(stored), [stored]);

  const save = async () => {
    const next = normalizeExternalRef(value);
    if (value.trim().length > EXTERNAL_REF_MAX) {
      toast.error(`מספר ההזמנה ארוך מדי (עד ${EXTERNAL_REF_MAX} תווים)`);
      return;
    }
    if (next === (client?.external_ref ?? null)) {
      setValue(next ?? "");
      return;
    }
    setSaving(true);
    // Upsert: a trip may not have a client row yet; a new one reads as 'manual'.
    const { error } = await supabase.from("trip_clients").upsert({ trip_id: tripId, external_ref: next });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("מספר ההזמנה לא נשמר");
      return;
    }
    toast.success(next ? "מספר ההזמנה נשמר" : "מספר ההזמנה הוסר");
    onSaved();
  };

  const source = client && isImportSource(client.source) ? client.source : null;
  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="type-footnote px-1 font-semibold text-muted-foreground">מספר ההזמנה אצלכם</span>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          disabled={saving}
          dir="ltr"
          placeholder="לדוגמה: TLV-4471"
          maxLength={EXTERNAL_REF_MAX + 20}
        />
      </label>
      {source && (
        <Badge tone="muted" className="self-start py-1 sm:self-center">
          {IMPORT_SOURCE_LABEL[source]}
        </Badge>
      )}
    </div>
  );
}

/** "ג׳, 15 בנוב׳" for an itinerary day (a calendar day, parsed through trip-dates). */
function dayLabel(day: string): string {
  const d = parseLocalDate(day);
  return d ? d.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "short" }) : day;
}
