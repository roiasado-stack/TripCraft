import { BrandLogo } from "@/components/BrandLogo";
import { Card } from "@/components/ui";

export function SetupNeeded() {
  return (
    <div className="min-h-screen bg-gradient-surf px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <BrandLogo size="lg" />
        <Card className="p-6">
          <h1 className="text-xl font-bold">כמעט מוכן! ✨</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            צריך לחבר את האפליקציה למסד הנתונים שלך ב-Supabase. זה חינמי ולוקח כ-3 דקות:
          </p>
          <ol className="mt-4 space-y-3 text-sm">
            {[
              ["פתיחת פרויקט", "היכנס ל-supabase.com → New project. בחר שם וסיסמת דאטהבייס, ואזור קרוב (למשל Frankfurt)."],
              ["הרצת הסכימה", "ב-SQL Editor הדבק את הקובץ supabase/schema.sql מהפרויקט והרץ. זה בונה את כל הטבלאות, ההרשאות והאבטחה."],
              ["חיבור המפתחות", "ב-Project Settings → API העתק את ה-URL ואת מפתח ה-anon/publishable, והדבק אותם בקובץ .env (ראה .env.example)."],
              ["הפעלה מחדש", "עצור והרץ שוב npm run dev — והאפליקציה תתחבר אוטומטית."],
            ].map(([t, d], i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <div>
                  <div className="font-semibold">{t}</div>
                  <div className="text-muted-foreground">{d}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-2xl bg-muted p-3 text-xs text-muted-foreground">
            כל ההוראות המלאות נמצאות בקובץ <span className="font-mono font-semibold">README.md</span>.
          </div>
        </Card>
      </div>
    </div>
  );
}
