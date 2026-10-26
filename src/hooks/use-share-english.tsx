import { createContext, useContext } from "react";
import { SHARE_EN } from "@/lib/share-english";

/**
 * Set by SharePage when the page is English (`?lang=en`). Components that also
 * render there read it and fall back to their inline Hebrew when it's null,
 * which is always the case everywhere else in the app.
 */
export const ShareEnglishContext = createContext<typeof SHARE_EN | null>(null);

export function useShareEnglish() {
  return useContext(ShareEnglishContext);
}
