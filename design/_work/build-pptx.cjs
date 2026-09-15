const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const ROOT = "C:/Users/user/אפליקציית טיולים";
const SHOTS = path.join(ROOT, "docs/assets/screens");
const OUT = path.join(ROOT, "docs/presentation.pptx");

// ---- Brand palette (same conversions used across the other TripCraft docs
// this session — real oklch tokens from src/styles.css, deep/mid/soft tiers
// per hue for text-safe contrast on a light ground). ----
const C = {
  teal: "0B7671", tealMid: "0E9C96", tealSoft: "D7F2EF",
  coral: "B84A32", coralMid: "EE6D4E", coralSoft: "FCE6DD",
  sun: "8A5C0F", sunMid: "F2AB2E", sunSoft: "FDF0D9",
  ink: "0F2E2C", muted: "4B6663", dim: "6B8480",
  ground: "F6FBFA", surface: "FFFFFF", line: "D7E9E6",
};
const FONT = "Calibri";
const FONT_DISPLAY = "Calibri"; // safe-list only; bold carries the "display" feel

const pres = new pptxgen();
pres.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pres.layout = "WIDE";
pres.rtlMode = true;

const W = 13.333, H = 7.5;
const MX = 0.7; // slide margin

function img(name) {
  return path.join(SHOTS, name + ".jpg");
}

function bgSlide(slide) {
  slide.background = { color: C.ground };
}

function header(slide, eyebrow, title, lede) {
  slide.addText(eyebrow.toUpperCase(), {
    x: MX, y: 0.42, w: W - MX * 2, h: 0.32, isTextBox: true, rtlMode: true,
    fontFace: FONT, fontSize: 12, bold: true, color: C.tealMid,
    charSpacing: 2, align: "right",
  });
  slide.addText(title, {
    x: MX, y: 0.74, w: W - MX * 2, h: 0.9, isTextBox: true, rtlMode: true,
    fontFace: FONT_DISPLAY, fontSize: 30, bold: true, color: C.ink,
    align: "right", valign: "top",
  });
  if (lede) {
    slide.addText(lede, {
      x: MX, y: 1.56, w: W - MX * 2, h: 0.55, isTextBox: true, rtlMode: true,
      fontFace: FONT, fontSize: 13.5, color: C.muted, align: "right", valign: "top",
    });
  }
  slide.addShape(pres.ShapeType.line, {
    x: MX, y: 0.4, w: W - MX * 2, h: 0, line: { color: C.line, width: 0.75 },
  });
}

function footer(slide, text) {
  slide.addText(text, {
    x: MX, y: H - 0.55, w: W - MX * 2, h: 0.3, isTextBox: true, rtlMode: true,
    fontFace: FONT, fontSize: 10.5, color: C.dim, align: "right",
  });
}

function pageMark(slide, n) {
  slide.addText(`TripCraft · ${n}`, {
    x: W - MX - 2.2, y: H - 0.42, w: 2.2, h: 0.28, isTextBox: true, rtlMode: true,
    fontFace: FONT, fontSize: 9, color: C.dim, align: "left",
  });
}

/** A rounded card with an optional colored soft fill. Returns nothing; draws directly. */
function card(slide, x, y, w, h, opts) {
  const fill = opts.tint || C.surface;
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.12,
    fill: { color: fill },
    line: { color: opts.line || C.line, width: 1 },
    shadow: { type: "outer", color: "5B7A76", opacity: 0.18, blur: 10, offset: 3, angle: 90 },
  });
}

function cardHeading(slide, x, y, w, text, color) {
  slide.addText(text, {
    x, y, w, h: 0.4, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT_DISPLAY, fontSize: 15, bold: true, color: color || C.ink,
    align: "right",
  });
}
function cardBody(slide, x, y, w, h, text) {
  slide.addText(text, {
    x, y, w, h, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT, fontSize: 11.5, color: C.muted, align: "right", valign: "top",
  });
}

function statTile(slide, x, y, w, h, value, label) {
  card(slide, x, y, w, h, {});
  slide.addText(value, {
    x: x + 0.15, y: y + 0.14, w: w - 0.3, h: 0.55, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT_DISPLAY, fontSize: 26, bold: true, color: C.tealMid, align: "right",
  });
  slide.addText(label, {
    x: x + 0.15, y: y + 0.72, w: w - 0.3, h: h - 0.85, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT, fontSize: 10.5, color: C.muted, align: "right", valign: "top",
  });
}

function chip(slide, x, y, text, color, wGuess) {
  const w = wGuess || 0.35 + text.length * 0.085;
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h: 0.32, rectRadius: 0.16,
    fill: { color: C.surface }, line: { color, width: 1 },
  });
  slide.addText(text, {
    x, y, w, h: 0.32, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT, fontSize: 10.5, bold: true, color, align: "center", valign: "middle",
  });
  return w;
}

