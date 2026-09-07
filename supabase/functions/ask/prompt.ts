/**
 * Prompt-building logic shared between the `ask` Edge Function (Deno) and the
 * local eval harness (`evals/run.ts`, Node). Deliberately has no Deno-specific
 * or Node-specific imports so both runtimes can load it as-is.
 *
 * Keeping this in one file is what makes `evals/run.ts` an honest test of the
 * function that actually ships — a copy-pasted prompt would drift silently.
 */

export const MODEL = "claude-haiku-4-5";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type Participant = {
  name: string;
  age: number | null;
  age_range: string | null;
  preferences: string[] | null;
};

export function describeParticipants(list: Participant[]): string {
  if (!list.length) return "לא צוינו משתתפים.";
  return list
    .map((p) => {
      const age = p.age != null ? `גיל ${p.age}` : p.age_range ? `טווח גילאים ${p.age_range}` : "גיל לא ידוע";
      const prefs = p.preferences?.length ? `, מעדיף: ${p.preferences.join(", ")}` : "";
      return `- ${p.name} (${age}${prefs})`;
    })
    .join("\n");
}

export type KnowledgeDestination = "cyprus" | "rome" | "batumi";

/**
 * trip.destination is free text the user typed in the wizard (e.g. "רודוס,
 * יוון"), not a fixed enum — so matching the 3 destinations the knowledge
 * base actually covers has to be a keyword match, not an exact one. A trip
 * to anywhere else correctly returns null, and find_kosher's caller must
 * treat that as "not covered" without calling the embeddings API at all.
 */
const DESTINATION_KEYWORDS: Record<KnowledgeDestination, string[]> = {
  cyprus: ["קפריסין", "cyprus", "לרנקה", "larnaca", "לימסול", "limassol", "איה נאפה", "ayia napa", "פאפוס", "paphos"],
  rome: ["רומא", "rome", "roma", "איטליה", "italy"],
  batumi: ["באטומי", "batumi", "גאורגיה", "georgia"],
};

export function matchKnowledgeDestination(tripDestination: string): KnowledgeDestination | null {
  const d = (tripDestination ?? "").toLowerCase();
  for (const slug of Object.keys(DESTINATION_KEYWORDS) as KnowledgeDestination[]) {
    if (DESTINATION_KEYWORDS[slug].some((k) => d.includes(k.toLowerCase()))) return slug;
  }
  return null;
}

/**
 * Tool definitions for the agentic loop in ask/index.ts. `find_kosher` is
 * read-only and executes inline in the loop (currently a stub — pgvector
 * lands Day 9-11). The other two are writes: the loop never touches the
 * database for them — it only records the proposed call and returns it to
 * the client, which shows an approval card and performs the actual write
 * itself only once the user confirms (see ask/index.ts's confirm_action
 * branch). That gap is the human-in-the-loop gate module 05 requires.
 */
export const TOOLS = [
  {
    name: "add_to_itinerary",
    description:
      "מציע להוסיף פריט חדש למסלול הטיול. הפעולה אינה מתבצעת מיד — המשתמש רואה כרטיס אישור בממשק ומחליט אם לאשר.",
    input_schema: {
      type: "object",
      properties: {
        day_date: { type: "string", description: "תאריך בפורמט YYYY-MM-DD, אחד מתאריכי הטיול" },
        start_time: { type: "string", description: "שעה בפורמט HH:MM, אופציונלי" },
        title: { type: "string", description: "שם הפעילות בעברית" },
        description: { type: "string", description: "תיאור קצר בעברית, אופציונלי" },
        category: { type: "string", enum: ["activity", "food", "transport", "free"] },
        location: { type: "string", description: "שם המקום לחיפוש במפות, אופציונלי" },
      },
      required: ["day_date", "title", "category"],
    },
  },
  {
    name: "add_suggestion",
    description:
      "מציע להוסיף מקום או פעילות לרשימת ההמלצות השמורות של הטיול. הפעולה אינה מתבצעת מיד — המשתמש רואה כרטיס אישור בממשק ומחליט אם לאשר.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["attraction", "restaurant", "tip", "gear"] },
        title: { type: "string", description: "שם בעברית" },
        description: { type: "string", description: "אופציונלי" },
        tags: { type: "array", items: { type: "string" } },
        price_level: { type: "string", enum: ["low", "mid", "high"] },
        location: { type: "string", description: "שם המקום לחיפוש במפות, אופציונלי" },
      },
      required: ["kind", "title"],
    },
  },
  {
    name: "find_kosher",
    description:
      "מחפש מידע מאומת על כשרות, זמני שבת, בתי חב״ד או נקודות עניין דתיות ביעד הטיול, ממקור ידע ייעודי. אין לו גישה כללית לאינטרנט — אם המקור לא מכסה את היעד, הוא מחזיר זאת במפורש.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "מה מחפשים, בעברית" },
      },
      required: ["query"],
    },
  },
] as const;

