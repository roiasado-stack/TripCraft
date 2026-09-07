import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Gauge, LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Button, Card, Field, Input } from "@/components/ui";

export default function SettingsPage() {
  const { user, profile, roles, isAgent, isAdmin, refreshProfile, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [agencyName, setAgencyName] = useState(profile?.agency_name ?? "");
  const [agencyColor, setAgencyColor] = useState(profile?.agency_color ?? "#12b3b0");
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    await supabase
      .from("profiles")
      .update({ full_name: fullName || null, agency_name: agencyName || null, agency_color: agencyColor })
      .eq("id", user.id);
    await refreshProfile();
    setSaving(false);
    toast.success("נשמר ✓");
  };

  const roleLabel = roles.includes("admin") ? "מנהל" : roles.includes("agent") ? "סוכן נסיעות" : "מטייל";

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-5">
      <header className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="grid size-10 place-items-center rounded-2xl border border-border bg-card" aria-label="חזרה">
          <ChevronRight className="size-5" />
        </button>
        <h1 className="text-xl font-extrabold">הגדרות</h1>
      </header>

      {/* account */}
      <Card className="mb-4 p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-gradient-sunset text-2xl font-bold text-white">
            {(fullName || user?.email || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-bold">{fullName || "משתמש"}</div>
            <div className="truncate text-sm text-muted-foreground" dir="ltr">
              {user?.email}
            </div>
            <span className="mt-1 inline-block rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
              {roleLabel}
            </span>
          </div>
        </div>
        <Field label="שם מלא">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
      </Card>

      {/* agent branding */}
      {isAgent && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 font-bold">🏢 מיתוג סוכנות</h2>
          <p className="mb-3 text-sm text-muted-foreground">המיתוג יופיע בקישורי השיתוף שתשלח ללקוחות.</p>
          <div className="flex flex-col gap-3">
            <Field label="שם הסוכנות">
              <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} />
            </Field>
            <Field label="צבע מותג">
              <div className="flex items-center gap-3">
                <input type="color" value={agencyColor} onChange={(e) => setAgencyColor(e.target.value)} className="size-12 rounded-xl border border-border" />
                <span dir="ltr" className="font-mono text-sm">
                  {agencyColor}
                </span>
              </div>
            </Field>
          </div>
        </Card>
      )}

      <Button className="mb-4 w-full" size="lg" loading={saving} onClick={saveProfile}>
        שמירת פרופיל
      </Button>

      {/* appearance */}
      <Card className="mb-4 flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          {theme === "dark" ? <Moon className="size-5 text-primary" /> : <Sun className="size-5 text-primary" />}
          <div>
            <div className="font-semibold">מצב כהה</div>
            <div className="text-xs text-muted-foreground">נוח יותר לעיניים בלילה</div>
          </div>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={theme === "dark"}
          className={`relative h-7 w-12 rounded-full transition ${theme === "dark" ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${theme === "dark" ? "left-0.5" : "right-0.5"}`} />
        </button>
      </Card>

      {isAdmin && (
        <Button variant="outline" size="lg" className="mb-4 w-full" onClick={() => navigate("/admin/monitoring")}>
          <Gauge className="size-5" />
          מוניטורינג
        </Button>
      )}

      <Button variant="outline" size="lg" className="w-full text-destructive" onClick={async () => { await signOut(); navigate("/auth", { replace: true }); }}>
        <LogOut className="size-5" />
        התנתקות
      </Button>

      <p className="mt-6 text-center text-xs text-muted-foreground">TripCraft · גרסה 0.1</p>
    </div>
  );
}
