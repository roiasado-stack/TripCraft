import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, Plus, Settings, Sparkles, Wand2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { createDemoTrip } from "@/lib/demo-trip";
import type { MemberRole, Trip, TripRole } from "@/lib/types";
import { Button, EmptyState, FullSpinner, GroupedList, ListRow } from "@/components/ui";
import { TripCard } from "@/components/TripCard";
import { parseLocalDate, tripPhase, type TripPhase } from "@/lib/trip-dates";

export default function TripsListPage() {
  const { profile, isAgent, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [shared, setShared] = useState<{ trip: Trip; role: MemberRole }[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const seedDemo = async () => {
    if (!user) return;
    setSeeding(true);
    try {
      const id = await createDemoTrip(user.id);
      toast.success("נוצר טיול לדוגמה 🏝️");
      navigate(`/trip/${id}`);
    } catch (e) {
      console.error(e);
      toast.error("יצירת הדוגמה נכשלה. נסה שוב.");
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (!user) return;
      // Own trips by user_id; trips shared with me come through my memberships
      // (RLS hides a pending member's trip, so those only count here).
      const [{ data }, { data: memberships }] = await Promise.all([
        supabase
          .from("trips")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_template", false)
          .order("start_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase.from("trip_members").select("role, status, trips(*)").eq("user_id", user.id),
      ]);
      setTrips((data as Trip[]) ?? []);
      const rows = (memberships as unknown as { role: MemberRole; status: string; trips: Trip | null }[]) ?? [];
      setShared(rows.filter((m) => m.status === "active" && m.trips).map((m) => ({ trip: m.trips as Trip, role: m.role })));
      setPendingCount(rows.filter((m) => m.status === "pending").length);
      setLoading(false);
    })();
  }, [user]);

  const firstName = (profile?.full_name ?? "").split(" ")[0];
  const hasTrips = trips.length > 0 || shared.length > 0;

  // One list, grouped the way people think about trips: on now, coming up, done.
  const today = new Date();
  const time = (d: string | null) => parseLocalDate(d)?.getTime() ?? null;
  const groups: Record<TripPhase, { trip: Trip; role: TripRole }[]> = { now: [], upcoming: [], past: [] };
  for (const item of [...trips.map((trip) => ({ trip, role: "owner" as TripRole })), ...shared])
    groups[tripPhase(item.trip, today)].push(item);
  // Soonest first; undated trips (still being planned) after the dated ones.
  const bySoonest = (a: { trip: Trip }, b: { trip: Trip }) =>
    (time(a.trip.start_date) ?? Infinity) - (time(b.trip.start_date) ?? Infinity);
  groups.now.sort(bySoonest);
  groups.upcoming.sort(bySoonest);
  // Most recent first.
  groups.past.sort(
    (a, b) =>
      (time(b.trip.end_date ?? b.trip.start_date) ?? 0) - (time(a.trip.end_date ?? a.trip.start_date) ?? 0),
  );
  const sections: [TripPhase, string][] = [
    ["now", "עכשיו"],
    ["upcoming", "בקרוב"],
    ["past", "עברו"],
  ];

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-32 pt-4">
      <header className="mb-1 flex justify-end">
        <Link
          to="/settings"
          className="grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          aria-label="הגדרות"
        >
          <Settings className="size-6" />
        </Link>
      </header>

      <div className="mb-6 px-1">
        {firstName && <p className="type-footnote font-semibold text-muted-foreground">היי {firstName}</p>}
        <h1 className="type-large-title">{isAgent ? "הטיולים של הלקוחות" : "הטיולים שלי"}</h1>
      </div>

      {pendingCount > 0 && (
        <GroupedList className="mb-6">
          <ListRow
            leading={<Clock className="size-5 text-primary" />}
            title={pendingCount === 1 ? "הזמנה אחת ממתינה" : `${pendingCount} הזמנות ממתינות`}
            subtitle="לאישור של בעל הטיול"
          />
        </GroupedList>
      )}

      {loading ? (
        <FullSpinner />
      ) : !hasTrips ? (
        <div className="mt-8">
          <EmptyState
            emoji="🧳"
            title="עדיין אין טיולים"
            description="בוא ניצור את הטיול הראשון שלך — האשף החכם ידריך אותך שלב-אחר-שלב."
            action={
              <div className="flex flex-col items-center gap-2">
                <Button size="lg" onClick={() => navigate("/new")}>
                  <Sparkles className="size-5" />
                  יצירת טיול חדש
                </Button>
                <Button variant="ghost" loading={seeding} onClick={seedDemo}>
                  <Wand2 className="size-4" />
                  צור טיול לדוגמה (להתרשמות)
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {sections.map(
            ([phase, title]) =>
              groups[phase].length > 0 && (
                <GroupedList key={phase} title={title}>
                  {groups[phase].map(({ trip, role }) => (
                    <TripCard
                      key={trip.id}
                      trip={trip}
                      role={role}
                      today={today}
                      onDeleted={(id) => setTrips((prev) => prev.filter((t) => t.id !== id))}
                    />
                  ))}
                </GroupedList>
              ),
          )}
        </div>
      )}

      {hasTrips && (
        <div className="material safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-separator">
          <div className="mx-auto max-w-lg px-4 pt-3">
            <Button size="lg" className="pressable w-full" onClick={() => navigate("/new")}>
              <Plus className="size-5" />
              טיול חדש
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
