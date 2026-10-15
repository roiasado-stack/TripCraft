# Auth email templates (Hebrew, RTL)

Production copies live in the Supabase dashboard, not here: Authentication → Emails → Templates.
Paste each file's full HTML into the matching template's **Body**, and the subject below into **Subject**.
These files are the source of truth; edit here first, then paste again.

| Dashboard template | File | Subject |
|---|---|---|
| Confirm signup | `confirmation.html` | אישור ההרשמה ל-TripCraft |
| Reset Password | `recovery.html` | איפוס הסיסמה ל-TripCraft |
| Magic Link | `magic_link.html` | קישור כניסה ל-TripCraft |
| Invite user | `invite.html` | הוזמנתם ל-TripCraft |
| Change Email Address | `email_change.html` | אישור כתובת המייל החדשה |

- Links use `{{ .ConfirmationURL }}`, the same variable as Supabase's defaults, so the auth flow does not change.
- The logo is `{{ .SiteURL }}/icon-192.png`. If Site URL (Authentication → URL Configuration) changes,
  the logo follows it.
- Email clients ignore CSS classes and variables, so colours are inline hex here on purpose. The no-hex
  rule in `npm run rules` covers `src/` only.
- The footer contact address must match `contactEmail` in `src/lib/legal.ts`.