function phoneMock(slide, x, y, w, h, imgName, captB, captR) {
  slide.addShape(pres.ShapeType.roundRect, {
    x: x - 0.05, y: y - 0.05, w: w + 0.1, h: h + 0.1, rectRadius: 0.16,
    fill: { color: C.surface }, line: { color: C.line, width: 1 },
    shadow: { type: "outer", color: "5B7A76", opacity: 0.22, blur: 12, offset: 4, angle: 90 },
  });
  slide.addImage({ path: img(imgName), x, y, w, h });
  slide.addText([
    { text: captB, options: { bold: true, color: C.tealMid, fontSize: 12, breakLine: true, rtlMode: true } },
    { text: captR, options: { color: C.muted, fontSize: 9.5, rtlMode: true } },
  ], {
    x: x - 0.35, y: y + h + 0.12, w: w + 0.7, h: 0.62, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT_DISPLAY, align: "center", valign: "top", lineSpacingMultiple: 1.15,
  });
}

function tableSlideStyle(rows) {
  return rows.map((r, ri) =>
    r.map((c, ci) => ({
      text: c,
      options: {
        fontFace: ri === 0 ? FONT_DISPLAY : FONT,
        fontSize: ri === 0 ? 10.5 : 11,
        bold: ri === 0,
        color: ri === 0 ? C.tealMid : C.ink,
        fill: { color: ri === 0 ? C.surfaceTint || "EDF7F6" : C.surface },
        align: "right",
        valign: "middle",
        rtlMode: true,
      },
    }))
  );
}

// ============================================================ SLIDE 1 — COVER
{
  const s = pres.addSlide();
  s.background = { color: C.ground };
  s.addImage({ path: path.join(ROOT, "public/icon-512.png"), x: W / 2 - 0.7, y: 0.95, w: 1.4, h: 1.4 });
  s.addText([
    { text: "Trip", options: { color: C.ink, rtlMode: true } },
    { text: "Craft", options: { color: C.tealMid, rtlMode: true } },
  ], {
    x: 0, y: 2.55, w: W, h: 1.1, isTextBox: true, rtlMode: true,
    fontFace: FONT_DISPLAY, fontSize: 54, bold: true, align: "center",
  });
  s.addText("מלווה הטיולים שלך", {
    x: 0, y: 3.6, w: W, h: 0.55, isTextBox: true, rtlMode: true,
    fontFace: FONT_DISPLAY, fontSize: 20, bold: true, color: C.tealMid, align: "center",
  });
  s.addText("אפליקציית ווב בעברית מלאה לתכנון וליווי טיול — מסלול, מסמכים, צ'קליסט, וסוכן AI עם כלים ומקור ידע.", {
    x: W / 2 - 4.2, y: 4.2, w: 8.4, h: 0.7, isTextBox: true, rtlMode: true,
    fontFace: FONT, fontSize: 14, color: C.muted, align: "center",
  });
  const metaY = 5.6;
  const metas = [
    ["קורס", "AI Agents & Automation Specialist"],
    ["מגיש", "רועי אסדו"],
    ["תאריך", "14/09/2026"],
  ];
  const mw = 3.4;
  metas.slice().reverse().forEach((m, i) => {
    const x = W / 2 - (mw * 1.5) + i * mw;
    s.addText(m[0].toUpperCase(), {
      x, y: metaY, w: mw, h: 0.3, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT, fontSize: 9.5, bold: true, color: C.dim, align: "center", charSpacing: 1.5,
    });
    s.addText(m[1], {
      x, y: metaY + 0.3, w: mw, h: 0.35, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT, fontSize: 12.5, color: C.ink, align: "center",
    });
  });
}

// ============================================================ SLIDE 2 — מה זה
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "מה בניתי", "מלווה טיולים בעברית, RTL מלא",
    "אפליקציית ווב (גם PWA להתקנה על מסך הבית) לתכנון וליווי טיול — עובדת ידנית לגמרי, ועם שכבת AI אופציונלית שלא חובה כדי להתחיל.");
  const statW = 3.77, gap = 0.24, statY = 2.35, statH = 1.5;
  const stats = [
    ["7", "מסכים לכל טיול: בית, מסלול, מומלצים, מסמכים, צ'קליסט, שאל את הסוכן, ואשף יצירה בן 4 שלבים"],
    ["3", "כלים שהסוכן יכול להפעיל — הוספה למסלול, הוספה למומלצים, חיפוש כשרות/שבת"],
    ["13", "טבלאות במסד הנתונים, כולן עם הרשאות ברמת שורה (RLS)"],
  ];
  stats.forEach((st, i) => {
    const x = W - MX - statW - i * (statW + gap);
    statTile(s, x, statY, statW, statH, st[0], st[1]);
  });
  const cardY = 4.15, cardW = 5.8, cardH = 2.35;
  card(s, W - MX - cardW, cardY, cardW, cardH, { tint: C.tealSoft, line: C.tealMid });
  cardHeading(s, W - MX - cardW + 0.25, cardY + 0.2, cardW - 0.5, "🧳 כסוכן נסיעות", C.teal);
  cardBody(s, W - MX - cardW + 0.25, cardY + 0.7, cardW - 0.5, cardH - 0.9,
    "מיתוג סוכנות, קישור שיתוף לצפייה בלבד ללקוח, שכפול טיול כתבנית, ייבוא נוסעים בכמות, שדה מדריך עם קישור וואטסאפ לטיול מאורגן.");
  card(s, MX, cardY, cardW, cardH, { tint: C.coralSoft, line: C.coralMid });
  cardHeading(s, MX + 0.25, cardY + 0.2, cardW - 0.5, "🧑‍💻 כטייל פרטי", C.coral);
  cardBody(s, MX + 0.25, cardY + 0.7, cardW - 0.5, cardH - 0.9,
    "הזנה ידנית מלאה של טיסות ולינה, בלי צורך ב-AI כדי להתחיל — הסוכן שימושי אחר כך, לא חובה מהרגע הראשון.");
  pageMark(s, 2);
}

