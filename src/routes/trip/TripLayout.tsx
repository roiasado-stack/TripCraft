import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { CalendarDays, CheckSquare, FileText, Home, MapPinned } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { Participant, Trip, TripRole } from "@/lib/types";
import { Button, FullSpinner } from "@/components/ui";
import { ShareSheet } from "@/components/ShareSheet";
import { BreakUiToggle } from "@/components/BreakUiToggle";
import { cn } from "@/lib/utils";

export type TripContext = {
  trip: Trip;
  /** Caller's role on this trip — gate controls with `can()` from @/lib/permissions. */
  role: TripRole;
  participants: Participant[];
  reloadParticipants: () => Promise<void>;
  /** Re-read the trip row after writing to it (e.g. the hero photo). */
  reloadTrip: () => Promise<void>;
  openShare: () => void;
};

export function useTrip() {
  return useOutletContext<TripContext>();
}

const TABS = [
  { to: "", icon: Home, label: "בית", end: true },
  { to: "itinerary", icon: CalendarDays, label: "מסלול", end: false },
  { to: "suggestions", icon: MapPinned, label: "מומלצים", end: false },
  { to: "documents", icon: FileText, label: "מסמכים", end: false },
  { to: "checklist", icon: CheckSquare, label: "צ'קליסט", end: false },
];

export default function TripLayout() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { user, isAnonymous } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [role, setRole] = useState<TripRole | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [shareOpen, setShareOpen] = useState(false);

  // The trip currently on screen. A reload that finishes after the user moved to
  // another trip (e.g. right after "duplicate") must not swap the old one back in.
  const currentTripId = useRef(tripId);
  currentTripId.current = tripId;
  const reloadTrip = async () => {
    const id = tripId;
    if (!id) return;
    const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
    if (data && currentTripId.current === id) setTrip(data as Trip);
  };

  const reloadParticipants = async () => {
    if (!tripId) return;
    const { data } = await supabase.from("participants").select("*").eq("trip_id", tripId).order("created_at");
    setParticipants((data as Participant[]) ?? []);
  };

  useEffect(() => {
    (async () => {
      if (!tripId || !user) return;
      // RLS returns the trip to its owner and active members only (migration
      // 015); the role decides which controls each screen shows.
      const [{ data, error }, { data: tripRole }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.rpc("trip_role", { _trip_id: tripId }),
      ]);
      if (error || !data || !tripRole) {
        setState("notfound");
        return;
      }
      setTrip(data as Trip);
      setRole(tripRole as TripRole);
      await reloadParticipants();
      setState("ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, user]);

  if (state === "loading") return <FullSpinner label="טוען את הטיול…" />;
  if (state === "notfound" || !trip || !role)
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-5xl">🧭</div>
        <h2 className="text-lg font-bold">הטיול לא נמצא</h2>
        <p className="text-sm text-muted-foreground">ייתכן שנמחק או שאין לך גישה אליו.</p>
        <Button onClick={() => navigate("/")}>חזרה לטיולים</Button>
      </div>
    );

  const ctx: TripContext = {
    trip,
    role,
    participants,
    reloadParticipants,
    reloadTrip,
    openShare: () => setShareOpen(true),
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      {isAnonymous && (
        // Scrolls away with the page: the trip header pins to the top instead.
        <div className="bg-sun px-4 py-2 text-center text-xs font-semibold text-sun-foreground">
          מצב דמו: זה עותק אישי שלכם, ואפשר לשנות בו הכול. הוא יימחק אוטומטית אחרי 7 ימים.
        </div>
      )}
      <Outlet context={ctx} />
      {import.meta.env.MODE === "localstack" && <BreakUiToggle />}

      <ShareSheet
        trip={trip}
        role={role}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onChange={(patch) => setTrip((t) => (t ? { ...t, ...patch } : t))}
      />

      <nav className="material safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-separator">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className="flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1"
              >
                {({ isActive }) => (
                  <span
                    className={cn(
                      "flex flex-col items-center gap-0.5 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="size-6" strokeWidth={isActive ? 2.25 : 1.75} />
                    <span className={cn("text-[11px]", isActive ? "font-semibold" : "font-medium")}>{t.label}</span>
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
