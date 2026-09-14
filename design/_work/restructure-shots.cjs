const fs = require("fs");

const file = "C:/Users/user/אפליקציית טיולים/docs/presentation.html";
let html = fs.readFileSync(file, "utf8");

// Extract each existing figure block (base64 already inlined) by its alt text,
// without ever matching against the base64 payload itself.
function extractFigure(altText) {
  const re = new RegExp(
    `<figure><div class="phone"><img src="[^"]*" alt="${altText}"></div>[\\s\\S]*?</figure>`
  );
  const m = html.match(re);
  if (!m) throw new Error("figure not found for alt=" + altText);
  return m[0];
}

const figTripHome = extractFigure("מסך טיול");
const figItinerary = extractFigure("מסלול");
const figRecommendations = extractFigure("מומלצים");
const figDocuments = extractFigure("מסמכים");
const figAskAgent = extractFigure("שאל את הסוכן");
const figTripsList = extractFigure("רשימת טיולים");

const loginB64 = fs
  .readFileSync("C:/Users/user/אפליקציית טיולים/docs/assets/screens/login.jpg")
  .toString("base64");
const figLogin = `<figure><div class="phone"><img src="data:image/jpeg;base64,${loginB64}" alt="מסך כניסה"></div><figcaption><b>כניסה</b>אימייל+סיסמה, או Google בלחיצה אחת</figcaption></figure>`;

const startMarker = "ליצירת ה-embeddings — לא Claude, כי זו משימת הטמעה ולא שיחה.</p>\n  </div>\n</section>\n\n";
const endMarker = '<section class="slide" data-t="מדידה">';

const startIdx = html.indexOf(startMarker);
const endIdx = html.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) throw new Error("markers not found");
const insertAt = startIdx + startMarker.length;

const newSlides = `<!-- 10 ─── אבטחה ומפתחות ───────────────────────────────────── -->
<section class="slide" data-t="אבטחה: כניסה ומפתחות API">
  <div class="eyebrow">אבטחה ותשתית</div>
  <h2 class="title">כניסה עם Google, ומפתחות בצד השרת בלבד</h2>
  <div class="slide-body">
    <div class="grid g2">
      <div class="card teal">
        <h3>🔑 כניסה עם חשבון Google</h3>
        <p>מופעל דרך Supabase Auth (OAuth), עם OAuth Client עצמאי בפרויקט Google Cloud "Travel App". המשתמש לוחץ "המשך עם Google" — מועבר לאימות אצל גוגל, וחוזר מחובר, בלי סיסמה נוספת לזכור. זמין לצד ההתחברות הרגילה במייל+סיסמה, לא במקומה.</p>
      </div>
      <div class="card coral">
        <h3>🛡️ הכלל שקבע את הארכיטקטורה</h3>
        <p>אף מפתח API לא מגיע לדפדפן — לעולם. כל קריאה למודל שפה, להטמעות, או לאימות עוברת דרך Edge Function בצד השרת, שמחזיק את הסוד. הלקוח (React) לא רואה אף מפתח, אפילו לא ב-network tab.</p>
      </div>
    </div>
    <div class="tw">
      <table>
        <thead><tr><th>מפתח / סוד</th><th>לאיזה כלי</th><th>איפה מאוחסן</th></tr></thead>
        <tbody>
          <tr><td class="mono">ANTHROPIC_API_KEY</td><td>סוכן השיחה (ask) והפקת תוכן (generate)</td><td>Supabase secret, בצד השרת</td></tr>
          <tr><td class="mono">VOYAGE_API_KEY</td><td>Embeddings למקור הידע (RAG)</td><td>Supabase secret, בצד השרת</td></tr>
          <tr><td>Google OAuth Client ID + Secret</td><td>כניסה עם Google</td><td>Supabase Auth provider config</td></tr>
          <tr><td>Supabase URL + anon key</td><td>גישת הלקוח למסד/Auth/Storage</td><td>ציבורי בכוונה — RLS הוא שער ההגנה האמיתי</td></tr>
          <tr><td>Supabase service-role key</td><td>סקריפטים מקומיים בלבד (evals, seeding)</td><td>קובץ .env מקומי, לא בגיט</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<!-- 11 ─── צילומי מסך א' ──────────────────────────────────────── -->
<section class="slide" data-t="צילומי מסך · כניסה והבית">
  <div class="eyebrow">איך זה נראה</div>
  <h2 class="title">כניסה, ומסך הבית</h2>
  <div class="slide-body">
    <div class="shots lg">
      ${figLogin}
      ${figTripsList}
      ${figTripHome}
    </div>
  </div>
  <div class="foot">צילומי מסך אמיתיים — טיול "חופשה משפחתית ברודוס" (דוגמה).</div>
</section>

<!-- 12 ─── צילומי מסך ב' ──────────────────────────────────────── -->
<section class="slide" data-t="צילומי מסך · מסלול ותוכן">
  <div class="eyebrow">איך זה נראה</div>
  <h2 class="title">מסלול ומומלצים</h2>
  <div class="slide-body">
    <div class="shots lg">
      ${figItinerary}
      ${figRecommendations}
    </div>
  </div>
  <div class="foot">צילומי מסך אמיתיים — טיול "חופשה משפחתית ברודוס" (דוגמה).</div>
</section>

<!-- 13 ─── צילומי מסך ג' ──────────────────────────────────────── -->
<section class="slide" data-t="צילומי מסך · מסמכים וסוכן">
  <div class="eyebrow">איך זה נראה</div>
  <h2 class="title">מסמכים, והסוכן</h2>
  <div class="slide-body">
    <div class="shots lg">
      ${figDocuments}
      ${figAskAgent}
    </div>
  </div>
  <div class="foot">צילומי מסך אמיתיים — טיול "חופשה משפחתית ברודוס" (דוגמה).</div>
</section>

`;

html = html.slice(0, insertAt) + newSlides + html.slice(endIdx);
fs.writeFileSync(file, html);
console.log("done, new size:", (fs.statSync(file).size / 1024).toFixed(0) + "KB");