// ============================================================ SLIDE 3 — ארכיטקטורה
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "איך זה בנוי", "ארבע שכבות + אוטומציה",
    "כל שכבה עצמאית — אם ה-AI לא זמין, האפליקציה עדיין עובדת במלואה עם נתונים שהוזנו ידנית.");
  const layers = [
    { lh: "שכבת לקוח", ln: "React + Vite", items: ["TypeScript", "Tailwind v4", "מערכת עיצוב עצמית"] },
    { lh: "Edge Functions", ln: "Deno · סודות בשרת בלבד", items: ["ask — סוכן, tool-use, 3 כלים", "generate — המלצות/מסלול/דרכון"] },
    { lh: "Supabase", ln: "Postgres + Auth + Storage", items: ["13 טבלאות, RLS על כל אחת", "agent_runs — עלות וזמן"] },
    { lh: "מקור ידע", ln: "pgvector", items: ["Voyage AI embeddings", "3 יעדים, כל תשובה מצטטת מקור"] },
  ];
  const n = layers.length, lw = 2.55, lh_ = 2.6, gap = 0.25, arrowW = 0.35;
  const totalW = n * lw + (n - 1) * arrowW;
  let xCursor = W - MX - lw; // rightmost first (RTL reading order)
  const ly = 2.5;
  layers.forEach((L, i) => {
    const x = xCursor;
    card(s, x, ly, lw, lh_, {});
    s.addText(L.lh.toUpperCase(), {
      x: x + 0.18, y: ly + 0.16, w: lw - 0.36, h: 0.3, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT, fontSize: 10, bold: true, color: C.tealMid, align: "right", charSpacing: 1,
    });
    s.addText(L.ln, {
      x: x + 0.18, y: ly + 0.48, w: lw - 0.36, h: 0.45, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT_DISPLAY, fontSize: 12.5, bold: true, color: C.ink, align: "right", valign: "top",
    });
    s.addText(L.items.map((t, ti) => ({ text: t, options: { breakLine: ti < L.items.length - 1, bullet: { code: "25CF", indent: 12 }, rtlMode: true } })), {
      x: x + 0.18, y: ly + 1.0, w: lw - 0.36, h: lh_ - 1.15, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT, fontSize: 9.5, color: C.muted, align: "right", valign: "top", paraSpaceAfter: 4,
    });
    if (i < n - 1) {
      s.addText("←", {
        x: x - arrowW - 0.05, y: ly + lh_ / 2 - 0.2, w: arrowW + 0.1, h: 0.4, isTextBox: true, rtlMode: true,
        fontFace: FONT, fontSize: 18, bold: true, color: C.tealMid, align: "center",
      });
    }
    xCursor -= lw + arrowW;
  });
  const cy = 5.5, ch = 1.15;
  card(s, MX, cy, W - MX * 2, ch, { tint: C.sunSoft, line: C.sunMid });
  cardHeading(s, MX + 0.25, cy + 0.16, W - MX * 2 - 0.5, "🔁 אוטומציה — n8n", C.sun);
  cardBody(s, MX + 0.25, cy + 0.55, W - MX * 2 - 0.5, ch - 0.65,
    "תרחיש: תזכורת שבוע לפני יציאה, עם Retry ו-Error Workflow. רץ כרגע ב-Docker מקומי — לא זמין כשהמחשב כבוי. מתועד בכוונה, לא מוסתר.");
  pageMark(s, 3);
}

