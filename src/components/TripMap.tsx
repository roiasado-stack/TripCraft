import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";

export type TripMapItem = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  /** Marker badge number, in the order the caller wants pins numbered. */
  number?: number;
};

/**
 * A numbered circular badge, built as raw HTML (Leaflet mounts divIcons
 * outside React's tree, so JSX/Tailwind classes can't reach them at
 * runtime) — but it still reads the page's live CSS custom properties,
 * which keeps it theme-reactive (light/dark) without a hardcoded hex.
 */
function numberedIcon(n: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:30px;height:30px;border-radius:9999px;
      background:var(--primary);color:var(--primary-foreground);
      font-family:var(--font-sans, sans-serif);font-weight:700;font-size:13px;
      box-shadow:0 4px 10px -3px rgb(0 0 0 / 0.45);
      border:2px solid var(--card);
    ">${n}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

/** Fits the map to the given items on mount and whenever they change.
 *  react-leaflet's <MapContainer> doesn't expose its map instance to the
 *  parent directly, so this small child component reaches it via useMap(). */
function FitBounds({ items }: { items: TripMapItem[] }) {
  const map = useMap();
  useEffect(() => {
    if (items.length === 0) return;
    if (items.length === 1) {
      map.setView([items[0].lat, items[0].lng], 14);
      return;
    }
    const bounds = L.latLngBounds(items.map((i) => [i.lat, i.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  return null;
}

export function TripMap({ items, className }: { items: TripMapItem[]; className?: string }) {
  if (items.length === 0) return null;
  const center: [number, number] = [items[0].lat, items[0].lng];

  return (
    <div
      dir="ltr"
      className={cn(
        "trip-map h-72 overflow-hidden rounded-3xl border border-border shadow-soft sm:h-80",
        className,
      )}
    >
      <MapContainer center={center} zoom={13} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          className="trip-map-tiles"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds items={items} />
        {items.map((it, idx) => (
          <Marker key={it.id} position={[it.lat, it.lng]} icon={numberedIcon(it.number ?? idx + 1)}>
            <Popup>
              <div dir="rtl">
                <div className="font-bold">{it.title}</div>
                {it.subtitle && <div className="text-sm text-muted-foreground">{it.subtitle}</div>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
