import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";

// Dev-only switch between the break-ui fixture trips seeded by
// scripts/seed-break-ui.mjs. Rendered only in `--mode localstack`, so it never
// reaches a production build. The trip id in the URL is the state.
const FIXTURES = [
  { id: "b4ea0000-0000-4000-8000-000000000001", label: "Demo" },
  { id: "b4ea0000-0000-4000-8000-000000000002", label: "Worst case" },
  { id: "b4ea0000-0000-4000-8000-000000000003", label: "Empty" },
  { id: "b4ea0000-0000-4000-8000-000000000004", label: "One" },
  { id: "b4ea0000-0000-4000-8000-000000000005", label: "Huge" },
];

export function BreakUiToggle() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  return (
    <div
      dir="ltr"
      className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 rounded-full bg-muted p-0.5 font-[system-ui] text-[11px] shadow-soft"
    >
      {FIXTURES.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => navigate(`/trip/${f.id}`)}
          className={cn(
            "whitespace-nowrap rounded-full px-2.5 py-1",
            tripId === f.id ? "bg-card font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
