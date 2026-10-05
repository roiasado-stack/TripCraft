import { useState } from "react";
import { BadgeCheck, CircleAlert, CircleHelp, Search } from "lucide-react";
import type { CuratedKosherItem, KosherLookup, KosherPlace, KosherTier, Trip } from "@/lib/types";
import { lookupKosher } from "@/lib/ai";
import { chabadSearchUrl, isSafeHttpUrl, kosherSearchUrl } from "@/lib/maps";
import { Badge, Button, Card, Input } from "@/components/ui";
import { LinkChip, MapLink } from "@/components/MapLink";

/** The three trust tiers, worded the same way the agent must word them. */
export const KOSHER_TIER_TEXT: Record<KosherTier, string> = {
  verified: "מאומת",
  unverified: "נמצא במפה — לא מאומת, יש לוודא השגחה",
  none: "אין מידע",
};

export function KosherTierBadge({ tier }: { tier: KosherTier }) {
  if (tier === "verified")
    return (
      <Badge tone="primary">
        <BadgeCheck className="size-3.5" /> מאומת
      </Badge>
    );
  if (tier === "unverified")
    return (
      <Badge tone="sun">
        <CircleAlert className="size-3.5" /> לא מאומת
      </Badge>
    );
  return (
    <Badge tone="muted">
      <CircleHelp className="size-3.5" /> אין מידע
    </Badge>
  );
}

const KIND_EMOJI: Record<KosherPlace["kind"], string> = {
  restaurant: "🍽️",
  shop: "🛒",
  synagogue: "🕍",
  other: "📍",
};

function SourceLink({ url, label }: { url: string; label: string }) {
  if (!isSafeHttpUrl(url)) return <span>{label}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {label}
    </a>
  );
}

