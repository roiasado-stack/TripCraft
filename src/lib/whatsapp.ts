// wa.me links for sending a trip to a client from the agent's own phone.
// No WhatsApp API: the link opens WhatsApp with the message ready to send.

/**
 * A phone number as typed → the digits wa.me wants (country code, no "+",
 * no leading zero), or null when it can't be one. Israeli local numbers
 * (050-1234567, 03-1234567) become 972…; "+", "00" and "972" prefixes are
 * kept as international, including the "+972 (0)50…" habit.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let d = trimmed.replace(/\D/g, "");
  if (!d) return null;
  if (trimmed.startsWith("+")) {
    // already international
  } else if (d.startsWith("00")) {
    d = d.slice(2);
  } else if (d.startsWith("0")) {
    d = `972${d.slice(1)}`;
  } else if (/^5\d{8}$/.test(d)) {
    d = `972${d}`; // an Israeli mobile typed without its leading 0
  }
  if (d.startsWith("9720")) d = `972${d.slice(4)}`;
  if (d.startsWith("972")) return /^972[2-9]\d{7,8}$/.test(d) ? d : null;
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

/** wa.me URL with the message filled in; with no usable phone, WhatsApp asks whom to send it to. */
export function waMeUrl(phone: string | null | undefined, text: string): string {
  const digits = normalizePhone(phone);
  return `https://wa.me/${digits ?? ""}?text=${encodeURIComponent(text)}`;
}

/** The Hebrew message an agent sends a client: the public trip page, plus the join link for the full trip. */
export function clientMessage(p: {
  clientName?: string | null;
  destination?: string | null;
  shareUrl: string;
  joinUrl?: string | null;
  agencyName?: string | null;
}): string {
  const name = p.clientName?.trim();
  const dest = p.destination?.split(",")[0].trim();
  const lines = [
    name ? `היי ${name}!` : "היי!",
    dest ? `הטיול שלכם ל${dest} מוכן: טיסות, מלון ומסלול במקום אחד.` : "הטיול שלכם מוכן: טיסות, מלון ומסלול במקום אחד.",
    "",
    `לצפייה בטיול (בלי הרשמה): ${p.shareUrl}`,
  ];
  if (p.joinUrl) lines.push("", `להצטרפות לטיול, עם השוברים והמסמכים האישיים: ${p.joinUrl}`);
  const agency = p.agencyName?.trim();
  if (agency) lines.push("", agency);
  return lines.join("\n");
}
