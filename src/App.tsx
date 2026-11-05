import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/hooks/use-theme";
import { ToastProvider } from "@/hooks/use-toast";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AgentRoute } from "@/components/AgentRoute";
import { SetupNeeded } from "@/components/SetupNeeded";
import { FullSpinner } from "@/components/ui";
// First paint stays in the main bundle: the login screen, the trips list and
// the public share page (anonymous visitors). Everything else loads per route.
import AuthPage from "@/routes/AuthPage";
import TripsListPage from "@/routes/TripsListPage";
import SharePage from "@/routes/SharePage";

const ResetPasswordPage = lazy(() => import("@/routes/ResetPasswordPage"));
const WizardPage = lazy(() => import("@/routes/WizardPage"));
const SettingsPage = lazy(() => import("@/routes/SettingsPage"));
const AdminMonitoringPage = lazy(() => import("@/routes/AdminMonitoringPage"));
const AdminAgentsPage = lazy(() => import("@/routes/AdminAgentsPage"));
const AgentPage = lazy(() => import("@/routes/AgentPage"));
const AgentNewTripPage = lazy(() => import("@/routes/AgentNewTripPage"));
const AgentSendPage = lazy(() => import("@/routes/AgentSendPage"));
const AgencyLayout = lazy(() => import("@/routes/agency/AgencyLayout"));
const AgencyTripLayout = lazy(() => import("@/routes/agency/AgencyTripLayout"));
const AgencyTripPage = lazy(() => import("@/routes/agency/AgencyTripPage"));
const AgencyRequestsPage = lazy(() => import("@/routes/agency/AgencyRequestsPage"));
const JoinPage = lazy(() => import("@/routes/JoinPage"));
const TermsPage = lazy(() => import("@/routes/LegalPages").then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import("@/routes/LegalPages").then((m) => ({ default: m.PrivacyPage })));
const CreditsPage = lazy(() => import("@/routes/LegalPages").then((m) => ({ default: m.CreditsPage })));
const AccessibilityPage = lazy(() => import("@/routes/LegalPages").then((m) => ({ default: m.AccessibilityPage })));
const TripLayout = lazy(() => import("@/routes/trip/TripLayout"));
const HomeTab = lazy(() => import("@/routes/trip/HomeTab"));
const PeopleTab = lazy(() => import("@/routes/trip/PeopleTab"));
const TransportTab = lazy(() => import("@/routes/trip/TransportTab"));
const ItineraryTab = lazy(() => import("@/routes/trip/ItineraryTab"));
const SuggestionsTab = lazy(() => import("@/routes/trip/SuggestionsTab"));
const AskTab = lazy(() => import("@/routes/trip/AskTab"));
const DocumentsTab = lazy(() => import("@/routes/trip/DocumentsTab"));
const ChecklistTab = lazy(() => import("@/routes/trip/ChecklistTab"));

function LegacySendRedirect() {
  const { tripId } = useParams();
  return <Navigate to={`/agency/trips/${tripId}/send`} replace />;
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-6xl">🧭</div>
      <h1 className="text-xl font-extrabold">הדף לא נמצא</h1>
      <p className="text-sm text-muted-foreground">ייתכן שהקישור שגוי או שהדף הוסר.</p>
      <Link to="/" className="mt-2 h-12 rounded-2xl bg-primary px-5 leading-[3rem] font-semibold text-primary-foreground">
        חזרה לטיולים
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        {isSupabaseConfigured ? (
          <ErrorBoundary>
            <AuthProvider>
              <BrowserRouter>
              <Suspense fallback={<FullSpinner label="טוען…" />}>
              <Routes>
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/share/:slug" element={<SharePage />} />
                <Route path="/join/:token" element={<JoinPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/credits" element={<CreditsPage />} />
                <Route path="/accessibility" element={<AccessibilityPage />} />

                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <TripsListPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/new"
                  element={
                    <ProtectedRoute>
                      <WizardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/agency"
                  element={
                    <AgentRoute>
                      <AgencyLayout />
                    </AgentRoute>
                  }
                >
                  <Route index element={<AgentPage />} />
                  <Route path="new" element={<AgentNewTripPage />} />
                  <Route path="requests" element={<AgencyRequestsPage />} />
                  <Route path="trips/:tripId" element={<AgencyTripLayout />}>
                    <Route index element={<AgencyTripPage />} />
                  </Route>
                  <Route path="trips/:tripId/send" element={<AgentSendPage />} />
                </Route>
                {/* The workspace moved from /agent: links already sent out keep working. */}
                <Route path="/agent" element={<Navigate to="/agency" replace />} />
                <Route path="/agent/new" element={<Navigate to="/agency/new" replace />} />
                <Route path="/agent/send/:tripId" element={<LegacySendRedirect />} />
                <Route
                  path="/admin/monitoring"
                  element={
                    <AdminRoute>
                      <AdminMonitoringPage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="/admin/agents"
                  element={
                    <AdminRoute>
                      <AdminAgentsPage />
                    </AdminRoute>
                  }
                />

                <Route
                  path="/trip/:tripId"
                  element={
                    <ProtectedRoute>
                      <TripLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<HomeTab />} />
                  <Route path="people" element={<PeopleTab />} />
                  <Route path="transport" element={<TransportTab />} />
                  <Route path="itinerary" element={<ItineraryTab />} />
                  <Route path="suggestions" element={<SuggestionsTab />} />
                  <Route path="ask" element={<AskTab />} />
                  <Route path="documents" element={<DocumentsTab />} />
                  <Route path="checklist" element={<ChecklistTab />} />
                </Route>

                <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              </BrowserRouter>
            </AuthProvider>
          </ErrorBoundary>
        ) : (
          <SetupNeeded />
        )}
      </ToastProvider>
    </ThemeProvider>
  );
}