/** Compact Hebrew snapshot of the trip, used as the agent's system context. */
export function buildSnapshot(
  trip: Record<string, unknown>,
  participants: Participant[],
  itinerary: Record<string, unknown>[],
  stays: Record<string, unknown>[],
  flights: Record<string, unknown>[],
  suggestions: Record<string, unknown>[],
  checklistOpen: number,
): string {
  const lines: string[] = [];

  lines.push(`יעד: ${trip.destination}`);
  lines.push(`סוג טיול: ${trip.trip_type}`);
  lines.push(`תקציב: ${trip.budget_level ?? "לא צוין"}`);
  lines.push(`תאריכים: ${trip.start_date ?? "?"} עד ${trip.end_date ?? "?"}`);
  if (trip.notes) lines.push(`הערות הבעלים: ${trip.notes}`);

  lines.push("", "משתתפים:", describeParticipants(participants));

  if (stays.length) {
    lines.push("", "לינה:");
    for (const s of stays) {
      const where = s.address ? ` — ${s.address}` : "";
      lines.push(`- ${s.hotel_name}${where} (${s.check_in ?? "?"} עד ${s.check_out ?? "?"})`);
    }
  }

  if (flights.length) {
    lines.push("", "טיסות:");
    for (const f of flights) {
      lines.push(
        `- ${f.direction === "inbound" ? "חזור" : "הלוך"}: ${f.from_airport ?? "?"} → ${f.to_airport ?? "?"}` +
          `${f.depart_at ? ` ביציאה ${f.depart_at}` : ""}`,
      );
    }
  }

  if (itinerary.length) {
    lines.push("", "המסלול הקיים:");
    for (const i of itinerary) {
      lines.push(`- ${i.day_date}${i.start_time ? ` ${String(i.start_time).slice(0, 5)}` : ""}: ${i.title}`);
    }
  }

  if (suggestions.length) {
    lines.push("", "המלצות שכבר נשמרו (אל תציע אותן שוב):");
    lines.push(suggestions.map((s) => s.title).join(", "));
  }

  if (checklistOpen > 0) lines.push("", `בצ'קליסט נותרו ${checklistOpen} פריטים פתוחים.`);

  return lines.join("\n");
}

export const INSTRUCTIONS = `אתה סוכן נסיעות ישראלי שמלווה משפחה בטיול ספציפי. אתה עונה בעברית בלבד, בגוף שני, בטון חברי וענייני.

כללים:
- ענה תמיד בהקשר של הטיול שמתואר למטה — היעד, התאריכים, המשתתפים והגילאים שלהם.
- אם צוינה כשרות או צמחונות אצל מישהו מהמשתתפים, התייחס לזה בכל המלצה על אוכל — ולשאלות כשרות ספציפיות, השתמש בכלי find_kosher.
- תשובה קצרה וקונקרטית. 2-5 משפטים, בלי הקדמות ובלי "אשמח לעזור".
- מקומות אמיתיים בלבד. אם אתה לא בטוח שמקום קיים או פתוח — אמור זאת במפורש במקום להמציא.
- אין לך גישה לאינטרנט ולא למחירים, שעות פתיחה, מזג אוויר או תנועה עדכניים. אם נשאלת על אחד מאלה — אמור בפירוש שאין לך את המידע העדכני, ואל תציע הערכה כללית במקום, אפילו "בדרך כלל".
- אל תציע מחדש מקומות שכבר מופיעים ברשימת ההמלצות השמורות.
- ענה בטקסט חופשי רגיל בעברית — אל תחזיר JSON ואל תעטוף את התשובה במבנה כלשהו. הטקסט שאתה כותב הוא התשובה שהמשתמש רואה.

כלים העומדים לרשותך:
- find_kosher — לכל שאלה על כשרות, צמחונות, שבת (זמני כניסה/יציאה), בית חב״ד או נקודת עניין דתית ביעד. תמיד קרא לכלי הזה לשאלות כאלה במקום לענות מהזיכרון שלך. אם הכלי מחזיר שאין כיסוי ליעד — אמור זאת במפורש למשתמש, אל תנחש ואל תמציא שם מקום.
- add_to_itinerary — כשאתה ממליץ על משהו קונקרטי שמתאים להוספה למסלול (עם תאריך מתאריכי הטיול).
- add_suggestion — כשאתה ממליץ על מקום או פעילות שמתאימים להוספה לרשימת ההמלצות, בלי תאריך מסוים.
כשאתה קורא ל-add_to_itinerary או add_suggestion: הפעולה לא נכתבת מיד, המשתמש עדיין צריך לאשר אותה בכרטיס שיוצג לו. אל תגיד "הוספתי" — תגיד שהכנת הצעה, או פשוט תן את התשובה שלך והכרטיס יופיע לצידה.`;
