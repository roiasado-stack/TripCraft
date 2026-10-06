import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Dev-only switch between today's palette and the candidate Apple-style one
// (`.palette-neutral` in styles.css), so Roi can compare them on his phone on
// any screen. Rendered only in `--mode localstack`; remembered per device.
const KEY = "tc-palette-preview";

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "neutral";
  } catch {
    return false;
  }
}

export function DevPaletteToggle() {
  const [neutral, setNeutral] = useState(readStored);

  useEffect(() => {
    document.documentElement.classList.toggle("palette-neutral", neutral);
    try {
      localStorage.setItem(KEY, neutral ? "neutral" : "current");
    } catch {
      // private mode / blocked storage — the switch still works for this visit
    }
  }, [neutral]);

  return (
    <div
      dir="ltr"
      className="fixed bottom-36 left-1/2 z-30 flex -translate-x-1/2 gap-0.5 rounded-full bg-muted p-0.5 font-[system-ui] text-[11px] shadow-soft"
    >
      {[
        { on: false, label: "צבעים: נוכחי" },
        { on: true, label: "צבעים: חדש" },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => setNeutral(o.on)}
          className={cn(
            "whitespace-nowrap rounded-full px-3 py-1",
            neutral === o.on ? "bg-card font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