function CuratedRow({ item }: { item: CuratedKosherItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">{item.title}</span>
        <KosherTierBadge tier={item.tier} />
      </div>
      <p className={open ? "mt-1 text-sm" : "mt-1 line-clamp-3 text-sm"}>{item.content}</p>
      {!open && item.content.length > 160 && (
        <button onClick={() => setOpen(true)} className="text-xs font-semibold text-primary">
          עוד
        </button>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {item.label} · <SourceLink url={item.source_url} label="למקור" />
      </p>
    </li>
  );
}

function PlaceRow({ place }: { place: KosherPlace }) {
  return (
    <li className="flex items-start gap-2 py-2">
      <span className="text-lg leading-6">{KIND_EMOJI[place.kind]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold">{place.name}</span>
          {/* A synagogue isn't a kashrut claim — just say where it came from. */}
          {place.kind === "synagogue" ? <Badge tone="muted">מהמפה</Badge> : <KosherTierBadge tier={place.tier} />}
        </div>
        {place.address && <div className="text-xs text-muted-foreground">{place.address}</div>}
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {place.distance_km} ק״מ ממרכז היעד · מקור: <SourceLink url={place.source_url} label={place.source_label} />
          {place.osm_diet === "only" && " · מסומן במפה ככשר בלבד"}
          {place.osm_diet === "yes" && " · מסומן במפה עם אפשרויות כשרות"}
          {place.checked_on && ` · נבדק במפה ${place.checked_on}`}
        </div>
        <MapLink url={place.maps_url} className="mt-1" />
      </div>
    </li>
  );
}

/**
 * Kosher food near the destination, with every result's trust tier visible.
 * Searched on a button press (not on every visit): the place search can
 * spend Google quota. The live search links stay as the "אין מידע" fallback.
 */
export function KosherPanel({ trip }: { trip: Trip }) {
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KosherLookup | null>(null);
  const [failed, setFailed] = useState(false);

  const search = async () => {
    setLoading(true);
    setFailed(false);
    setResult(null);
    const res = await lookupKosher(trip.id, { city: city.trim() });
    setLoading(false);
    setResult(res);
    setFailed(!res);
  };

  const place = result?.place || city.trim() || trip.destination;
  const verified = result?.curated.filter((c) => c.tier === "verified") ?? [];
  const staleCurated = result?.curated.filter((c) => c.tier === "unverified") ?? [];
  const nothing = result && !result.curated.length && !result.places.length && !result.synagogues.length;
  const showsOsm = !!result && [...result.places, ...result.synagogues].some((p) => p.source === "osm");

  return (
    <Card className="mb-3 p-3">
      <div className="mb-1.5 text-sm font-bold">🍽️ אוכל כשר ליד {place}</div>

      <div className="flex gap-2">
        <Input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={`עיר אחרת? (ברירת מחדל: ${trip.destination})`}
          className="h-9 flex-1 text-sm"
        />
        <Button size="sm" variant="soft" loading={loading} onClick={search}>
          {!loading && <Search className="size-4" />}
          חיפוש
        </Button>
      </div>

      {failed && <p className="mt-2 text-sm text-destructive">החיפוש נכשל. אפשר לנסות שוב, או להשתמש בקישורים למטה.</p>}

      {result?.too_wide && (
        <p className="mt-2 text-sm">
          "{result.place}" רחב מדי לחיפוש סביב נקודה אחת. כתבו עיר ספציפית בשדה למעלה.
        </p>
      )}
      {result && !result.point && !result.curated.length && (
        <p className="mt-2 text-sm">לא הצלחנו לאתר את "{result.place}" במפה. נסו לכתוב שם עיר.</p>
      )}

      {verified.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {verified.map((c) => (
            <CuratedRow key={c.title} item={c} />
          ))}
        </ul>
      )}

      {(staleCurated.length > 0 || (result?.places.length ?? 0) > 0) && (
        <>
          <p className="mt-3 flex items-center gap-1 rounded-xl bg-muted px-2.5 py-1.5 text-xs font-semibold">
            <CircleAlert className="size-3.5 shrink-0" />
            {KOSHER_TIER_TEXT.unverified}. סימון במפה אינו תעודת כשרות.
          </p>
          <ul className="divide-y divide-border">
            {staleCurated.map((c) => (
              <CuratedRow key={c.title} item={c} />
            ))}
            {result?.places.map((p) => (
              <PlaceRow key={`${p.source}:${p.source_url}`} place={p} />
            ))}
          </ul>
        </>
      )}

      {(result?.synagogues.length ?? 0) > 0 && (
        <>
          <div className="mt-3 text-xs font-bold">בתי כנסת במפה</div>
          <ul className="divide-y divide-border">
            {result?.synagogues.map((p) => (
              <PlaceRow key={`${p.source}:${p.source_url}`} place={p} />
            ))}
          </ul>
        </>
      )}

      {nothing && result?.point && !result.too_wide && !result.osm_failed && (
        <div className="mt-2 flex items-start gap-2 text-sm">
          <KosherTierBadge tier="none" />
          <span>לא מצאנו מקומות כשרים מסומנים ליד {result.place}. כדאי לחפש בקישורים למטה ולפנות לבית חב״ד.</span>
        </div>
      )}

      {result?.google === "cap" && (
        <p className="mt-2 text-[11px] text-muted-foreground">חיפוש Google הגיע למכסה, מוצגות תוצאות OpenStreetMap בלבד.</p>
      )}
      {result?.osm_failed && (
        <p className="mt-2 text-[11px] text-muted-foreground">חיפוש המפה לא זמין כרגע, ולכן לא ניתן היה לבדוק. נסו שוב בעוד כמה דקות.</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <LinkChip url={result?.search_links.kosher ?? kosherSearchUrl(place)} label="חיפוש חי במפות" />
        <LinkChip url={result?.search_links.chabad ?? chabadSearchUrl(place)} label="בית חב״ד" />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        רק מידע מאומת מוצג ככזה. כל מקום אחר — יש לוודא תעודת השגחה במקום או מול בית חב״ד המקומי.
        {showsOsm && " נתוני מפה © תורמי OpenStreetMap."}
      </p>
    </Card>
  );
}
