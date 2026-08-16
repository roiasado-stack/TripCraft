import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { AppRole, Profile } from "@/lib/types";

type AuthState = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  isAgent: boolean;
  isAdmin: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({} as AuthState);

/** Translate common Supabase auth errors to friendly Hebrew. */
function heError(message?: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login")) return "אימייל או סיסמה שגויים.";
  if (m.includes("email not confirmed")) return "יש לאשר קודם את המייל שנשלח אליך.";
  if (m.includes("user already registered")) return "כתובת המייל כבר רשומה. נסה להתחבר.";
  if (m.includes("password should be at least")) return "הסיסמה חייבת להכיל לפחות 6 תווים.";
  if (m.includes("weak") && m.includes("password"))
    return "הסיסמה חלשה מדי או דלפה בעבר. בחר סיסמה חזקה יותר.";
  if (m.includes("unable to validate email")) return "כתובת המייל אינה תקינה.";
  if (m.includes("provider is not enabled") || m.includes("not enabled"))
    return "ההתחברות דרך Google אינה מופעלת עדיין. נסה מייל וסיסמה.";
  if (m.includes("rate limit")) return "יותר מדי ניסיונות. נסה שוב עוד רגע.";
  return message || "אירעה שגיאה. נסה שוב.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfileAndRoles = async (userId: string) => {
    const [{ data: prof }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setProfile((prof as Profile | null) ?? null);
    setRoles(((roleRows as { role: AppRole }[]) ?? []).map((r) => r.role));
  };

  useEffect(() => {
    let active = true;

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      if (next?.user) {
        // defer to avoid deadlocks inside the auth callback
        setTimeout(() => loadProfileAndRoles(next.user.id), 0);
      } else {
        setProfile(null);
        setRoles([]);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!active) return;
      setSession(current);
      if (current?.user) loadProfileAndRoles(current.user.id);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    profile,
    roles,
    loading,
    isAgent: roles.includes("agent") || roles.includes("admin"),
    isAdmin: roles.includes("admin"),
    signInWithPassword: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? heError(error.message) : null };
    },
    signUpWithPassword: async (email, password, fullName) => {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) return { error: heError(error.message), needsConfirmation: false };
      // If email confirmation is required, there is no active session yet.
      const needsConfirmation = !signUpData.session;
      return { error: null, needsConfirmation };
    },
    signInWithGoogle: async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      });
      return { error: error ? heError(error.message) : null };
    },
    refreshProfile: async () => {
      if (session?.user) await loadProfileAndRoles(session.user.id);
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
      setRoles([]);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
