# Publishing Klyo — the full checklist

Follow this top to bottom. Each step says exactly what to click and what
to paste into `.env`. The detailed "why" for anything is in README.md —
this file is just the ordered, no-skipping-around version.

---

## Before you start

Things to have ready:
- [ ] A Google account you're comfortable using as the app's Google identity
- [ ] A way to receive money (your own bank account, for Stripe)
- [ ] A GitHub account (free) — Railway deploys from a GitHub repo
- [ ] A domain name you've decided on and can buy today

---

## Part 1 — Google (Gmail sending + "Continue with Google")

1. [ ] Go to [console.cloud.google.com](https://console.cloud.google.com) → create a new project (top-left project switcher → New Project). Name it anything — "Klyo" is fine.
2. [ ] **APIs & Services → Library** → search **Gmail API** → click **Enable**.
3. [ ] **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - App name, your email as support contact, your email as developer contact
   - **Scopes** step: **Add or remove scopes** → check:
     - `.../auth/gmail.send`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
   - **Test users** step: add your own email and your dad's email here. Anyone NOT on this list can't use Gmail-connect or Google sign-in yet — that's expected while the app is in Testing mode.
4. [ ] **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: anything
   - **Authorized redirect URIs** — add all four (yes, all four, even before you have a real domain — you'll edit these again in Part 4 once you do):
     ```
     http://localhost:4000/api/integrations/gmail/callback
     http://localhost:4000/api/auth/google/callback
     https://your-domain.com/api/integrations/gmail/callback
     https://your-domain.com/api/auth/google/callback
     ```
   - Click **Create**. Copy the **Client ID** and **Client secret** that appear.
5. [ ] Paste both into your `.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
6. [ ] Restart the app (`npm start`). Test: **Continue with Google** on the login page, and **Team → Connect Gmail** once logged in. Both should work for any email you added as a test user.

---

## Part 2 — Stripe (so people can actually pay you)

1. [ ] Create an account at [dashboard.stripe.com/register](https://dashboard.stripe.com/register).
2. [ ] Stay in **Test mode** for now (toggle top-right) — you'll flip to live mode in Part 5.
3. [ ] **Product catalog → Add product**, four times, one per tier. For each product, add **two Prices**: a **recurring monthly** one (what most people will pick), and a **one-time** one for the same dollar amount (for the "buy 1 month, don't auto-renew" option). The defaults in `server/config/tiers.js` are $9 / $29 / $79 / $199 — change that file first if you want different numbers, then make both Stripe prices match.
4. [ ] For each Price you created (8 total — 2 per tier), copy its **Price ID** (starts `price_...`, not the Product ID).
5. [ ] **Developers → API keys** → copy the **Secret key** (starts `sk_test_...`).
6. [ ] Paste into `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRICE_ID_PERSONAL=price_...
   STRIPE_PRICE_ID_PLUS=price_...
   STRIPE_PRICE_ID_PRO=price_...
   STRIPE_PRICE_ID_ULTRA=price_...
   STRIPE_PRICE_ID_PERSONAL_ONETIME=price_...
   STRIPE_PRICE_ID_PLUS_ONETIME=price_...
   STRIPE_PRICE_ID_PRO_ONETIME=price_...
   STRIPE_PRICE_ID_ULTRA_ONETIME=price_...
   ```
   Skip any one-time price you don't want to offer for a given tier — leave that line blank and the app just won't show that option for that tier.
7. [ ] **Developers → Webhooks → Add endpoint**:
   - URL: `https://your-domain.com/api/billing/webhook` (use the [Stripe CLI](https://docs.stripe.com/stripe-cli) with `stripe listen --forward-to localhost:4000/api/billing/webhook` to test locally first, if you want to)
   - Events to send: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (starts `whsec_...`) into `.env`:
     ```
     STRIPE_WEBHOOK_SECRET=whsec_...
     ```
8. [ ] Test the monthly path: open the pricing modal (Upgrade now), leave it on "Monthly," pick a tier, complete checkout with [Stripe's test card](https://docs.stripe.com/testing) `4242 4242 4242 4242`, any future date, any CVC. Confirm the workspace's plan flips to "active."
9. [ ] Test the one-time path the same way, but switch the toggle to "One month only" first. Confirm Settings shows "one-time purchase" with a days-left count, and that there's no "Cancel subscription" button (nothing to cancel — it just expires on its own).
10. [ ] Test cancellation: on a monthly subscription, go to Settings → Cancel subscription. Confirm it shows "cancelling, access until [date]" rather than cutting you off immediately, and that a "Resume subscription" button appears.

---

## Part 3 — Domain

1. [ ] Buy it on any registrar — Namecheap, Cloudflare, or whichever you already use.
2. [ ] Don't point DNS anywhere yet — that happens in Part 4, once Railway gives you a target to point at.

---

## Part 4 — Deploy to Railway

1. [ ] Push this project to a new GitHub repo (`git init`, `git add .`, `git commit`, create a repo on GitHub, `git push`). **Double-check `.env` is in `.gitignore` and not committed** — it has your secrets in it.
2. [ ] [railway.com](https://railway.com) → **New Project → Deploy from GitHub repo** → pick the repo.
3. [ ] In the same project: **+ New → Database → Add PostgreSQL**.
4. [ ] On your app service → **Variables** tab → **Raw Editor** → paste in everything from your local `.env`, then change two things:
   - `DATABASE_URL` → set to `${{Postgres.DATABASE_URL}}` (this references the database you just added — don't paste your local connection string here)
   - `APP_URL` → leave a placeholder for now, you'll set the real one in step 6
5. [ ] **Settings → Networking → Generate Domain** — Railway gives you a `*.up.railway.app` URL with HTTPS already working.
6. [ ] **Settings → Networking → Custom Domain** → add your real domain → Railway shows you a CNAME record → add that CNAME at your domain registrar's DNS settings. Propagation can take a few minutes to a few hours.
7. [ ] Back in Variables, set `APP_URL=https://your-real-domain.com` (your actual domain, now that DNS is pointed at Railway). Redeploy.
8. [ ] Go back to Google Cloud Console (Part 1, step 4) and Stripe webhook (Part 2, step 7) and make sure both have your **real domain**, not localhost, in their URLs.

---

## Part 5 — Go live for real

1. [ ] Flip Stripe out of Test mode (top-right toggle) → repeat Part 2 steps 3–7 in **live** mode (yes, the test-mode products/prices/keys are separate from live-mode ones — you need real ones too). Update `.env` on Railway with the live keys.
2. [ ] In Google Cloud Console, when you're ready for the general public (not just test users) to use Gmail-connect and Google sign-in, submit the OAuth consent screen for **verification**. This can take Google a few days to a couple weeks — start this well before you plan to run ads.
3. [ ] Open your real domain in an incognito window and run through the whole flow once, end to end: sign up → add a contact → generate an AI offer → send it → build a quote → preview it → send it → upgrade a plan with a real card (then refund yourself from the Stripe dashboard).

---

## After launch

- **Ads**: you said no rush here — whenever you're ready, the signup page is just `https://your-domain.com/login.html`. Worth building an actual marketing/pricing landing page first (see README's "What's deliberately not built yet") rather than sending ad traffic straight to a login form.
- **iOS App Store**: a web app can't be submitted as-is. When you're ready to look at this seriously, the realistic options are wrapping it with [Capacitor](https://capacitorjs.com) (closest to "ship the existing app to the App Store") or a PWA install prompt (no App Store listing, but works today with zero extra code). Worth its own conversation when you get there.
