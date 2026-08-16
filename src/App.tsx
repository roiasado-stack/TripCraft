import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { ToastProvider } from "@/hooks/use-toast";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SetupNeeded } from "@/components/SetupNeeded";
import AuthPage from "@/routes/AuthPage";
import TripsListPage from "@/routes/TripsListPage";
import WizardPage from "@/routes/WizardPage";
import SettingsPage from "@/routes/SettingsPage";
import SharePage from "@/routes/SharePage";
import TripLayout from "@/routes/trip/TripLayout";
import HomeTab from "@/routes/trip/HomeTab";
import ItineraryTab from "@/routes/trip/ItineraryTab";
import SuggestionsTab from "@/routes/trip/SuggestionsTab";
import DocumentsTab from "@/routes/trip/DocumentsTab";
import ChecklistTab from "@/routes/trip/ChecklistTab";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        {isSupabaseConfigured ? (
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/share/:slug" element={<SharePage />} />

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
                  path="/trip/:tripId"
                  element={
                    <ProtectedRoute>
                      <TripLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<HomeTab />} />
                  <Route path="itinerary" element={<ItineraryTab />} />
                  <Route path="suggestions" element={<SuggestionsTab />} />
                  <Route path="documents" element={<DocumentsTab />} />
                  <Route path="checklist" element={<ChecklistTab />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        ) : (
          <SetupNeeded />
        )}
      </ToastProvider>
    </ThemeProvider>
  );
}
