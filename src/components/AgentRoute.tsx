import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button, EmptyState, FullSpinner } from "@/components/ui";

/** /agent screens: signed-in, approved travel agents (or admins). Everyone else goes home.
 *  Only hides the screens — agent_trip_board() and RLS are the real gate. */
export function AgentRoute({ children }: { children: ReactNode }) {
  const { session, loading, rolesReady, rolesError, isAgent, refreshProfile } = useAuth();
  // Roles that failed to load are unknown, not "not an agent": offer a retry instead of bouncing.
  if (session && rolesError)
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
  if (loading || (session && !rolesReady)) return <FullSpinner label="רגע, טוענים…" />;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAgent) return <Navigate to="/" replace />;
  return <>{children}</>;
}
