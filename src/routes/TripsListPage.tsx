import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Settings, Sparkles, Wand2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { createDemoTrip } from "@/lib/demo-trip";
import type { Trip } from "@/lib/types";
import { BrandLogo } from "@/components/BrandLogo";
import { Button, EmptyState, FullSpinner } from "@/components/ui";
import { TripCard } from "@/components/TripCard";

export default function TripsListPage() {
  const { profile, isAgent, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [trips, setTrips] = useState<Trip[]>([]);
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
      // Filter by user_id explicitly: RLS alone is not enough here. The
      // "shared trips readable" policy also grants SELECT to `authenticated`,
      // and permissive policies are OR'd — so without this every signed-in user
      // would see everyone else's publicly shared trips in their own list.
      const { data } = await supabase
        .from("trips")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_template", false)
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      setTrips((data as Trip[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  const firstName = (profile?.full_name ?? "").split(" ")[0];

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-5">
      <header className="mb-6 flex items-center justify-between">
        <BrandLogo />
        <Link
          to="/settings"
          className="grid size-11 place-items-center rounded-2xl border border-border bg-card text-foreground shadow-soft"
          aria-label="הגדרות"
        >
          <Settings className="size-5" />
        </Link>
      </header>

      <div className="mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {firstName ? `היי ${firstName} 👋` : "הטיולים שלי"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAgent ? "מרחב הסוכן שלך — נהל את הטיולים של הלקוחות." : "כל ההרפתקאות שלך במקום אחד."}
        </p>
      </div>

      {loading ? (
        <FullSpinner />
      ) : trips.length === 0 ? (
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
        <div className="flex flex-col gap-3.5">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}

      {/* Floating create button */}
      {trips.length > 0 && (
        <button
          onClick={() => navigate("/new")}
          className="safe-bottom fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-accent px-6 py-4 font-bold text-accent-foreground shadow-pop transition active:scale-95"
        >
          <Plus className="size-5" />
          טיול חדש
        </button>
      )}
    </div>
  );
}