// ============================================================ SLIDE 4 — איפה מתארח
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "תשתית", "שלושה שירותי ענן מנוהלים + Docker מקומי אחד");
  const items = [
    ["▲ Vercel", "כתובת חיה, פריסה דרך CLI. עדכון = פקודה אחת אחרי push."],
    ["◆ Supabase", "Postgres מנוהל, Auth, Storage, Edge Functions — פרויקט אחד."],
    ["✦ Anthropic + Voyage", "מודל השפה והטמעות ל-RAG — מפתחות כ-secrets בצד שרת בלבד."],
    ["🔁 n8n", "Docker מקומי. מספיק להגשה, לא תמיד-דלוק לשימוש מתמשך."],
  ];
  const cw = 2.8, ch = 2.9, gap = 0.2, cy = 2.6;
  items.forEach((it, i) => {
    const x = W - MX - cw - i * (cw + gap);
    card(s, x, cy, cw, ch, {});
    cardHeading(s, x + 0.2, cy + 0.22, cw - 0.4, it[0], C.ink);
    cardBody(s, x + 0.2, cy + 0.75, cw - 0.4, ch - 0.95, it[1]);
  });
  pageMark(s, 4);
}

// ============================================================ SLIDE 5 — מסד הנתונים
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "הבסיס", "Postgres אחד, סכמה גרסתית בגיט");
  const cy = 2.5, cw = W - MX * 2, ch = 1.9;
  card(s, MX, cy, cw, ch, {});
  cardBody(s, MX + 0.3, cy + 0.28, cw - 0.6, ch - 0.5,
    "13 טבלאות, כולן עם Row Level Security — כלל הגישה נאכף במסד הנתונים עצמו, לא רק בקוד הלקוח. גישה חוצה-בעלים (הסוכן, דוחות מנהל) עוברת דרך פונקציות SECURITY DEFINER ממוקדות (owns_trip(), has_role()) במקום הרפיית ההרשאות עצמן.");
  const cy2 = cy + ch + 0.3, ch2 = 1.7;
  card(s, MX, cy2, cw, ch2, { tint: C.tealSoft, line: C.tealMid });
  s.addText([
    { text: "איך זה מתעדכן: ", options: { bold: true, color: C.teal, rtlMode: true } },
    { text: "כל שינוי סכמה הוא קובץ SQL ממוספר תחת supabase/migrations/ (9 קבצים) — מתועד, בהיסטוריית git, ומופעל על המסד החי. supabase/schema.sql הוא עותק מלא ואידמפוטנטי לבניית מסד חדש בהרצה אחת.", options: { color: C.ink, rtlMode: true } },
  ], {
    x: MX + 0.3, y: cy2 + 0.25, w: cw - 0.6, h: ch2 - 0.5, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT, fontSize: 13, align: "right", valign: "top",
  });
  pageMark(s, 5);
}

// ============================================================ SLIDE 6 — איך עבדתי
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "תהליך", "תהליך, לא רק תוצאה",
    "עבדתי מול Claude Code כשותף פיתוח, לפי בריף כתוב מראש עם תוכנית של 16 ימים — שלב אחד בכל פעם.");
  const steps = [
    ["לפני כל קוד — לאמת מול המציאות.", "סורקים את הריפו בפועל, מתקנים את הבריף אם יש פער."],
    ["שלב אחד, Definition of Done ברור.", "לא עוברים הלאה לפני שהקודם עומד בקריטריון שהוגדר מראש."],
    ["בלי מספרים מומצאים.", "עלות/זמן/ROI — נמדדים בפועל, או מסומנים כהערכה עם ההנחות גלויות."],
    ["בדיקת טיפוסים ירוקה ≠ הקוד עובד.", "כל שינוי נבדק בדפדפן אמיתי לפני שסומן כגמור."],
    ["גיט כתיעוד, לא רק גיבוי.", "כל קומיט מסביר את ה\"למה\" — ההיסטוריה היא יומן ההחלטות."],
  ];
  let sy = 2.35;
  const rowH = 0.56, numX = W - MX - 0.4;
  steps.forEach((st, i) => {
    s.addShape(pres.ShapeType.ellipse, {
      x: numX, y: sy, w: 0.4, h: 0.4, fill: { color: C.tealSoft }, line: { color: C.tealMid, width: 1 },
    });
    s.addText(String(i + 1), {
      x: numX, y: sy, w: 0.4, h: 0.4, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT_DISPLAY, fontSize: 13, bold: true, color: C.teal, align: "center", valign: "middle",
    });
    s.addText([
      { text: st[0] + "  ", options: { bold: true, color: C.ink, rtlMode: true } },
      { text: st[1], options: { color: C.muted, rtlMode: true } },
    ], {
      x: MX, y: sy - 0.03, w: numX - MX - 0.2, h: rowH, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT, fontSize: 12.5, align: "right", valign: "top",
    });
    sy += rowH;
  });
  const exY = sy + 0.15, exH = 1.55, exW = W - MX * 2;
  card(s, MX, exY, exW, exH, {});
  s.addShape(pres.ShapeType.roundRect, {
    x: MX, y: exY, w: exW, h: 0.42, rectRadius: 0.12,
    fill: { color: "EDF7F6" }, line: { type: "none" },
  });
  s.addText('דוגמה אמיתית: "הסוכן לא עונה"', {
    x: MX + 0.25, y: exY, w: exW - 0.5, h: 0.42, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT_DISPLAY, fontSize: 12, bold: true, color: C.teal, align: "right", valign: "middle",
  });
  s.addText([
    { text: "לא ניחשתי. ", options: { bold: true, color: C.ink, rtlMode: true } },
    { text: "בדקתי טבלת לוגים (ריקה לגמרי), ואז שלחתי קריאה אמיתית לפונקציה החיה וראיתי את השגיאה המדויקת: ANTHROPIC_API_KEY is not set.", options: { color: C.muted, rtlMode: true } },
    { text: "\nשורש הבעיה: ", options: { bold: true, color: C.ink, breakLine: false, rtlMode: true } },
    { text: "הסוד מעולם לא הוגדר בפרודקשן. תוקן, ואומת שוב מול הפונקציה החיה לפני שסומן כפתור.", options: { color: C.muted, rtlMode: true } },
  ], {
    x: MX + 0.25, y: exY + 0.5, w: exW - 0.5, h: exH - 0.6, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: FONT, fontSize: 11, align: "right", valign: "top", paraSpaceAfter: 6,
  });
  pageMark(s, 6);
}

