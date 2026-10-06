import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Dev-only switch between today's palette and the candidate Apple-style ones
// (`.palette-neutral`, plus `.palette-premium` for "חדש+", in styles.css), so
// Roi can compare them on his phone on any screen. Rendered only in
// `--mode localstack`; remembered per device.
const KEY = "tc-palette-preview";
type Palette = "current" | "neutral" | "premium";

const OPTIONS: { value: Palette; label: string }[] = [
  { value: "current", label: "נוכחי" },
  { value: "neutral", label: "חדש" },
  { value: "premium", label: "חדש+" },
];

function readStored(): Palette {
  try {
    const v = localStorage.getItem(KEY);
    return v === "neutral" || v === "premium" ? v : "current";
  } catch {
    return "current";
  }
}

export function DevPaletteToggle() {
  const [palette, setPalette] = useState<Palette>(readStored);

  useEffect(() => {
    const root = document.documentElement.classList;
    root.toggle("palette-neutral", palette !== "current");
    root.toggle("palette-premium", palette === "premium");
    try {
      localStorage.setItem(KEY, palette);
    } catch {
      // private mode / blocked storage — the switch still works for this visit
    }
  }, [palette]);

  return (
    <div className="fixed bottom-36 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-muted p-0.5 text-[11px] shadow-soft">
      <span className="px-2 text-muted-foreground">צבעים:</span>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setPalette(o.value)}
          className={cn(
            "whitespace-nowrap rounded-full px-3 py-1",
            palette === o.value ? "bg-card font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
