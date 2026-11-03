import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useShareEnglish } from "@/hooks/use-share-english";

/**
 * Footer row linking every legal page — used on the auth, settings, share and
 * legal pages. Lives apart from LegalPages so those (lazy-loaded) pages stay
 * out of the first bundle.
 */
export function LegalLinks({ className }: { className?: string }) {
  // On the English share page the labels are English; the pages stay Hebrew.
  const en = useShareEnglish()?.legal;
  const links = [
    { to: "/terms", label: en?.terms ?? "תנאי שימוש" },
    { to: "/privacy", label: en?.privacy ?? "מדיניות פרטיות" },
    { to: "/accessibility", label: en?.accessibility ?? "הצהרת נגישות" },
    { to: "/credits", label: en?.credits ?? "קרדיטים ורישיונות" },
  ];
  return (
    <nav className={cn("flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="underline underline-offset-2 hover:text-foreground">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