// ============================================================ SLIDE 7 — כלים ופרומפטים
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "איך זה בפועל", "הכלים, והפרומפט שפתח כל סשן");
  const tools = ["Claude Code CLI", "Git + GitHub", "Supabase Management API", "Vercel CLI", "n8n", "Eval harness (Node)"];
  let cx = W - MX;
  const chipY = 2.35;
  tools.forEach((t) => {
    const w = 0.4 + t.length * 0.095;
    cx -= w;
    chip(s, cx, chipY, t, C.tealMid, w);
    cx -= 0.15;
  });
  s.addText("כל סשן עבודה נפתח באותו פרומפט קבוע — כדי שהעבודה תמיד תתחיל מאימות מול המצב האמיתי בריפו, לא מהנחות:", {
    x: MX, y: 2.95, w: W - MX * 2, h: 0.5, isTextBox: true, rtlMode: true,
    fontFace: FONT, fontSize: 13, color: C.muted, align: "right",
  });
  const boxY = 3.55, boxH = 3.0, boxW = W - MX * 2;
  s.addShape(pres.ShapeType.roundRect, {
    x: MX, y: boxY, w: boxW, h: boxH, rectRadius: 0.12,
    fill: { color: C.ink }, line: { type: "none" },
    shadow: { type: "outer", color: "5B7A76", opacity: 0.25, blur: 12, offset: 4, angle: 90 },
  });
  const promptText =
    "קרא את FINAL-PROJECT-BRIEF.md ואת CLAUDE.md בשורש הריפו.\n\n" +
    "לפני שאתה כותב שורת קוד:\n" +
    "1. סרוק את הריפו ואמת מה כבר קיים מול טבלת \"מצב נוכחי\" בבריף.\n" +
    "   אם משהו בבריף לא תואם למציאות בקוד — עצור ותקן את הבריף קודם.\n" +
    "2. הצג לי את התוכנית ליום העבודה הנוכחי בלבד.\n" +
    "3. אל תתחיל שלב חדש לפני שהקודם עומד ב-Definition of Done שלו.\n\n" +
    "עבוד יום אחד בכל פעם. אל תרוץ קדימה.";
  s.addText(promptText, {
    x: MX + 0.3, y: boxY + 0.25, w: boxW - 0.6, h: boxH - 0.5, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: "Consolas", fontSize: 12.5, color: C.ground, align: "right", valign: "top", lineSpacingMultiple: 1.3,
  });
  pageMark(s, 7);
}

