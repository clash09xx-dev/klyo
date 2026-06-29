# Klyo

A multi-tenant CRM you can run for your own business, hand to your dad for
his, and sell to other businesses as a monthly subscription — all from one
codebase.

Every business that signs up gets its own private **workspace**: its own
contacts, its own team, its own data. Nothing is ever shared between
workspaces. Each workspace can pick up an AI offer composer (OpenAI), send
real email (your own SMTP), and pay you monthly through Stripe.

## What's inside

- **Personalization** — each person can pick their own full color theme
  (background, surface, and accent — not just button colors), independent
  of their teammates. Settings → Appearance.
- **A guided welcome tour** — runs automatically after first sign-up,
  spotlighting the actual buttons it's describing (Pipeline stats, New
  contact, the AI composer, Appearance, Team invites) one at a time.
  Replayable any time from the **?** button.
- **Workspaces** — every signup either creates a brand-new business (you
  become its admin, with a 7-day free trial) or joins an existing one via
  an invite code shared by a teammate. Sign-up/sign-in both work with
  email+password or a single "Continue with Google" click.
- **Quotes get previewed, not blasted** — "Save & preview" shows the exact
  email (recipients, subject, body) before anything sends. Nothing leaves
  Klyo without that confirmation step.
- **Contacts** — name, email, phone, company, marketing theme, pipeline
  stage, owner — all scoped to one workspace.
- **AI offer composer** — drafts a personalized offer email per contact via
  OpenAI, editable before sending.
- **Companies** — link contacts to a company with a title (Owner, Supervisor,
  etc.) and mark who's an actual decision-maker. Quotes can then be
  addressed to specific people at that company, not just one contact.
- **Quotes** — tailored, line-item offers (product, qty, price, per-line
  discount), built with drag-to-reorder line items, sent through the same
  Gmail/SMTP pipeline as everything else. Separate from the quick AI
  "offers" — offers are fast outreach emails, quotes are formal pricing.
- **Automated maintenance reminders** — mark a product as needing service
  every N months, and the moment a quote with that product gets accepted,
  Klyo starts tracking when it's due again. The Reminders tab surfaces
  anything overdue with a one-click templated reminder email.
- **Employee performance** — admins get a per-teammate breakdown (leads,
  offers, quotes, calls, meetings, clients contacted) under Team →
  Performance, pulled from the same activity log that already tracks
  everything else. Visible only to that workspace's admin — nobody else.
