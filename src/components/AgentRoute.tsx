import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button, EmptyState, FullSpinner } from "@/components/ui";

/** Shown by role-gated routes when the first roles load failed. */
export function RolesLoadError() {
  const { refreshProfile } = useAuth();
  return (
    <div className="mx-auto max-w-lg px-4 pt-16">
      <EmptyState
        emoji="🧭"
        title="לא הצלחנו לטעון את החשבון"
        description="בדקו את החיבור לאינטרנט ונסו שוב."
        action={<Button onClick={() => void refreshProfile()}>נסו שוב</Button>}
      />
    </div>
  );
}

/** /agency screens: signed-in, approved travel agents (or admins). Everyone else goes home.
 *  Only hides the screens — agent_trip_board() and RLS are the real gate. */
export function AgentRoute({ children }: { children: ReactNode }) {
  const { session, loading, rolesReady, rolesError, isAgent } = useAuth();
  // Roles that failed to load are unknown, not "not an agent": offer a retry instead of bouncing.
  // A failed background reload keeps the roles already loaded, so the open screen isn't lost.
  if (session && rolesError && !rolesReady) return <RolesLoadError />;
  if (loading || (session && !rolesReady)) return <FullSpinner label="רגע, טוענים…" />;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAgent) return <Navigate to="/" replace />;
  return <>{children}</>;
}
