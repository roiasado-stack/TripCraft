import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { parseTripQuota, type TripQuota } from "@/lib/trip-quota";

/**
 * The caller's private trip quota (`my_trip_quota`, migration 029), so a screen can say
 * "one trip" before the wizard instead of after a document scan. `undefined` while loading,
 * `null` when unknown (no user, or the call failed): screens don't block on null — the
 * trips trigger is the real gate.
 */
export function useTripQuota() {
  const { user } = useAuth();
  const userId = user?.id;
  const [quota, setQuota] = useState<TripQuota | null | undefined>(undefined);

  const reload = useCallback(async () => {
    if (!userId) {
      setQuota(null);
      return;
    }
    const { data, error } = await supabase.rpc("my_trip_quota");
    setQuota(error ? null : parseTripQuota(data));
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { quota, reload };
}
