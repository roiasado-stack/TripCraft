import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { FullSpinner } from "@/components/ui";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <FullSpinner label="רגע, טוענים…" />;
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}