// ============================================================ SLIDE 8 — System Prompt
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "פרומפטים בפרודקשן", "ה-System Prompt שהסוכן חי לפיו",
    "לא רק פרומפטים לעבודה מול Claude Code — גם הפרומפט עצמו שקובע איך הסוכן החי בפרודקשן מתנהג, ב-supabase/functions/ask/prompt.ts.");
  const boxY = 2.35, boxH = 2.55, boxW = W - MX * 2;
  s.addShape(pres.ShapeType.roundRect, {
    x: MX, y: boxY, w: boxW, h: boxH, rectRadius: 0.12,
    fill: { color: C.ink }, line: { type: "none" },
    shadow: { type: "outer", color: "5B7A76", opacity: 0.25, blur: 12, offset: 4, angle: 90 },
  });
  const sysPrompt =
    "אתה סוכן נסיעות ישראלי שמלווה משפחה בטיול ספציפי. אתה עונה בעברית בלבד, בגוף שני, בטון חברי וענייני.\n\n" +
    "כללים:\n" +
    "- מקומות אמיתיים בלבד. אם אתה לא בטוח שמקום קיים או פתוח — אמור זאת במפורש במקום להמציא.\n" +
    "- אין לך גישה לאינטרנט ולא למחירים, שעות פתיחה, מזג אוויר או תנועה עדכניים. אם נשאלת על אחד\n" +
    "  מאלה — אמור בפירוש שאין לך את המידע העדכני, אל תציע הערכה כללית במקום.\n" +
    "- find_kosher — לכל שאלה על כשרות/שבת/חב״ד. תמיד קרא לכלי הזה במקום לענות מהזיכרון. אם הכלי\n" +
    "  מחזיר שאין כיסוי ליעד — אמור זאת במפורש, אל תנחש ואל תמציא שם מקום.\n" +
    "- כשקוראים ל-add_to_itinerary / add_suggestion: הפעולה לא נכתבת מיד — המשתמש עדיין צריך\n" +
    "  לאשר בכרטיס. אל תגיד \"הוספתי\".";
  s.addText(sysPrompt, {
    x: MX + 0.3, y: boxY + 0.22, w: boxW - 0.6, h: boxH - 0.4, isTextBox: true, rtlMode: true, margin: 0,
    fontFace: "Consolas", fontSize: 10.5, color: C.ground, align: "right", valign: "top", lineSpacingMultiple: 1.25,
  });
  const cy = boxY + boxH + 0.28, cw = 3.77, ch = 1.55, gap = 0.24;
  const cards3 = [
    ["🚫 בלי המצאות", "איסור מפורש על ניחוש מחירים/שעות/מזג אוויר — \"אין לי מידע עדכני\" עדיף על תשובה מפוברקת.", C.tealSoft, C.teal],
    ["🛠️ שימוש מחויב בכלים", "שאלות כשרות חייבות לעבור דרך find_kosher — לא תשובה \"מהזיכרון\" של המודל.", C.coralSoft, C.coral],
    ["✋ בלי לשקר על כתיבה", "הפרומפט אוסר לומר \"הוספתי\" לפני שהמשתמש אישר בפועל — עקביות בין הטקסט למנגנון.", C.sunSoft, C.sun],
  ];
  cards3.forEach((cd, i) => {
    const x = W - MX - cw - i * (cw + gap);
    card(s, x, cy, cw, ch, { tint: cd[2] });
    cardHeading(s, x + 0.2, cy + 0.18, cw - 0.4, cd[0], cd[3]);
    cardBody(s, x + 0.2, cy + 0.62, cw - 0.4, ch - 0.8, cd[1]);
  });
  pageMark(s, 8);
}

// ============================================================ SLIDE 9 — מודל השפה
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "בחירת מודל", "שני מודלים, לפי תפקיד — לא אחד לכול",
    "כל קריאה ל-AI ידועה מראש אם היא שיחתית-תכופה או יצירתית-חד-פעמית, אז המודל נבחר לפי זה ולא באופן גורף.");
  const rows = [
    ["תפקיד", "מודל", "למה", "$/Mtok קלט", "$/Mtok פלט"],
    ["ask — סוכן שיחה, tool-use", "claude-haiku-4-5", "נקרא הרבה, כל הודעה — זמן תגובה ועלות נמוכה קריטיים", "$1.00", "$5.00"],
    ["generate — המלצות/מסלול/דרכון", "claude-sonnet-5", "נקרא פעם אחת לפעולה, כולל ראייה (סריקת דרכון) — איכות עדיפה על מהירות", "$2.00", "$10.00"],
  ];
  s.addTable(tableSlideStyle(rows), {
    x: MX, y: 2.35, w: W - MX * 2, h: 1.5,
    colW: [3.4, 2.0, 4.53, 1.3, 1.3],
    border: { type: "solid", color: C.line, pt: 0.75 },
    autoPage: false,
  });
  const statY = 4.15, statW = 3.77, gap = 0.24, statH = 1.35;
  const stats = [
    ["2.4s", "זמן תגובה ממוצע (ask), נמדד בפועל ב-30 שאלות הבדיקה"],
    ["$0.001", "עלות ממוצעת לשאלה (ask), נמדדת בפועל"],
    ["$2.00", "תקרת הוצאה יומית למשתמש, לשני המודלים יחד"],
  ];
  stats.forEach((st, i) => {
    const x = W - MX - statW - i * (statW + gap);
    statTile(s, x, statY, statW, statH, st[0], st[1]);
  });
  const noteY = 5.75;
  s.addText([
    { text: "מקור הידע (RAG) ", options: { color: C.ink, rtlMode: true } },
    { text: "משתמש במודל שלישי, נפרד: Voyage AI (voyage-4-lite, 1024 ממדים) ליצירת ה-embeddings — לא Claude, כי זו משימת הטמעה ולא שיחה.", options: { color: C.muted, rtlMode: true } },
  ], {
    x: MX, y: noteY, w: W - MX * 2, h: 0.6, isTextBox: true, rtlMode: true,
    fontFace: FONT, fontSize: 12.5, align: "right", valign: "top",
  });
  pageMark(s, 9);
}

