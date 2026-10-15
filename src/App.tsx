import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/hooks/use-theme";
import { ToastProvider } from "@/hooks/use-toast";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AgentRoute } from "@/components/AgentRoute";
import { SetupNeeded } from "@/components/SetupNeeded";
import AuthPage from "@/routes/AuthPage";
import ResetPasswordPage from "@/routes/ResetPasswordPage";
import TripsListPage from "@/routes/TripsListPage";
import WizardPage from "@/routes/WizardPage";
import SettingsPage from "@/routes/SettingsPage";
import AdminMonitoringPage from "@/routes/AdminMonitoringPage";
import AdminAgentsPage from "@/routes/AdminAgentsPage";
import AgentPage from "@/routes/AgentPage";
import AgentNewTripPage from "@/routes/AgentNewTripPage";
import AgentSendPage from "@/routes/AgentSendPage";
import SharePage from "@/routes/SharePage";
import JoinPage from "@/routes/JoinPage";
import { AccessibilityPage, CreditsPage, PrivacyPage, TermsPage } from "@/routes/LegalPages";
import TripLayout from "@/routes/trip/TripLayout";
import HomeTab from "@/routes/trip/HomeTab";
import PeopleTab from "@/routes/trip/PeopleTab";
import TransportTab from "@/routes/trip/TransportTab";
import ItineraryTab from "@/routes/trip/ItineraryTab";
import SuggestionsTab from "@/routes/trip/SuggestionsTab";
import AskTab from "@/routes/trip/AskTab";
import DocumentsTab from "@/routes/trip/DocumentsTab";
import ChecklistTab from "@/routes/trip/ChecklistTab";

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
                  path="/agent"
                  element={
                    <AgentRoute>
                      <AgentPage />
                    </AgentRoute>
                  }
                />
                <Route
                  path="/agent/new"
                  element={
                    <AgentRoute>
                      <AgentNewTripPage />
                    </AgentRoute>
                  }
                />
                <Route
                  path="/agent/send/:tripId"
                  element={
                    <AgentRoute>
                      <AgentSendPage />
                    </AgentRoute>
                  }
                />
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
