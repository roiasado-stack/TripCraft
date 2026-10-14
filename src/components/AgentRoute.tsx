import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { FullSpinner } from "@/components/ui";

/** /agent screens: signed-in, approved travel agents (or admins). Everyone else goes home.
 *  Only hides the screens — agent_trip_board() and RLS are the real gate. */
export function AgentRoute({ children }: { children: ReactNode }) {
  const { session, loading, rolesReady, isAgent } = useAuth();
  if (loading || (session && !rolesReady)) return <FullSpinner label="רגע, טוענים…" />;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAgent) return <Navigate to="/" replace />;
  return <>{children}</>;
}
