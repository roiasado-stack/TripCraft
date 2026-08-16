import { cn } from "@/lib/utils";

export function BrandLogo({
  size = "md",
  withText = true,
  className,
}: {
  size?: "sm" | "md" | "lg";
  withText?: boolean;
  className?: string;
}) {
  const box = size === "lg" ? "size-14 text-3xl" : size === "sm" ? "size-9 text-lg" : "size-11 text-2xl";
  const title = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className={cn(
          "grid place-items-center rounded-2xl bg-gradient-sunset shadow-pop",
          box,
        )}
      >
        <span>🌴</span>
      </div>
      {withText && (
        <div className="leading-tight">
          <div className={cn("font-extrabold tracking-tight", title)}>
            Trip<span className="text-primary">Craft</span>
          </div>
          {size !== "sm" && (
            <div className="text-xs font-medium text-muted-foreground">מלווה הטיולים שלך</div>
          )}
        </div>
      )}
    </div>
  );
}
