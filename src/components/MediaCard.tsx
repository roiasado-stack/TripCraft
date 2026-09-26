import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * upload.wikimedia.org image → its file description page, where the author and
 * license are listed. Photos come from Wikipedia under CC licenses that
 * require attribution; linking each image to that page is how we give it
 * (see /credits). Null for anything that isn't a Wikimedia upload.
 */
export function wikimediaFilePage(url?: string | null): string | null {
  const m = (url ?? "").match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/([a-z-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/);
  if (!m) return null;
  const host = m[1] === "commons" ? "commons.wikimedia.org" : `${m[1]}.wikipedia.org`;
  return `https://${host}/wiki/File:${m[2]}`;
}

/** Small ⓘ in the image corner linking to the photo's author/license page. */
function ImageCredit({ imageUrl, compact }: { imageUrl: string; compact?: boolean }) {
  const page = wikimediaFilePage(imageUrl);
  if (!page) return null;
  return (
    <a
      href={page}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label="מקור התמונה ורישיון (ויקיפדיה)"
      title="מקור התמונה ורישיון (ויקיפדיה)"
      className={cn(
        "absolute start-1 top-1 grid place-items-center rounded-full bg-black/45 text-white",
        compact ? "size-4" : "size-6",
      )}
    >
      <Info className={compact ? "size-3" : "size-3.5"} />
    </a>
  );
}

type Gradient = "sea" | "sunset" | "surf";

const gradientClass: Record<Gradient, string> = {
  sea: "bg-gradient-sea",
  sunset: "bg-gradient-sunset",
  surf: "bg-gradient-surf",
};

/**
 * Fallback treatment shared by both variants when there's no image: the same
 * brand-gradient-plus-icon look as PhotoAlbumCard, just resized per variant.
 */
function Fallback({ gradient, icon }: { gradient: Gradient; icon: ReactNode }) {
  return (
    <div className={cn("grid size-full place-items-center text-white", gradientClass[gradient])}>
      {icon}
    </div>
  );
}

/**
 * Full-width hero cover image for the top of a Card — suggestions, itinerary
 * days, anything that wants a big photo. Falls back to a brand-gradient tile
 * with the existing icon when `imageUrl` is empty. `children` (e.g. a title)
 * renders anchored to the bottom over a dark gradient for legibility on top
 * of a photo; `cornerSlot` floats a chip in the top-start corner (kind badge,
 * like/remove button, etc.) — both work in RTL since they're positioned with
 * logical `start-`/`end-` utilities, not `left-`/`right-`.
 */
export function CardCoverImage({
  imageUrl,
  alt,
  icon,
  gradient = "sea",
  className,
  cornerSlot,
  children,
}: {
  imageUrl?: string | null;
  alt: string;
  icon: ReactNode;
  gradient?: Gradient;
  className?: string;
  cornerSlot?: ReactNode;
  children?: ReactNode;
}) {
  const hasImage = !!imageUrl;
  return (
    // No photo yet? Keep the fallback compact — a full 16:9 hero of empty
    // gradient just for one centered icon reads as wasted space; a short
    // banner still gives the kind badge room without pretending there's a
    // photo there.
    <div className={cn("relative w-full overflow-hidden rounded-t-3xl", hasImage ? "aspect-[16/9]" : "h-20", className)}>
      {hasImage ? (
        <img src={imageUrl!} alt={alt} className="size-full object-cover" loading="lazy" />
      ) : (
        <Fallback gradient={gradient} icon={icon} />
      )}
      {hasImage && <ImageCredit imageUrl={imageUrl!} />}
      {/* Bottom gradient: dark-to-transparent works for legible light text on
          top of any photo (or the brand gradient) in both light and dark mode. */}
      {(hasImage || children) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      )}
      {cornerSlot && <div className="absolute end-3 top-3">{cornerSlot}</div>}
      {children && <div className="absolute inset-x-0 bottom-0 p-3 text-white">{children}</div>}
    </div>
  );
}

/**
 * Compact thumbnail that stands in for the small emoji tiles used in flat
 * list rows (suggestions/itinerary cards) — same footprint, same rounded
 * treatment, just with an optional real photo. Pass `size`/`rounded` to
 * match whatever tile it's replacing (e.g. `size-10 rounded-xl` for
 * itinerary, `size-11 rounded-2xl` for suggestions).
 */
export function CardThumbnail({
  imageUrl,
  alt,
  icon,
  gradient = "sea",
  size = "size-11",
  rounded = "rounded-2xl",
  className,
}: {
  imageUrl?: string | null;
  alt: string;
  icon: ReactNode;
  gradient?: Gradient;
  size?: string;
  rounded?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden", size, rounded, className)}>
      {imageUrl ? (
        <img src={imageUrl} alt={alt} className="size-full object-cover" loading="lazy" />
      ) : (
        <Fallback gradient={gradient} icon={icon} />
      )}
      {imageUrl && <ImageCredit imageUrl={imageUrl} compact />}
    </div>
  );
}
