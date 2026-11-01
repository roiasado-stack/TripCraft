/**
 * Reads the `generate` kind "voucher" response into one record per booking.
 * One file may hold several bookings of different types (a booking platform's
 * combined quote: flights + hotels); the function lists them in `items`.
 * Older deployments answer only `doc_type` + `data` / `segments`, which still
 * work here. The caller fills each record over its blank shape.
 */

export type ScanDocType = "flight" | "hotel" | "car";
export type ScannedRecord = { docType: ScanDocType; data: Record<string, unknown> };

const DOC_TYPES: readonly string[] = ["flight", "hotel", "car"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function scannedRecords(res: unknown): ScannedRecord[] {
  if (!isObj(res) || !res.ok) return [];
  if (Array.isArray(res.items)) {
    return res.items
      .filter(isObj)
      .filter((it) => typeof it.doc_type === "string" && DOC_TYPES.includes(it.doc_type) && isObj(it.data))
      .map((it) => ({ docType: it.doc_type as ScanDocType, data: it.data as Record<string, unknown> }));
  }
  const docType = res.doc_type;
  if (typeof docType !== "string" || !DOC_TYPES.includes(docType) || !isObj(res.data)) return [];
  if (docType === "flight") {
    const segs = Array.isArray(res.segments) ? res.segments.filter(isObj) : [];
    return (segs.length ? segs : [res.data]).map((data) => ({ docType: "flight", data }));
  }
  return [{ docType: docType as ScanDocType, data: res.data }];
}

const LABEL: Record<ScanDocType, { alone: string; one: string; many: string }> = {
  flight: { alone: "טיסה", one: "טיסה אחת", many: "טיסות" },
  hotel: { alone: "מלון", one: "מלון אחד", many: "מלונות" },
  car: { alone: "רכב / העברה", one: "הזמנת רכב אחת", many: "הזמנות רכב" },
};

/** "זוהה: מלון" for one booking, "זוהו: 2 טיסות ו-2 מלונות" for several. */
export function scanSummary(types: ScanDocType[]): string {
  if (types.length === 1) return `זוהה: ${LABEL[types[0]].alone}`;
  const parts = (["flight", "hotel", "car"] as const)
    .map((t) => ({ t, n: types.filter((x) => x === t).length }))
    .filter((p) => p.n > 0)
    .map(({ t, n }) => (n === 1 ? LABEL[t].one : `${n} ${LABEL[t].many}`));
  if (parts.length <= 1) return `זוהו: ${parts[0] ?? ""}`;
  // Hebrew "and" sticks to the word ("ומלון"), with a hyphen only before a digit ("ו-2").
  const last = parts[parts.length - 1];
  return `זוהו: ${parts.slice(0, -1).join(", ")} ו${/^\d/.test(last) ? "-" : ""}${last}`;
}
