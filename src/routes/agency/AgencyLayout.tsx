import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Briefcase, FilePlus2, LayoutList, LogOut, Menu, Settings, ShieldCheck, Smartphone, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { isAgencyLogoUrl } from "@/lib/agency-brand";
import { agencyLogoPrefix } from "@/components/AgencyLogoField";
import { cn } from "@/lib/utils";

/**
 * The agency workspace frame (agency workspace, phase 1): its own side menu
 * and nothing from the traveller app. Desktop first — a fixed menu at the
 * start (right, RTL) and a wide work area; on a phone, a top bar whose menu
 * button opens the same menu as a drawer. AgentRoute gates it in App.tsx.
 */
export default function AgencyLayout() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [requestedAgency, setRequestedAgency] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // By user_id: an admin can read every agent's row.
    supabase
      .from("agent_accounts")
      .select("agency_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setRequestedAgency((data as { agency_name: string } | null)?.agency_name ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // A tap on a menu item closes the drawer.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // The admin-approved name first: it is the one the brochure shows (023).
  const agency = requestedAgency?.trim() || profile?.agency_name?.trim() || "סביבת הסוכן";
  const logo = isAgencyLogoUrl(profile?.agency_logo_url, agencyLogoPrefix()) ? profile?.agency_logo_url : null;

  const brand = (
    <div className="flex min-w-0 items-center gap-3">
      {logo ? (
        <img src={logo} alt="" className="size-9 shrink-0 rounded-xl bg-card object-contain" />
      ) : (
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Briefcase className="size-5" aria-hidden />
        </div>
      )}
      <div className="min-w-0">
        <div className="type-headline truncate [unicode-bidi:plaintext]">{agency}</div>
        <div className="type-footnote text-muted-foreground">TripCraft לסוכנים</div>
      </div>
    </div>
  );

  const nav = (
    <nav className="flex flex-1 flex-col gap-1" aria-label="תפריט הסוכן">
      <MenuLink to="/agency" end icon={<LayoutList className="size-5" />} label="הטיולים" />
      <MenuLink to="/agency/new" icon={<FilePlus2 className="size-5" />} label="טיול חדש מהמסמכים" />
      {isAdmin && <MenuLink to="/admin/agents" icon={<ShieldCheck className="size-5" />} label="ניהול סוכנים" />}
      <div className="mt-auto flex flex-col gap-1 border-t border-separator pt-3">
        <MenuLink to="/settings" icon={<Settings className="size-5" />} label="הגדרות ומיתוג" />
        <MenuLink to="/" icon={<Smartphone className="size-5" />} label="לאפליקציית הטיולים" />
        <button type="button" onClick={() => void signOut()} className={cn(menuItem, "text-muted-foreground")}>
          <LogOut className="size-5" />
          יציאה
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-background lg:flex">
      {/* Desktop: a fixed side menu at the start. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 border-e border-separator bg-card px-3 py-5 lg:flex">
        <Link to="/agency" className="px-2">
          {brand}
        </Link>
        {nav}
      </aside>

      {/* Phone: a top bar and the same menu as a drawer. */}
      <header className="material sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-separator px-4 py-2 lg:hidden">
        <Link to="/agency" className="min-w-0">
          {brand}
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="-me-2 grid size-11 shrink-0 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          aria-label="תפריט"
          aria-expanded={menuOpen}
        >
          <Menu className="size-6" />
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="תפריט הסוכן">
          <button type="button" className="absolute inset-0 bg-foreground/30" onClick={() => setMenuOpen(false)} aria-label="סגירת התפריט" />
          <div className="safe-bottom absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-6 bg-card px-3 py-4 shadow-xl">
            <div className="flex items-center justify-between gap-2 ps-2">
              {brand}
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                aria-label="סגירת התפריט"
              >
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

const menuItem =
  "type-body flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-start transition-colors hover:bg-muted active:bg-muted/70";

function MenuLink({ to, end, icon, label }: { to: string; end?: boolean; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(menuItem, isActive ? "bg-primary/10 font-semibold text-primary" : "text-foreground")}
    >
      {icon}
      {label}
    </NavLink>
  );
}
