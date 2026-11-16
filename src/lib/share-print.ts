/**
 * PDF export of the public share page (plan docs/plans/2026-11-15-abada-promises.md,
 * phase 2): the browser's own "Save as PDF", styled by the print rules on the page.
 * The agency's "PDF ללקוח" opens `/share/<slug>?print=1`, which prints by itself
 * once the trip is on screen.
 */

/** `?print=1` asks the share page to open the print dialog once it has loaded. */
export function isPrintRequest(search: string): boolean {
  return new URLSearchParams(search).get("print") === "1";
}

/**
 * Print now? Only when asked, only on a loaded trip (never the spinner or the
 * "not available" page), and only once per page load.
 */
export function shouldAutoPrint({
  search,
  state,
  printed,
}: {
  search: string;
  state: "loading" | "ready" | "notfound";
  printed: boolean;
}): boolean {
  return !printed && state === "ready" && isPrintRequest(search);
}

/** The share page opened for printing. Empty without a slug (the trip was never shared). */
export function sharePrintUrl(origin: string, slug: string | null | undefined): string {
  return slug ? `${origin}/share/${encodeURIComponent(slug)}?print=1` : "";
}

/**
 * Resolves once the page is ready to print: every image loaded or failed (capped,
 * so one slow photo can't hold the dialog forever), web fonts in, and a frame painted.
 * DOM-only; the decision of whether to print lives in shouldAutoPrint.
 */
export async function settleForPrint(maxImageWaitMs = 8000): Promise<void> {
  const pending = [...document.images].filter((img) => !img.complete);
  const images = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await Promise.race([images, new Promise((resolve) => setTimeout(resolve, maxImageWaitMs))]);
  await document.fonts?.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
