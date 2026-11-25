import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { syncAnalytics } from "@/lib/analytics";

/** Renders nothing: keeps the analytics trackers on only for the screens that allow them. */
export function AnalyticsRouteGuard() {
  const { pathname, search, hash } = useLocation();
  const { session } = useAuth();
  const signedIn = !!session;
  useEffect(() => {
    syncAnalytics({ pathname, search, hash }, signedIn);
  }, [pathname, search, hash, signedIn]);
  return null;
}