- **A hidden dashboard just for you** — set `PLATFORM_ADMIN_EMAIL` in
  `.env` to your own login email, and a "Platform" tab appears (only for
  you, on any workspace's account) showing every workspace, every user,
  signups, and estimated MRR across the whole app. No customer can see or
  reach this regardless of their role.
- **Profile settings** — Settings → update your name, set or change your
  password (including adding one as a backup if you signed up with
  Google), and your color theme, all in one place.
- **Email sending two ways** — each workspace can connect their own Gmail
  account (recommended — no shared password), or fall back to a single
  SMTP account configured on the server.
- **Activity timeline** — every draft, send, and edit logged automatically.
- **Stripe billing** — a 7-day trial, then a paid monthly subscription per
  workspace. Comp any workspace (e.g. a family member's business) to give
  it permanent free access instead.
- **Postgres** — one shared, properly isolated database, ready for many
  workspaces and concurrent users at once.

## Tech stack

| Layer    | Choice                  | Why |
|----------|--------------------------|-----|
| Server   | Node.js + Express        | Small, easy to read and extend |
| Database | Postgres                 | Handles many tenants and concurrent writes properly — what SQLite struggles with once strangers are paying you |
| Auth     | JWT + bcrypt             | Standard, dependency-light |
| Billing  | Stripe Checkout + webhooks | Industry standard, hosted checkout — you never touch card numbers |
| Email    | Gmail API (OAuth) + Nodemailer (SMTP fallback) | Each workspace can send as themselves; SMTP is a backstop, not a requirement |
| AI       | Official `openai` SDK     | Server-side only — the key never reaches the browser |
| Frontend | Plain HTML/CSS/JS         | No build step |

---

## 1. Set up Postgres locally

The easiest way is Docker:
```bash
docker run --name klyo-db -e POSTGRES_PASSWORD=klyo -e POSTGRES_DB=klyo -p 5432:5432 -d postgres:16
```
That gives you a connection string of:
```
postgresql://postgres:klyo@localhost:5432/klyo
```
(No Docker? Install Postgres directly — postgresql.org — and create a
database called `klyo`.)

## 2. Configure and run

```bash
cd klyo
npm install
cp .env.example .env
```

Open `.env` and set at minimum:
```
DATABASE_URL=postgresql://postgres:klyo@localhost:5432/klyo
JWT_SECRET=<generate one — see below>
```
Generate a `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Start the app:
```bash
npm start
```
The first time it runs, it creates all the database tables automatically.
Visit **http://localhost:4000**.

Click **Create an account**, then **Create a business** (this is what every
new paying customer will do). That makes you the admin of your own
workspace with a 7-day trial.

---

## 3. Bringing your dad in — free, unlimited access

Have him register a normal account at `/signup` → **Create a business** → his own business name. This creates
his own fully separate workspace.

Then, on the server, run:
```bash
npm run comp-workspace -- dad@his-email.com
```
That flags his workspace as **comped** — permanently free, never asked to
pay, regardless of what Stripe billing is doing for everyone else.

If he wants to add his own teammates later, the **Team** tab in his
dashboard (admin only) shows an invite code he can share — anyone who
registers with **I have an invite code** instead of **Create a business**
joins his workspace as a teammate, not a new customer.

---

## 4. Turn on AI drafting

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
```
Restart the app after editing `.env`.

## 5. Let people connect their own Gmail (instead of you sharing a password) — and sign in with Google

Two separate features share the same Google credentials below: workspaces
connecting Gmail to **send** offers/quotes, and anyone using **"Continue
with Google"** to sign in or sign up instead of a password. Same setup
covers both.

**One-time setup, on your end:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   create a project (or use an existing one).
2. **APIs & Services → Library** → search **Gmail API** → Enable.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - Add your app name, logo, support email
   - Scopes: add `.../auth/gmail.send`, `.../auth/userinfo.email`, and
     `.../auth/userinfo.profile`
   - While the app is in **Testing** mode, only test users you explicitly
     add (by email) can connect — fine for you and your dad right now. To
     let any stranger connect (including signing up with Google), you'll
     eventually need to submit for Google's verification, since "send
     email" is a sensitive scope. This can take some time, so plan for it
     before you rely on this for paying customers.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs — add **all four** of these:
     - `http://localhost:4000/api/integrations/gmail/callback`
     - `https://your-domain.com/api/integrations/gmail/callback`
     - `http://localhost:4000/api/auth/google/callback`
     - `https://your-domain.com/api/auth/google/callback`
5. Copy the **Client ID** and **Client secret** into `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```
6. Restart the app. The Team tab now shows a working **Connect Gmail** button.

## 6. SMTP — optional fallback

If a workspace hasn't connected Gmail (or you'd rather not deal with
Google's verification process right away), Klyo falls back to plain SMTP.
Fill this in if you want a safety net, or skip it entirely if everyone
will just connect their own Gmail:
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@yourbusiness.com
SMTP_PASS=...
SMTP_FROM_NAME=Your Business
SMTP_FROM_EMAIL=you@yourbusiness.com
```
If neither Gmail nor SMTP is set up, clicking "Send email" just shows a
clear error instead of failing silently.

---

## 7. Pricing tiers — and how to adjust them

The app ships with four recommended tiers, defined in one place:
`server/config/tiers.js`. Change names, prices, or limits there any time —
the pricing modal, the upgrade flow, and the limit checks all read from
that one file automatically.

| Tier | Suggested price | Seats | Contacts | AI drafts/mo |
|---|---|---|---|---|
| Personal | $9/mo | 1 | 200 | 50 |
| Plus | $29/mo | 5 | 1,000 | 300 |
| Pro | $79/mo | 20 | Unlimited | 1,500 |
| Ultra | $199/mo | Unlimited | Unlimited | Unlimited |

The reasoning: **Personal** is priced for a solo freelancer (like a single
hairdresser or photographer) who doesn't need teammates. **Plus** and
**Pro** scale with team size, since that's what actually costs you more to
support. **Ultra** is for agencies or multi-location businesses who'd
otherwise outgrow Pro's seat cap. AI drafts are capped per tier because
that's the one feature with a real per-use cost to you (OpenAI's bill) —
capping it protects your margins without needing to meter anything
else. These are starting points, not locked in — adjust freely.

During a workspace's free trial, none of these limits apply — everyone
gets full access to try the product properly. Limits only kick in once a
workspace is on an active **paid** plan.

## 8. Turn on Stripe billing (so strangers can actually pay you)

1. Create a [Stripe account](https://dashboard.stripe.com/register) if you
   don't have one.
2. In the Stripe Dashboard, create **one Product per tier** (e.g. "Klyo
   Personal", "Klyo Plus", "Klyo Pro", "Klyo Ultra"), each with a
   **recurring monthly Price** matching the amounts above (or your own).
   Copy each price ID (starts `price_`).
3. In **Developers → API keys**, copy your **Secret key** (starts `sk_test_`
   while testing).
4. In `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRICE_ID_PERSONAL=price_...
   STRIPE_PRICE_ID_PLUS=price_...
   STRIPE_PRICE_ID_PRO=price_...
   STRIPE_PRICE_ID_ULTRA=price_...
   APP_URL=http://localhost:4000
   ```
   Only set up the tiers you're ready to sell — any tier without a price ID
   simply shows an error if someone tries to pick it, instead of breaking
   the others.
5. Set up the webhook so Stripe can tell Klyo when someone pays:
   - In **Developers → Webhooks**, add an endpoint pointing at
     `https://your-domain.com/api/billing/webhook` (use the
     [Stripe CLI](https://docs.stripe.com/stripe-cli) with `stripe listen
     --forward-to localhost:4000/api/billing/webhook` for local testing).
   - Subscribe it to `checkout.session.completed`,
     `customer.subscription.updated`, and `customer.subscription.deleted`.
   - Copy the **Signing secret** (starts `whsec_`) into `.env` as
     `STRIPE_WEBHOOK_SECRET`.
6. Restart the app. The **Upgrade now** button in the dashboard banner now
   opens a real pricing modal with all four tiers, each redirecting to its
   own Stripe Checkout page.

Until you do this, the app works exactly the same — every new workspace
just rides its 7-day trial with no payment prompt ever appearing.

---

## 9. Deploy to Railway

1. Push this project to a GitHub repo.
2. On [railway.com](https://railway.com), create a new project → **Deploy
   from GitHub repo**.
3. Add Postgres: in your project, click **+ New** → **Database** →
   **Postgres**. Railway provisions it instantly.
4. On your app service, go to **Variables** and add everything from your
   `.env` (use **Raw Editor** to paste it all at once). For `DATABASE_URL`,
   set it to `${{Postgres.DATABASE_URL}}` so it automatically points at the
   database you just created. Set `APP_URL` to the domain Railway gives you.
5. Go to **Settings → Networking → Generate Domain** to get a live HTTPS
   URL — Railway handles the certificate for you automatically.
6. Update your Stripe webhook endpoint to point at that real domain instead
   of localhost.

That's the whole deployment — no Dockerfile, no server to patch, no Nginx
config. Railway auto-detects this as a Node app and runs `npm install` +
`npm start` for you.

**Cost note:** a small Node service plus a small Postgres instance
typically lands somewhere in the $5–20/month range on Railway's usage-based
pricing once you're past the initial free credit — comfortably worth it
once you have even one or two paying customers.

---

## 10. Running ads / selling it publicly

The public landing page at `https://klyolabs.com` explains what Klyo is and
has clear **Sign up** and **Log in** buttons. Point ads straight there.

- `/` — public marketing/landing page (no login required)
- `/signup` — signup page
- `/login` — login page
- `/app` — the CRM itself (requires login; redirects to `/login` if not authenticated)
- `/privacy` — privacy policy (public)
- `/terms` — terms of service (public)

---

## 11. Google OAuth verification — domain ownership

For Google to approve the OAuth consent screen (required for Gmail integration
and "Sign in with Google" to work for all users, not just test accounts), you
must verify that you own `klyolabs.com` in Google Search Console **using the
same Google account** that owns the Google Cloud project.

**Steps:**

1. Go to [search.google.com/search-console](https://search.google.com/search-console/)
   and sign in with the **same Google account** used in Google Cloud Console.
2. Click **Add property** → choose **Domain** → enter `klyolabs.com`.
3. Google will give you a DNS TXT record to add. Add it via your domain
   registrar's DNS settings (e.g. Namecheap, GoDaddy, Cloudflare).
4. Click **Verify** — can take up to 24 h for DNS to propagate.
5. Once verified, go back to Google Cloud → **APIs & Services → OAuth consent
   screen** and ensure your **Authorized domain** is set to `klyolabs.com`.
6. Submit for **verification** (required for sensitive scopes like
   `gmail.send` to work for all users). You will need to supply:
   - A link to your Privacy Policy: `https://klyolabs.com/privacy`
   - A link to your Terms of Service: `https://klyolabs.com/terms`
   - A YouTube demo video showing the OAuth flow and how Gmail is used
   - A clear explanation that Gmail is used only to send emails the user
     composes and approves (never to read the inbox)

**Important:** the homepage `https://klyolabs.com` must be publicly accessible
(no login required) and clearly explain the app's purpose. This is already
the case — the landing page is public and describes Klyo's Gmail use.

---

## Project structure

```
klyo/
├── server/
│   ├── index.js              # Express app entry point
│   ├── db.js                  # Postgres schema (workspaces, users, contacts, offers, activity)
│   ├── config/
│   │   └── tiers.js           # pricing tier definitions — edit limits/prices here
│   ├── middleware/
│   │   ├── auth.js            # verifies login tokens
│   │   ├── billing.js         # blocks access once trial/payment lapses (unless comped)
│   │   └── platformAdmin.js   # gates the developer-only Platform dashboard
│   ├── routes/                # auth, contacts, offers, stats, billing, integrations,
│   │                           # companies, products, quotes, discounts, reminders,
│   │                           # team-stats, platform
│   ├── services/              # openai.js, mailer.js, stripe.js, google.js (Gmail + sign-in OAuth), limits.js
│   └── scripts/
│       └── comp-workspace.js  # CLI: give one workspace permanent free access
├── public/
│   ├── index.html             # public landing page (no login required)
│   ├── app.html               # CRM dashboard shell (requires login)
│   ├── login.html             # sign in / create business / join with invite code / Google
│   ├── privacy.html           # privacy policy (public)
│   ├── terms.html             # terms of service (public)
│   ├── css/style.css
│   └── js/                    # api.js, app.js, i18n.js
├── .env.example
└── package.json
```

## What's deliberately not built yet

- **A "super-admin" panel** to manage every customer workspace from one
  screen (right now, comping someone is a one-line terminal command — fine
  for a handful of accounts, worth building properly once you have many).
- **Lead-capture forms / CSV import** — you've said manual entry is fine
  for now; the code is structured so adding either later is a contained
  change, not a rewrite.
- **A way to downgrade or cancel a plan from inside the app** — right now
  that happens in the Stripe customer portal directly; worth wiring into
  the app once you have real subscribers to support.
- **Standing/saved discount rules have a backend but no UI yet** — you can
  already give any customer a custom discount on any line item right
  inside the quote builder (that works today). What's not built: a
  separate screen to save "this customer always gets 15% off X" as a rule
  that auto-suggests next time. The API (`/api/discounts`) is ready; it
  just needs a frontend.
- **Two UI modes (Simple/Advanced) were deliberately not built** — see the
  reasoning in-conversation: a single interface with progressive
  disclosure (and tier-gating quotes/discounts to Plus and up, if you want
  that) does the same job without doubling the maintenance burden forever.
