/** The agent demo form on /agents: options, validation, and the call to the `demo-request` function. */

import { supabase } from "@/lib/supabase";

export const TRIPS_OPTIONS = [
  { value: "up_to_10", label: "עד 10" },
  { value: "10_30", label: "10-30" },
  { value: "30_plus", label: "30+" },
] as const;

export type TripsPerMonth = (typeof TRIPS_OPTIONS)[number]["value"];

export interface DemoRequestInput {
  fullName: string;
  agencyName: string;
  phone: string;
  email: string;
  tripsPerMonth: TripsPerMonth | "";
}

export type DemoRequestErrors = Partial<Record<keyof DemoRequestInput, string>>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Field errors in Hebrew; an empty object means the form may be sent. */
export function validateDemoRequest(v: DemoRequestInput): DemoRequestErrors {
  const errors: DemoRequestErrors = {};
  if (v.fullName.trim().length < 2) errors.fullName = "נא למלא שם מלא";
  if (v.agencyName.trim().length < 2) errors.agencyName = "נא למלא את שם הסוכנות";
  // Israeli and international numbers alike: 7+ digits once spaces, dashes and + are ignored.
  const digits = v.phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || !/^[\d\s\-+()]+$/.test(v.phone)) errors.phone = "נא למלא מספר טלפון תקין";
  if (!EMAIL_RE.test(v.email.trim())) errors.email = "נא למלא כתובת מייל תקינה";
  if (!TRIPS_OPTIONS.some((o) => o.value === v.tripsPerMonth)) errors.tripsPerMonth = "נא לבחור כמה טיולים בחודש";
  return errors;
}

export type DemoRequestResult = { ok: true } | { ok: false; reason: "busy" | "failed" };

export async function sendDemoRequest(v: DemoRequestInput, website: string): Promise<DemoRequestResult> {
  const { data, error } = await supabase.functions.invoke("demo-request", {
    body: {
      full_name: v.fullName.trim(),
      agency_name: v.agencyName.trim(),
      phone: v.phone.trim(),
      email: v.email.trim(),
      trips_per_month: v.tripsPerMonth,
      website,
    },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return { ok: false, reason: status === 429 ? "busy" : "failed" };
  }
  return (data as { ok?: boolean } | null)?.ok ? { ok: true } : { ok: false, reason: "failed" };
}
