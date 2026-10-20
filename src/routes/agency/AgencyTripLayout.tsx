import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { Participant, Trip, TripRole } from "@/lib/types";
import { can } from "@/lib/permissions";
import { Button, EmptyState, Spinner } from "@/components/ui";
import type { TripContext } from "@/routes/trip/TripLayout";

/**
 * /agency/trips/:tripId (agency workspace, phase 2): loads the trip the same
 * way TripLayout does and hands the same TripContext to its children, so the
 * agent screen can reuse the traveller tabs' editors (TransportTab,
 * DocumentsTab) without their page chrome. Owner only — the screen is the
 * agent's back office for a trip they created; members keep /trip/:id.
 */
export default function AgencyTripLayout() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // By id: a token refresh hands out a new user object, and must not reload (and reset) the screen.
  const userId = user?.id;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [role, setRole] = useState<TripRole | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "forbidden">("loading");

  // A reload that finishes after the agent moved to another trip must not swap the old one back in.
  const currentTripId = useRef(tripId);
  currentTripId.current = tripId;

  const reloadTrip = async () => {
    const id = tripId;
    if (!id) return;
    const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
    if (data && currentTripId.current === id) setTrip(data as Trip);
  };

  const reloadParticipants = async () => {
    const id = tripId;
    if (!id) return;
    const { data } = await supabase.from("participants").select("*").eq("trip_id", id).order("created_at");
    if (currentTripId.current === id) setParticipants((data as Participant[]) ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tripId || !userId) return;
      setState("loading");
      // RLS returns the trip to its owner and active members only (015).
      const [{ data, error }, { data: tripRole }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.rpc("trip_role", { _trip_id: tripId }),
      ]);
      if (cancelled) return;
      if (error || !data || !tripRole) {
        setState("notfound");
        return;
      }
      if (!can(tripRole as TripRole, "manage")) {
        setState("forbidden");
        return;
      }
      setTrip(data as Trip);
      setRole(tripRole as TripRole);
      await reloadParticipants();
      if (!cancelled) setState("ready");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, userId]);

  if (state === "loading")
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  if (state !== "ready" || !trip || !role)
    return (
      <div className="mx-auto max-w-lg px-4 pt-16">
        <EmptyState
          emoji="🧭"
          title={state === "forbidden" ? "אין גישה לטיול הזה" : "הטיול לא נמצא"}
          description={
            state === "forbidden" ? "רק מי שיצר את הטיול מנהל אותו כאן." : "ייתכן שנמחק או שאין לכם גישה אליו."
          }
          action={<Button onClick={() => navigate("/agency")}>לטיולים</Button>}
        />
      </div>
    );

  const ctx: TripContext = {
    trip,
    role,
    participants,
    reloadParticipants,
    reloadTrip,
    // The agency screen has its own send panel; the traveller share sheet isn't part of it.
    openShare: () => navigate(`/agency/trips/${trip.id}/send`),
  };
  return <Outlet context={ctx} />;
}
