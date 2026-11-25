import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PartyPopper, Share2 } from "lucide-react";
import { Button } from "@/components/ui";
import { track } from "@/lib/analytics";
import { can } from "@/lib/permissions";
import { useTrip } from "@/routes/trip/TripLayout";

/**
 * Shown once, right after an account's first trip is created (the wizard routes here).
 * Its job: get the trip in front of the co-travellers — the share sheet is the existing
 * invite flow, so nothing new is stored here.
 */
export default function TripCreatedPage() {
  const { trip, role, openShare } = useTrip();
  const navigate = useNavigate();

  // The conversion the landing funnel measures. Name + a flag only, never trip content.
  useEffect(() => {
    track("trip_created", { first_trip: true });
  }, []);

  return (
    <div className="px-6 pt-20 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-primary-soft text-primary">
        <PartyPopper className="size-8" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight">הטיול נוצר!</h1>
      <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-muted-foreground">
        מזמינים בני משפחה וחברים בקישור. כל אחד רואה את הטיול בטלפון שלו, לפי ההרשאה שקיבל.
      </p>
      <div className="mx-auto mt-8 flex max-w-xs flex-col gap-3">
        {can(role, "manage") && (
          <Button size="lg" onClick={openShare}>
            <Share2 className="size-5" />
            שתפו עם שותפים לטיול
          </Button>
        )}
        <Button size="lg" variant="outline" onClick={() => navigate(`/trip/${trip.id}`, { replace: true })}>
          המשך לטיול
        </Button>
      </div>
    </div>
  );
}
