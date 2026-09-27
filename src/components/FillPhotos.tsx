import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fillMissingPhotos } from "@/lib/photos";
import { Button, Card } from "@/components/ui";

/**
 * "Some places have no photo — find them" bar for editors. Shown only when
 * something is missing; runs the Wikipedia photo lookup for each (see
 * fillMissingPhotos) and reloads the screen.
 */
export function FillPhotos({
  tripId,
  destination,
  missing,
  onDone,
}: {
  tripId: string;
  destination: string;
  missing: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (missing === 0) return null;

  const run = async () => {
    setBusy(true);
    const filled = await fillMissingPhotos(tripId, destination);
    setBusy(false);
    if (filled === 0) toast.error("לא נמצאו תמונות חדשות. למקומות בלי ערך בוויקיפדיה אין תמונה אמיתית.");
    else toast.success(`נוספו ${filled} תמונות 🖼️`);
    onDone();
  };

  return (
    <Card className="mb-3 flex items-center gap-3 p-3">
      <ImagePlus className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-sm">
        {missing === 1 ? "למקום אחד אין תמונה" : `ל-${missing} מקומות אין תמונה`}
      </div>
      <Button size="sm" variant="soft" loading={busy} onClick={run}>
        השלמת תמונות
      </Button>
    </Card>
  );
}
