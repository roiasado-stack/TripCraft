import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { CalendarDays, CheckSquare, FileText, Home, MapPinned } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { Participant, Trip } from "@/lib/types";
import { Button, FullSpinner } from "@/components/ui";
import { ShareSheet } from "@/components/ShareSheet";
import { cn } from "@/lib/utils";

export type TripContext = {
  trip: Trip;
  participants: Participant[];
  reloadParticipants: () => Promise<void>;
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
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [shareOpen, setShareOpen] = useState(false);

  const reloadParticipants = async () => {
    if (!tripId) return;
    const { data } = await supabase.from("participants").select("*").eq("trip_id", tripId).order("created_at");
    setParticipants((data as Participant[]) ?? []);
  };

  useEffect(() => {
    (async () => {
      if (!tripId || !user) return;
      // Same reason as the list query: "shared trips readable" also covers
      // `authenticated`, so a plain lookup by id would open the full owner UI
      // for anyone else's shared trip. Visitors belong on /share/:slug.
      const { data, error } = await supabase
        .from("trips")
        .select("*")
        .eq("id", tripId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !data) {
        setState("notfound");
        return;
      }
      setTrip(data as Trip);
      await reloadParticipants();
      setState("ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, user]);

  if (state === "loading") return <FullSpinner label="טוען את הטיול…" />;
  if (state === "notfound" || !trip)
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
    participants,
    reloadParticipants,
    openShare: () => setShareOpen(true),
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      <Outlet context={ctx} />

      <ShareSheet
        trip={trip}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onChange={(patch) => setTrip((t) => (t ? { ...t, ...patch } : t))}
      />

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className="flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5"
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        "grid place-items-center rounded-xl px-4 py-1 transition",
                        isActive ? "bg-primary-soft text-primary" : "text-muted-foreground",
                      )}
                    >
                      <Icon className="size-[22px]" strokeWidth={isActive ? 2.5 : 2} />
                    </span>
                    <span className={cn("text-[11px] font-semibold", isActive ? "text-primary" : "text-muted-foreground")}>
                      {t.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
