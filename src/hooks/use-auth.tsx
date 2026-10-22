import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { dropBrowserSubscription, releaseForeignSubscription, unsubscribeOnSignOut } from "@/lib/push";
import type { AppRole, Profile } from "@/lib/types";

type AuthState = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  /** Profile and roles have loaded for the current user. `loading` turns false
   *  as soon as the session is known, a beat before the roles arrive — so a
   *  role gate (AgentRoute) must wait for this, or it bounces a real agent. */
  rolesReady: boolean;
  /** The roles query failed twice; `rolesReady` stays false. Retry with refreshProfile(). */
  rolesError: boolean;
  isAgent: boolean;
  isAdmin: boolean;
  /** A "try it yourself" demo session (anonymous sign-in, migration 016). */
  isAnonymous: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
    fullName: string,
    returnTo?: string,
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  /** `returnTo` is an in-app path (e.g. /join/:token) to land on after Google. */
  signInWithGoogle: (returnTo?: string) => Promise<{ error: string | null }>;
  /** Emails a recovery link that lands on /reset-password with a session. */
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({} as AuthState);

/** Only same-app absolute paths ("/join/abc"), never "//evil.com" or a full URL. */
export function safeReturnPath(path?: string | null): string {
  return path && /^\/(?!\/)[\w\-./]*$/.test(path) ? path : "/";
}

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
  if (m.includes("different from the old")) return "הסיסמה החדשה חייבת להיות שונה מהקודמת.";
  if (m.includes("rate limit")) return "יותר מדי ניסיונות. נסה שוב עוד רגע.";
  return message || "אירעה שגיאה. נסה שוב.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesReady, setRolesReady] = useState(false);
  const [rolesError, setRolesError] = useState(false);
  // Whose profile/roles the state holds (or is loading). A different user's
  // session must never see the previous user's roles, even for a beat.
  const loadedFor = useRef<string | null>(null);

  const clearProfileAndRoles = useCallback(() => {
    loadedFor.current = null;
    setProfile(null);
    setRoles([]);
    setRolesReady(false);
    setRolesError(false);
  }, []);

  /** Synchronously forget the previous user's profile/roles when the session belongs to someone else. */
  const switchTo = useCallback(
    (userId: string) => {
      if (loadedFor.current === userId) return;
      clearProfileAndRoles();
      loadedFor.current = userId;
    },
    [clearProfileAndRoles],
  );

  const loadProfileAndRoles = useCallback(async (userId: string) => {
    switchTo(userId);
    setRolesError(false);
    // One retry: a failed roles query must not read as "not an agent".
    for (let attempt = 0; attempt < 2; attempt++) {
      const [{ data: prof, error: profError }, { data: roleRows, error }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);
      if (loadedFor.current !== userId) return; // someone else signed in meanwhile
      if (!profError) setProfile((prof as Profile | null) ?? null);
      if (!error) {
        setRoles(((roleRows as { role: AppRole }[]) ?? []).map((r) => r.role));
        setRolesReady(true);
        return;
      }
      console.error(error);
    }
    setRolesError(true);
  }, [switchTo]);

  useEffect(() => {
    let active = true;
    // Whether the last known session was a real (non-demo) user's.
    let hadRealUser = false;
    const track = (s: Session | null) => {
      hadRealUser = !!s?.user && !s.user.is_anonymous;
    };

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      // A real user's session ended — our signOut() (already cleaned up, so
      // this is a no-op), or token expiry/revocation, or another tab. Stop this
      // browser's pushes. Not after a demo session: it never subscribed, and
      // the subscription may be a real user's.
      if (!next && hadRealUser) void dropBrowserSubscription();
      track(next);
      setSession(next);
      if (next?.user) {
        // Same render as the new session: no beat where user B carries user A's roles.
        switchTo(next.user.id);
        // defer to avoid deadlocks inside the auth callback
        setTimeout(() => loadProfileAndRoles(next.user.id), 0);
      } else {
        clearProfileAndRoles();
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!active) return;
      track(current);
      setSession(current);
      if (current?.user) loadProfileAndRoles(current.user.id);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [clearProfileAndRoles, loadProfileAndRoles, switchTo]);

  // A push subscription this browser holds for another account is dropped on
  // sign-in, never taken over: the new user opts in again from Settings.
  const pushUserId = session?.user && !session.user.is_anonymous ? session.user.id : null;
  useEffect(() => {
    if (pushUserId) void releaseForeignSubscription();
  }, [pushUserId]);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    profile,
    roles,
    loading,
    rolesReady,
    rolesError,
    isAgent: roles.includes("agent") || roles.includes("admin"),
    isAdmin: roles.includes("admin"),
    isAnonymous: session?.user?.is_anonymous === true,
    signInWithPassword: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? heError(error.message) : null };
    },
    signUpWithPassword: async (email, password, fullName, returnTo) => {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}${safeReturnPath(returnTo)}`,
        },
      });
      if (error) return { error: heError(error.message), needsConfirmation: false };
      // If email confirmation is required, there is no active session yet.
      const needsConfirmation = !signUpData.session;
      return { error: null, needsConfirmation };
    },
    signInWithGoogle: async (returnTo) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${safeReturnPath(returnTo)}` },
      });
      return { error: error ? heError(error.message) : null };
    },
    requestPasswordReset: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error: error ? heError(error.message) : null };
    },
    updatePassword: async (password) => {
      const { error } = await supabase.auth.updateUser({ password });
      return { error: error ? heError(error.message) : null };
    },
    refreshProfile: async () => {
      if (session?.user) await loadProfileAndRoles(session.user.id);
    },
    signOut: async () => {
      // One browser, two accounts: the next one must not get this one's pushes.
      // Needs the session (RLS), so it runs first; time-boxed, never blocks.
      // A demo session never subscribed; unsubscribing it would kill the real user's browser subscription.
      const { data: { session: current } } = await supabase.auth.getSession();
      if (!current?.user?.is_anonymous) await unsubscribeOnSignOut();
      await supabase.auth.signOut();
      clearProfileAndRoles();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
