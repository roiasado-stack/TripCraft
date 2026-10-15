import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { FullSpinner } from "@/components/ui";
import { RolesLoadError } from "@/components/AgentRoute";

export function AdminRoute({ children }: { children: ReactNode }) {
  const { session, loading, rolesReady, rolesError, isAdmin } = useAuth();
  // Wait for roles: on a direct load, `loading` ends before roles arrive and isAdmin is still false.
  if (session && rolesError && !rolesReady) return <RolesLoadError />;
  if (loading || (session && !rolesReady)) return <FullSpinner label="רגע, טוענים…" />;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
