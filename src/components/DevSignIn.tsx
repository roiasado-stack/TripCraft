import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui";

// One-tap sign-in as the LOCAL break-ui fixture user, so a phone on the Wi-Fi
// preview doesn't need the password typed. Rendered only in `--mode localstack`
// (stripped from production builds). Must match scripts/seed-break-ui.mjs.
const FIXTURE_EMAIL = "breakui@test.local";
const FIXTURE_PASSWORD = "breakui-local-only-7f3k";

export function DevSignIn() {
  const { signInWithPassword } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="lg"
      className="mt-2 w-full"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const { error } = await signInWithPassword(FIXTURE_EMAIL, FIXTURE_PASSWORD);
        setBusy(false);
        if (error) toast.error("הכניסה נכשלה — הרץ node scripts/seed-break-ui.mjs");
      }}
    >
      <FlaskConical className="size-5" />
      כניסה כמשתמש בדיקה (מקומי)
    </Button>
  );
}