// ============================================================ SLIDE 10 — אבטחה ומפתחות
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "אבטחה ותשתית", "כניסה עם Google, ומפתחות בצד השרת בלבד");
  const cy = 2.3, cw = 5.8, ch = 1.85, gap = 0.24;
  card(s, W - MX - cw, cy, cw, ch, { tint: C.tealSoft, line: C.tealMid });
  cardHeading(s, W - MX - cw + 0.22, cy + 0.18, cw - 0.44, "🔑 כניסה עם חשבון Google", C.teal);
  cardBody(s, W - MX - cw + 0.22, cy + 0.62, cw - 0.44, ch - 0.8,
    "מופעל דרך Supabase Auth (OAuth), עם OAuth Client עצמאי בפרויקט Google Cloud \"Travel App\". המשתמש לוחץ \"המשך עם Google\" — מועבר לאימות אצל גוגל, וחוזר מחובר, בלי סיסמה נוספת לזכור. זמין לצד ההתחברות הרגילה, לא במקומה.");
  card(s, MX, cy, cw, ch, { tint: C.coralSoft, line: C.coralMid });
  cardHeading(s, MX + 0.22, cy + 0.18, cw - 0.44, "🛡️ הכלל שקבע את הארכיטקטורה", C.coral);
  cardBody(s, MX + 0.22, cy + 0.62, cw - 0.44, ch - 0.8,
    "אף מפתח API לא מגיע לדפדפן — לעולם. כל קריאה למודל שפה, להטמעות, או לאימות עוברת דרך Edge Function בצד השרת, שמחזיק את הסוד. הלקוח (React) לא רואה אף מפתח, אפילו לא ב-network tab.");
  const rows = [
    ["מפתח / סוד", "לאיזה כלי", "איפה מאוחסן"],
    ["ANTHROPIC_API_KEY", "סוכן השיחה (ask) והפקת תוכן (generate)", "Supabase secret, בצד השרת"],
    ["VOYAGE_API_KEY", "Embeddings למקור הידע (RAG)", "Supabase secret, בצד השרת"],
    ["Google OAuth Client ID + Secret", "כניסה עם Google", "Supabase Auth provider config"],
    ["Supabase URL + anon key", "גישת הלקוח למסד/Auth/Storage", "ציבורי בכוונה — RLS הוא שער ההגנה"],
    ["Supabase service-role key", "סקריפטים מקומיים בלבד (evals, seeding)", "קובץ .env מקומי, לא בגיט"],
  ];
  s.addTable(tableSlideStyle(rows), {
    x: MX, y: cy + ch + 0.3, w: W - MX * 2, h: 2.6,
    colW: [3.6, 5.5, 3.43],
    border: { type: "solid", color: C.line, pt: 0.75 },
    autoPage: false,
  });
  pageMark(s, 10);
}

// ============================================================ SLIDES 11-13 — SCREENSHOTS
function shotSlide(pageNo, eyebrow, title, shots, footText) {
  const s = pres.addSlide(); bgSlide(s);
  header(s, eyebrow, title, footText);
  const n = shots.length;
  const RATIO = 640 / 1305; // real screenshot aspect ratio (w/h)
  const ph = 4.0, pw = ph * RATIO;
  const gap = n === 2 ? 1.3 : 0.8;
  const totalW = n * pw + (n - 1) * gap;
  let x0 = W / 2 - totalW / 2;
  const y0 = 2.55;
  // RTL order: first item rightmost
  const ordered = shots.slice().reverse();
  ordered.forEach((sh, i) => {
    const x = x0 + i * (pw + gap);
    phoneMock(s, x, y0, pw, ph, sh.file, sh.b, sh.r);
  });
  pageMark(s, pageNo);
}

shotSlide(11, "איך זה נראה", "כניסה, ומסך הבית", [
  { file: "login", b: "כניסה", r: "אימייל+סיסמה, או Google בלחיצה אחת" },
  { file: "trips-list", b: "הבית", r: "רשימת הטיולים, לפי בעלים" },
  { file: "trip-home", b: "מסך טיול", r: "ספירה לאחור, טיסה קרובה, עדכונים" },
], 'צילומי מסך אמיתיים — טיול "חופשה משפחתית ברודוס" (דוגמה).');

shotSlide(12, "איך זה נראה", "מסלול ומומלצים", [
  { file: "itinerary", b: "מסלול", r: "מסודר לפי ימים, שעות ומיקומים" },
  { file: "recommendations", b: "מומלצים", r: "מסעדות ואטרקציות, מסונן לפי קטגוריה" },
], 'צילומי מסך אמיתיים — טיול "חופשה משפחתית ברודוס" (דוגמה).');

