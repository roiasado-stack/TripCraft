import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Gauge, LogOut, Moon, Sun, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Button, Field, GroupedList, Input, ListRow, Modal, Switch } from "@/components/ui";
import { DOCS_BUCKET } from "@/lib/documents";
import { LegalLinks } from "@/routes/LegalPages";

const DELETE_CONFIRM_WORD = "מחיקה";

export default function SettingsPage() {
  const { user, profile, roles, isAgent, isAdmin, refreshProfile, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [agencyName, setAgencyName] = useState(profile?.agency_name ?? "");
  const [agencyColor, setAgencyColor] = useState(profile?.agency_color ?? "#12b3b0");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Right to erasure. Files go first: storage can't be cleared from SQL, and
  // once delete_my_account() (migration 013) runs there's no session left to
  // do it with. The RPC then deletes trips (cascading to everything under
  // them), usage rows, roles, profile and the auth user.
  const deleteAccount = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      const bucket = supabase.storage.from(DOCS_BUCKET);
      const paths: string[] = [];
      const { data: top, error: listErr } = await bucket.list(user.id, { limit: 1000 });
      if (listErr) throw listErr;
      for (const entry of top ?? []) {
        const path = `${user.id}/${entry.name}`;
        if (entry.id) {
          paths.push(path);
          continue;
        }
        // Folders (one per trip) come back with a null id.
        const { data: files, error } = await bucket.list(path, { limit: 1000 });
        if (error) throw error;
        for (const f of files ?? []) paths.push(`${path}/${f.name}`);
      }
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await bucket.remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw error;
      await signOut();
      toast.success("החשבון וכל המידע נמחקו. להתראות 👋");
      navigate("/auth", { replace: true });
    } catch {
      toast.error("המחיקה נכשלה. נסו שוב או פנו אלינו.");
      setDeleting(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName || null, agency_name: agencyName || null, agency_color: agencyColor })
      .eq("id", user.id);
    if (error) {
      setSaving(false);
      toast.error("השמירה נכשלה");
      return;
    }
    await refreshProfile();
    setSaving(false);
    toast.success("נשמר ✓");
  };

  const roleLabel = roles.includes("admin") ? "מנהל" : roles.includes("agent") ? "סוכן נסיעות" : "מטייל";

  const fieldRow = "flex min-h-12 items-center gap-3 px-4";
  const fieldInput = "type-body min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-muted-foreground";

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-5">
      <header className="mb-5">
        <button
          onClick={() => navigate("/")}
          className="-ms-2 grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          aria-label="חזרה"
        >
          <ChevronRight className="size-6" />
        </button>
        <h1 className="type-large-title mt-1">הגדרות</h1>
      </header>

      <div className="flex flex-col gap-6">
        {/* account */}
        <GroupedList>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-sunset text-2xl font-bold text-white">
              {(Array.from((fullName || user?.email || "?").trim())[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="type-headline truncate">
                <bdi>{fullName || "משתמש"}</bdi>
              </div>
              <div className="type-footnote truncate text-muted-foreground" dir="ltr">
                {user?.email}
              </div>
              <span className="type-footnote mt-0.5 inline-block font-semibold text-primary">{roleLabel}</span>
            </div>
          </div>
          <label className={fieldRow}>
            <span className="type-body w-24 shrink-0">שם מלא</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="השם שלך" className={fieldInput} />
          </label>
        </GroupedList>

        {/* agent branding */}
        {isAgent && (
          <GroupedList title="מיתוג סוכנות">
            <label className={fieldRow}>
              <span className="type-body w-24 shrink-0">שם הסוכנות</span>
              <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="לא חובה" className={fieldInput} />
            </label>
            <label className={fieldRow}>
              <span className="type-body w-24 shrink-0">צבע מותג</span>
              <span dir="ltr" className="type-footnote min-w-0 flex-1 text-end font-mono text-muted-foreground">
                {agencyColor}
              </span>
              <input
                type="color"
                value={agencyColor}
                onChange={(e) => setAgencyColor(e.target.value)}
                className="size-9 shrink-0 cursor-pointer rounded-lg border border-border"
              />
            </label>
          </GroupedList>
        )}
        {isAgent && (
          <p className="type-footnote -mt-4 px-4 text-muted-foreground">המיתוג יופיע בקישורי השיתוף שתשלח ללקוחות.</p>
        )}

        <Button className="w-full" size="lg" loading={saving} onClick={saveProfile}>
          שמירת פרופיל
        </Button>

        {/* appearance */}
        <GroupedList title="תצוגה">
          <div className={fieldRow}>
            {theme === "dark" ? <Moon className="size-5 shrink-0 text-primary" /> : <Sun className="size-5 shrink-0 text-primary" />}
            <div className="min-w-0 flex-1 py-2.5">
              <div className="type-body">מצב כהה</div>
              <div className="type-footnote text-muted-foreground">נוח יותר לעיניים בלילה</div>
            </div>
            <Switch checked={theme === "dark"} onChange={toggle} label="מצב כהה" />
          </div>
        </GroupedList>

        {isAdmin && (
          <GroupedList>
            <ListRow to="/admin/monitoring" leading={<Gauge className="size-5 text-primary" />} title="מוניטורינג" />
          </GroupedList>
        )}

        <GroupedList>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate("/auth", { replace: true });
            }}
            className="type-body flex min-h-12 w-full items-center gap-3 px-4 text-start text-destructive transition-colors active:bg-muted/70"
          >
            <LogOut className="size-5" />
            התנתקות
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteOpen(true);
            }}
            className="type-body flex min-h-12 w-full items-center gap-3 px-4 text-start text-destructive transition-colors active:bg-muted/70"
          >
            <Trash2 className="size-5" />
            מחיקת החשבון
          </button>
        </GroupedList>
      </div>

      <LegalLinks className="mt-8" />
      <p className="type-footnote mt-3 text-center text-muted-foreground">TripCraft · גרסה 0.1</p>

      <Modal
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        title="מחיקת החשבון"
        footer={
          <>
            <Button variant="ghost" className="flex-1" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              loading={deleting}
              disabled={deleteConfirm.trim() !== DELETE_CONFIRM_WORD}
              onClick={deleteAccount}
            >
              מחיקה לצמיתות
            </Button>
          </>
        }
      >
        <p className="type-footnote mb-3 text-muted-foreground">
          כל הטיולים, המשתתפים, המסמכים שהועלו, הצ'אטים וקישורי השיתוף יימחקו לצמיתות. אי אפשר לבטל את הפעולה.
        </p>
        <Field label={`כדי לאשר, הקלידו "${DELETE_CONFIRM_WORD}"`}>
          <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