shotSlide(13, "איך זה נראה", "מסמכים, והסוכן", [
  { file: "documents", b: "מסמכים", r: "העלאת קובץ או קישור חיצוני" },
  { file: "ask-agent", b: "Agent", r: "שיחה עם מקור ידע מצוטט" },
], 'צילומי מסך אמיתיים — טיול "חופשה משפחתית ברודוס" (דוגמה).');

// ============================================================ SLIDE 14 — מדידה
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "Evaluation ו-Monitoring", "מספרים אמיתיים, לא הערכות",
    "30 שאלות בעברית (עובדתיות, שליפה, וסירוב נכון), נגד תשובה צפויה — ריצת בסיס שמורה להשוואה לפני כל שינוי בפרומפט או במודל.");
  const statY = 2.5, statW = 3.77, gap = 0.24, statH = 1.6;
  const stats = [["100%", "דיוק בריצת הבסיס"], ["0%", "שיעור הזיות"], ["$0.029", "עלות כוללת ל-30 שאלות"]];
  stats.forEach((st, i) => {
    const x = W - MX - statW - i * (statW + gap);
    statTile(s, x, statY, statW, statH, st[0], st[1]);
  });
  const noteY = 4.5, noteW = W - MX * 2, noteH = 1.4;
  card(s, MX, noteY, noteW, noteH, {});
  cardBody(s, MX + 0.3, noteY + 0.25, noteW - 0.6, noteH - 0.5,
    "בפרודקשן: כל קריאה ל-AI נרשמת ב-agent_runs (טוקנים, עלות, זמן תגובה, סטטוס), עם תקרת הוצאה יומית למשתמש ומסך מוניטורינג פנימי לבעלים בלבד.");
  pageMark(s, 14);
}

// ============================================================ SLIDE 15 — סטטוס
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "סיכום", "מה בנוי ועובד");
  const items = [
    ["●", "פריסה", "כתובת חיה", C.tealMid],
    ["●", "Evaluation", "30 שאלות + רגרסיה", C.tealMid],
    ["●", "Monitoring", "עלות/זמן לכל קריאה", C.tealMid],
    ["●", "Agent", "3 כלים + אישור אדם", C.tealMid],
    ["●", "מקור ידע", "pgvector, 3 יעדים", C.tealMid],
    ["◐", "אוטומציה", "מוכח, לא תמיד-דלוק", C.sunMid],
  ];
  const n = items.length, cw = 1.95, gap = 0.16, ch = 2.4, cy = 2.6;
  const totalW = n * cw + (n - 1) * gap;
  let x0 = W / 2 - totalW / 2;
  items.slice().reverse().forEach((it, i) => {
    const x = x0 + i * (cw + gap);
    card(s, x, cy, cw, ch, {});
    s.addText(it[0], {
      x, y: cy + 0.22, w: cw, h: 0.5, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT_DISPLAY, fontSize: 22, bold: true, color: it[3], align: "center",
    });
    s.addText(it[1], {
      x: x + 0.1, y: cy + 0.85, w: cw - 0.2, h: 0.4, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT_DISPLAY, fontSize: 12, bold: true, color: C.ink, align: "center",
    });
    s.addText(it[2], {
      x: x + 0.08, y: cy + 1.3, w: cw - 0.16, h: 0.9, isTextBox: true, rtlMode: true, margin: 0,
      fontFace: FONT, fontSize: 9.5, color: C.muted, align: "center", valign: "top",
    });
  });
  pageMark(s, 15);
}

// ============================================================ SLIDE 16 — סיום
{
  const s = pres.addSlide(); bgSlide(s);
  header(s, "תודה", "שאלות?");
  const cy = 2.6, cw = 5.8, ch = 1.7, gap = 0.24;
  card(s, W - MX - cw, cy, cw, ch, {});
  cardHeading(s, W - MX - cw + 0.25, cy + 0.22, cw - 0.5, "🔗 כתובת חיה", C.ink);
  cardBody(s, W - MX - cw + 0.25, cy + 0.75, cw - 0.5, ch - 0.95, "tripcraft-lac.vercel.app");
  card(s, MX, cy, cw, ch, {});
  cardHeading(s, MX + 0.25, cy + 0.22, cw - 0.5, "📦 ריפו", C.ink);
  cardBody(s, MX + 0.25, cy + 0.75, cw - 0.5, ch - 0.95, "היסטוריית קומיטים מלאה, כל החלטה מתועדת");
  s.addText([
    { text: "TripCraft · ", options: { color: C.dim, rtlMode: true } },
    { text: "מלווה הטיולים שלך", options: { bold: true, color: C.teal, rtlMode: true } },
    { text: " · רועי אסדו", options: { color: C.dim, rtlMode: true } },
  ], {
    x: MX, y: H - 0.7, w: W - MX * 2, h: 0.35, isTextBox: true, rtlMode: true,
    fontFace: FONT, fontSize: 12, align: "center",
  });
}

pres.writeFile({ fileName: OUT }).then(() => {
  console.log("done ->", OUT);
}).catch((e) => { console.error(e); process.exit(1); });
